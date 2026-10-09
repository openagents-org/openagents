"""Regression coverage for cloud-agent replies in direct messages."""

import asyncio
import types
import uuid

import pytest
from app.models import EventRecord
from app.services import cloud_agent
from app.services.cloud_agent import _build_conversation_context
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

HUMAN = "human:user"
AGENT = "openagents:test1"
CHANNEL = "channel/general"


def _event(
    workspace_id,
    source,
    target,
    timestamp,
    content,
    *,
    visibility="direct",
    event_id=None,
):
    return EventRecord(
        id=event_id or str(uuid.uuid4()),
        network_id=workspace_id,
        type="workspace.message.posted",
        source=source,
        target=target,
        payload={"content": content, "message_type": "chat"},
        metadata_={},
        timestamp=timestamp,
        visibility=visibility,
    )


def _cloud_config(name="test1", category="chat"):
    return types.SimpleNamespace(
        agent_name=name,
        provider="openai",
        model="test-model",
        api_key="test-key",
        base_url=None,
        system_prompt=None,
        max_tokens=32,
        category=category,
    )


def _quiet_cloud_side_effects(monkeypatch):
    """Keep post-response assertions local to the event pipeline."""
    import app.services.integrations as integrations
    import app.services.push as push
    import app.services.watches as watches
    import app.services.workflow as workflow

    monkeypatch.setattr(push, "fanout_for_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(workflow, "advance_workflow", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(integrations, "relay_for_event", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(watches, "notify_watchers", lambda *_args, **_kwargs: None)


def test_chat_dm_reply_round_trips_through_dm_poll(client, workspace, db, monkeypatch):
    """A real cloud chat invocation must produce a reply visible to DM poll."""
    _quiet_cloud_side_effects(monkeypatch)

    trigger_id = "dm-trigger"
    db.add(
        _event(
            workspace["id"],
            HUMAN,
            AGENT,
            100,
            "hello test1",
            event_id=trigger_id,
        )
    )
    db.commit()

    async def fake_chat_completion(**_kwargs):
        return "reply from test1"

    monkeypatch.setattr(cloud_agent, "chat_completion", fake_chat_completion)
    asyncio.run(
        cloud_agent._invoke_chat_agent(
            db,
            workspace["id"],
            {
                "id": trigger_id,
                "source": HUMAN,
                "target": AGENT,
                "payload": {"content": "hello test1", "message_type": "chat"},
                "timestamp": 100,
            },
            _cloud_config(),
            depth=0,
        )
    )

    response = client.get(
        "/v1/events",
        params={
            "network": workspace["id"],
            "conversation": f"{HUMAN},{AGENT}",
            "type": "workspace.message.posted",
            "sort": "asc",
        },
        headers={"X-Workspace-Token": workspace["token"]},
    )
    assert response.status_code == 200, response.text
    events = response.json()["data"]["events"]
    assert [(e["source"], e["target"], e["visibility"]) for e in events] == [
        (HUMAN, AGENT, "direct"),
        (AGENT, HUMAN, "direct"),
    ]


def test_dm_history_is_bidirectional_and_isolated(db, workspace):
    """DM context contains only the direct pair, in causal order."""
    rows = [
        _event(workspace["id"], HUMAN, AGENT, 1, "inbound"),
        _event(workspace["id"], AGENT, HUMAN, 2, "outbound"),
        _event(workspace["id"], "human:other", AGENT, 3, "other inbound"),
        _event(workspace["id"], HUMAN, "openagents:other", 4, "other outbound"),
        _event(workspace["id"], HUMAN, AGENT, 5, "channel-shaped", visibility="channel"),
        _event(workspace["id"], HUMAN, CHANNEL, 6, "normal channel", visibility="channel"),
    ]
    db.add_all(rows)
    db.commit()

    messages = _build_conversation_context(
        db,
        workspace["id"],
        AGENT,
        "test1",
        conversation_source=HUMAN,
        before_timestamp=100,
    )

    assert [message["content"] for message in messages] == ["inbound", "outbound"]


def test_dm_history_without_counterpart_fails_closed(db, workspace):
    """An address target without its source must not broaden history."""
    db.add(_event(workspace["id"], HUMAN, AGENT, 1, "must not leak"))
    db.commit()

    assert (
        _build_conversation_context(
            db,
            workspace["id"],
            AGENT,
            "test1",
            before_timestamp=100,
        )
        == []
    )


def test_channel_history_keeps_existing_target_semantics(db, workspace):
    db.add_all(
        [
            _event(workspace["id"], HUMAN, CHANNEL, 1, "channel inbound", visibility="channel"),
            _event(workspace["id"], AGENT, CHANNEL, 2, "channel reply", visibility="channel"),
        ]
    )
    db.commit()

    messages = _build_conversation_context(
        db,
        workspace["id"],
        CHANNEL,
        "test1",
        before_timestamp=100,
    )

    assert [message["content"] for message in messages] == [
        "channel inbound",
        "channel reply",
    ]


@pytest.mark.parametrize(
    ("target", "source", "expected_target", "expected_visibility"),
    [
        (AGENT, HUMAN, HUMAN, "direct"),
        (CHANNEL, HUMAN, CHANNEL, "channel"),
    ],
)
def test_post_response_routes_dm_and_channel_separately(
    db,
    workspace,
    monkeypatch,
    target,
    source,
    expected_target,
    expected_visibility,
):
    _quiet_cloud_side_effects(monkeypatch)

    asyncio.run(
        cloud_agent._post_response(
            db,
            workspace["id"],
            target,
            "test1",
            "response",
            depth=0,
            trigger_source=source,
        )
    )

    row = db.execute(
        select(EventRecord).where(
            EventRecord.network_id == workspace["id"],
            EventRecord.source == AGENT,
            EventRecord.payload["content"].as_string() == "response",
        )
    ).scalar_one()
    assert row.target == expected_target
    assert row.visibility == expected_visibility


def test_error_response_uses_dm_counterpart(db, workspace, monkeypatch):
    _quiet_cloud_side_effects(monkeypatch)
    monkeypatch.setattr(cloud_agent, "SessionLocal", sessionmaker(bind=db.get_bind()))

    asyncio.run(
        cloud_agent._post_error_message(
            workspace["id"],
            {"source": HUMAN, "target": AGENT},
            "test1",
            "provider failed",
        )
    )

    row = db.execute(
        select(EventRecord).where(
            EventRecord.network_id == workspace["id"],
            EventRecord.source == AGENT,
        )
    ).scalar_one()
    assert row.target == HUMAN
    assert row.visibility == "direct"


@pytest.mark.parametrize("kind", ["assistant", "image", "audio"])
def test_other_cloud_invocations_forward_dm_source(monkeypatch, db, workspace, kind):
    """Every cloud response-producing path must carry the trigger source."""
    captured = {}

    async def fake_post_response(*_args, **kwargs):
        captured.update(kwargs)

    monkeypatch.setattr(cloud_agent, "_post_response", fake_post_response)
    event_data = {
        "id": "dm-trigger",
        "source": HUMAN,
        "target": AGENT,
        "payload": {"content": "make something", "message_type": "chat"},
        "timestamp": 100,
    }
    config = _cloud_config(category="image" if kind == "image" else "chat")

    if kind == "assistant":
        from app.services import yumi

        async def fake_tools(**_kwargs):
            return {"role": "assistant", "content": "assistant reply"}

        async def no_context(*_args, **_kwargs):
            return ""

        async def no_members(*_args, **_kwargs):
            return []

        monkeypatch.setattr(cloud_agent, "chat_completion_tools", fake_tools)
        monkeypatch.setattr(yumi, "resolve_model", lambda _cfg: "test-model")
        monkeypatch.setattr(yumi, "resolve_credentials", lambda _cfg: ("test-key", None))
        monkeypatch.setattr(yumi, "workspace_state_summary", no_context)
        monkeypatch.setattr(yumi, "thread_context", no_context)
        monkeypatch.setattr(yumi, "workspace_member_names", no_members)
        monkeypatch.setattr(yumi, "build_tools", lambda: [])
        asyncio.run(
            cloud_agent._invoke_assistant_agent(
                db,
                workspace["id"],
                event_data,
                config,
                depth=0,
            )
        )
    elif kind == "image":

        async def fake_prompt(*_args, **_kwargs):
            return "image prompt"

        async def fake_image(**_kwargs):
            return b"image", "png"

        async def fake_upload(*_args, **_kwargs):
            return "file-id"

        monkeypatch.setattr(cloud_agent, "_compose_image_prompt", fake_prompt)
        monkeypatch.setattr(cloud_agent, "image_generation", fake_image)
        monkeypatch.setattr(cloud_agent, "_upload_image", fake_upload)
        asyncio.run(
            cloud_agent._invoke_image_agent(
                db,
                workspace["id"],
                event_data,
                config,
            )
        )
    else:

        async def fake_audio(**_kwargs):
            return b"audio", "mp3"

        async def fake_upload(*_args, **_kwargs):
            return "file-id"

        monkeypatch.setattr(cloud_agent, "audio_generation", fake_audio)
        monkeypatch.setattr(cloud_agent, "_upload_image", fake_upload)
        asyncio.run(
            cloud_agent._invoke_audio_agent(
                db,
                workspace["id"],
                event_data,
                config,
            )
        )

    assert captured["trigger_source"] == HUMAN
