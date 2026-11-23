"""Agent wake-up stream: gated per workspace, content-free, same auth as polls."""

import asyncio
import json
import uuid

import pytest

from app.models import EventRecord
from app.services import agent_stream


@pytest.fixture
def allow(workspace):
    agent_stream.configure_allowlist(workspace["id"])
    yield
    agent_stream.configure_allowlist("")


@pytest.fixture
def published(monkeypatch):
    from app import cache
    out = []
    monkeypatch.setattr(cache, "publish_event", lambda ch, data: out.append((ch, data)))
    return out


def _wakes(published, workspace_id):
    channel = agent_stream.wake_channel(workspace_id)
    return [json.loads(data) for ch, data in published if ch == channel]


def _write(db, workspace_id, type_, source, target):
    db.add(EventRecord(
        id=str(uuid.uuid4()), network_id=workspace_id, type=type_, source=source,
        target=target, payload={"content": "secret text"}, metadata_={}, timestamp=1,
    ))
    db.commit()


class TestPublishing:
    def test_commit_publishes_content_free_summary(self, db, workspace, allow, published):
        _write(db, workspace["id"], "workspace.message.posted", "human:a@example.com", "channel/general")
        _write(db, workspace["id"], "workspace.agent.control", "human:a@example.com", "openagents:bot")
        _write(db, workspace["id"], "workspace.agent.status", "openagents:bot", "channel/general")
        wakes = _wakes(published, workspace["id"])
        assert wakes == [{"m": ["human:a@example.com"]}, {"c": ["openagents:bot"]}]
        assert all("secret" not in data.decode() for _, data in published)

    def test_not_published_outside_the_allowlist(self, db, workspace, published):
        agent_stream.configure_allowlist("some-other-workspace")
        try:
            _write(db, workspace["id"], "workspace.message.posted", "human:a@example.com", "channel/general")
        finally:
            agent_stream.configure_allowlist("")
        assert _wakes(published, workspace["id"]) == []

    def test_rollback_publishes_nothing(self, db, workspace, allow, published):
        db.add(EventRecord(
            id=str(uuid.uuid4()), network_id=workspace["id"], type="workspace.message.posted",
            source="human:a@example.com", target="channel/general", payload={}, metadata_={}, timestamp=1,
        ))
        db.flush()
        db.rollback()
        db.commit()
        assert _wakes(published, workspace["id"]) == []

    def test_large_batches_wake_everyone(self, db, workspace, allow, published):
        for i in range(agent_stream._SUMMARY_CAP + 1):
            db.add(EventRecord(
                id=str(uuid.uuid4()), network_id=workspace["id"], type="workspace.agent.control",
                source="human:a@example.com", target=f"openagents:bot{i}", payload={}, metadata_={}, timestamp=1,
            ))
        db.commit()
        assert _wakes(published, workspace["id"]) == [{"c": None}]


class TestKinds:
    def test_own_messages_do_not_wake(self):
        assert agent_stream.kinds_for({"m": ["openagents:me"]}, "openagents:me") == set()
        assert agent_stream.kinds_for({"m": ["openagents:me", "human:x"]}, "openagents:me") == {"message"}

    def test_control_wakes_only_its_target(self):
        assert agent_stream.kinds_for({"c": ["openagents:other"]}, "openagents:me") == set()
        assert agent_stream.kinds_for({"c": ["openagents:me"]}, "openagents:me") == {"control"}

    def test_unknown_or_overflow_wakes(self):
        assert agent_stream.kinds_for(None, "openagents:me") == {"message", "control"}
        assert agent_stream.kinds_for({"m": None, "c": None}, "openagents:me") == {"message", "control"}


def test_hub_fans_out_per_workspace_and_agent():
    async def run():
        hub = agent_stream.WakeHub()
        hub._task = asyncio.get_running_loop().create_future()  # keep the Redis loop off
        me = hub.subscribe("w1", "openagents:me")
        other = hub.subscribe("w1", "openagents:other")
        elsewhere = hub.subscribe("w2", "openagents:me")
        hub._dispatch(b"ws:w1:agent-wake", b'{"c":["openagents:me"]}')
        assert await me.wait(0.01) == {"control"}
        assert await other.wait(0.01) == set()
        assert await elsewhere.wait(0.01) == set()
        hub._dispatch(b"ws:w1:agent-wake", b"not json")
        assert await other.wait(0.01) == {"message", "control"}
        hub.unsubscribe(me)
        hub.unsubscribe(other)
        hub.unsubscribe(elsewhere)
        assert hub.stream_count() == 0
        hub._task.cancel()

    asyncio.run(run())


def _get_stream(client, workspace, monkeypatch, headers=None, params=""):
    import app.routers.events as events_mod
    from tests.conftest import TestingSessionLocal

    monkeypatch.setattr(events_mod, "SessionLocal", TestingSessionLocal)
    monkeypatch.setattr(events_mod, "AGENT_STREAM_MAX_SECONDS", 0.3)
    monkeypatch.setattr(events_mod, "AGENT_STREAM_JITTER_SECONDS", 0.0)
    monkeypatch.setattr(events_mod, "AGENT_STREAM_KEEPALIVE_SECONDS", 0.1)
    return client.get(f"/v1/events/agent-stream?network={workspace['id']}{params}", headers=headers or {})


class TestEndpoint:
    def test_disabled_workspace_gets_404_and_keeps_polling(self, client, workspace, monkeypatch):
        r = _get_stream(client, workspace, monkeypatch, {"X-Workspace-Token": workspace["token"], "X-Agent-Name": "agent-alpha"})
        assert r.status_code == 404
        assert r.json()["data"]["reason"] == "agent_stream_disabled"

    def test_rejects_bad_credentials(self, client, workspace, allow, monkeypatch):
        r = _get_stream(client, workspace, monkeypatch, {"X-Workspace-Token": "wrong", "X-Agent-Name": "agent-alpha"})
        assert r.status_code == 401

    def test_requires_agent_name(self, client, workspace, allow, monkeypatch):
        r = _get_stream(client, workspace, monkeypatch, {"X-Workspace-Token": workspace["token"]})
        assert r.status_code == 400

    def test_streams_wakes_and_ends_with_reconnect(self, client, workspace, allow, monkeypatch):
        monkeypatch.setattr(agent_stream.hub, "_task", None)  # restored after the test
        real_subscribe = agent_stream.hub.subscribe

        def subscribe(workspace_id, address):
            agent_stream.hub._task = asyncio.get_running_loop().create_future()
            sub = real_subscribe(workspace_id, address)
            assert address == "openagents:agent-alpha"
            sub.notify({"m": ["human:someone@example.com"], "c": ["openagents:agent-alpha"]})
            return sub

        monkeypatch.setattr(agent_stream.hub, "subscribe", subscribe)
        r = _get_stream(client, workspace, monkeypatch, {"X-Workspace-Token": workspace["token"], "X-Agent-Name": "agent-alpha"})
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/event-stream")
        assert "event: wake\ndata: {\"kinds\":[\"control\",\"message\"]}" in r.text
        assert ": keepalive" in r.text
        assert r.text.rstrip().endswith("event: reconnect\ndata: {}")
        assert agent_stream.hub.stream_count() == 0
