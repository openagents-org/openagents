"""Convenience-route events wake SSE only after a successful commit."""

import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import UUID

import pytest

from app import cache
from app.routers import network
from openagents.core.onm_events import Event, EventVisibility
from openagents.core.onm_mods import EventRejected


@pytest.fixture
def emit_setup(monkeypatch):
    event = Event(
        id="incoming-event",
        type="workspace.knowledge.created",
        source="test-agent",
        target="channel/test",
        payload={"title": "SSE regression"},
        metadata={"test": True},
        timestamp=1794000000000,
    )
    workspace = SimpleNamespace(id=UUID("c860d754-2410-4b3b-a7d1-c2f91b5f742d"))
    process = AsyncMock(return_value=event)
    publish = Mock()
    db = Mock()
    monkeypatch.setattr(network.pipeline, "process", process)
    monkeypatch.setattr(cache, "publish_event", publish)
    return SimpleNamespace(event=event, workspace=workspace, db=db,
                           process=process, publish=publish)


@pytest.mark.parametrize("blocking", [False, True], ids=["async", "sync-wrapper"])
def test_publish_committed_pipeline_result_and_preserve_context(emit_setup, blocking):
    s = emit_setup
    result = s.event.model_copy(update={
        "id": "transformed-event",
        "target": "person:recipient@example.test",
        "payload": {"id": UUID("499fc583-65ba-454c-95af-1015c357f91d")},
        "metadata": {"observed_at": datetime(2026, 11, 7, tzinfo=timezone.utc)},
        "visibility": EventVisibility.DIRECT,
    })
    s.process.return_value = result
    order = []
    s.db.commit.side_effect = lambda: order.append("commit")
    s.publish.side_effect = lambda *_: order.append("publish")

    if blocking:
        actual = network._emit_event_blocking(s.event, s.workspace, s.db, token="test-only")
    else:
        actual = asyncio.run(network._emit_event(s.event, s.workspace, s.db, token="test-only"))

    assert actual is result
    assert order == ["commit", "publish"]
    s.process.assert_awaited_once()
    passed_event, context = s.process.await_args.args
    assert passed_event is s.event
    assert context.network_id == str(s.workspace.id)
    assert context.agent_address == s.event.source
    assert context.extra == {"db": s.db, "workspace": s.workspace, "token": "test-only"}
    s.publish.assert_called_once()
    channel, wire = s.publish.call_args.args
    assert channel == f"ws:{s.workspace.id}:events"
    assert isinstance(wire, bytes)
    assert json.loads(wire) == {
        "id": result.id,
        "type": result.type,
        "source": result.source,
        "target": result.target,
        "payload": {"id": str(result.payload["id"])},
        "metadata": {"observed_at": str(result.metadata["observed_at"])},
        "timestamp": result.timestamp,
        "visibility": "direct",
    }


@pytest.mark.parametrize("visibility,expected", [
    (EventVisibility.DIRECT, "direct"),
    ("mod_only", "mod_only"),
    (None, "channel"),
])
def test_snapshot_preserves_visibility_for_stream_filtering(emit_setup, visibility, expected):
    s = emit_setup
    s.process.return_value = s.event.model_copy(update={"visibility": visibility})
    asyncio.run(network._emit_event(s.event, s.workspace, s.db))
    s.publish.assert_called_once()
    assert json.loads(s.publish.call_args.args[1])["visibility"] == expected


def test_rejected_event_is_not_committed_or_published(emit_setup):
    s = emit_setup
    s.process.side_effect = EventRejected("test-guard", "rejected")
    assert asyncio.run(network._emit_event(s.event, s.workspace, s.db)) is None
    s.db.commit.assert_not_called()
    s.publish.assert_not_called()


def test_none_pipeline_result_is_not_published(emit_setup):
    s = emit_setup
    s.process.return_value = None
    assert asyncio.run(network._emit_event(s.event, s.workspace, s.db)) is None
    s.publish.assert_not_called()


def test_nonpersisted_heartbeat_is_not_published(emit_setup):
    s = emit_setup
    heartbeat = s.event.model_copy(update={"type": "network.ping"})
    s.process.return_value = heartbeat
    assert asyncio.run(network._emit_event(heartbeat, s.workspace, s.db)) is heartbeat
    s.db.commit.assert_called_once_with()
    s.publish.assert_not_called()


def test_failed_commit_is_not_published(emit_setup):
    s = emit_setup
    s.db.commit.side_effect = RuntimeError("commit failed")
    with pytest.raises(RuntimeError, match="commit failed"):
        asyncio.run(network._emit_event(s.event, s.workspace, s.db))
    s.publish.assert_not_called()


def test_pipeline_failure_is_not_committed_or_published(emit_setup):
    s = emit_setup
    s.process.side_effect = RuntimeError("pipeline failed")
    with pytest.raises(RuntimeError, match="pipeline failed"):
        asyncio.run(network._emit_event(s.event, s.workspace, s.db))
    s.db.commit.assert_not_called()
    s.publish.assert_not_called()


def test_publish_failure_preserves_committed_success(emit_setup):
    s = emit_setup
    s.publish.side_effect = RuntimeError("Redis unavailable")
    assert asyncio.run(network._emit_event(s.event, s.workspace, s.db)) is s.event
    s.db.commit.assert_called_once_with()
    s.publish.assert_called_once()
