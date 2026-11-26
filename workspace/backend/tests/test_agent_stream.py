"""Agent wake-up stream: gated per workspace, content-free, same auth as polls."""

import asyncio
import json
import uuid

import pytest

from app.models import EventRecord
from app.services import agent_stream


@pytest.fixture
def live_on():
    agent_stream.configure_live_stream(True)
    yield
    agent_stream.configure_live_stream(None)


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

    def test_published_for_every_workspace_and_gated_at_connect(self, db, workspace, published):
        agent_stream.configure_allowlist("")
        _write(db, workspace["id"], "workspace.message.posted", "human:a@example.com", "channel/general")
        assert _wakes(published, workspace["id"]) == [{"m": ["human:a@example.com"]}]

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


# ---------------------------------------------------------------------------
# Workspace toggle, panel topics and the web app's live stream
# ---------------------------------------------------------------------------

def _topics(published, workspace_id):
    channel = agent_stream.ui_wake_channel(workspace_id)
    return [json.loads(data)["topics"] for ch, data in published if ch == channel]


class TestPanelTopics:
    def test_messages_wake_discover_and_dms_wake_conversations(self, db, workspace, published):
        _write(db, workspace["id"], "workspace.message.posted", "human:a@example.com", "channel/general")
        db.add(EventRecord(
            id=str(uuid.uuid4()), network_id=workspace["id"], type="workspace.message.posted",
            source="human:a@example.com", target="openagents:bot", payload={}, metadata_={},
            timestamp=1, visibility="direct",
        ))
        db.commit()
        _write(db, workspace["id"], "workspace.user.heartbeat", "human:a@example.com", "network")
        assert _topics(published, workspace["id"]) == [["discover"], ["conversations", "discover"]]

    def test_panel_models_wake_their_topic(self, db, workspace, published):
        from app.models import TodoRecord
        db.add(TodoRecord(workspace_id=workspace["id"], channel_name="general", created_by="openagents:bot",
                          assignee="openagents:bot", content="x"))
        db.commit()
        assert _topics(published, workspace["id"]) == [["todos"]]

    def test_heartbeat_updates_do_not_wake_discover(self, db, workspace, published):
        from datetime import datetime, timezone
        from sqlalchemy import select
        from app.models import WorkspaceMember
        member = db.execute(select(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace["id"])).scalars().first()
        member.last_heartbeat = datetime.now(timezone.utc)
        db.commit()
        assert _topics(published, workspace["id"]) == []
        member.status = "online" if member.status != "online" else "offline"
        db.commit()
        assert _topics(published, workspace["id"]) == [["discover"]]


class TestToggle:
    def _set(self, client, workspace, value):
        return client.patch(f"/v1/workspaces/{workspace['id']}", json={"settings": {"realtime_stream": value}},
                            headers={"X-Workspace-Token": workspace["token"]})

    def test_toggle_enables_streams_for_that_workspace(self, client, workspace, monkeypatch):
        import app.routers.events as events_mod
        from tests.conftest import TestingSessionLocal
        monkeypatch.setattr(agent_stream, "_settings_cache", {})
        monkeypatch.setattr("app.database.SessionLocal", TestingSessionLocal)
        headers = {"X-Workspace-Token": workspace["token"], "X-Agent-Name": "agent-alpha"}
        r = _get_stream(client, workspace, monkeypatch, headers)
        assert r.status_code == 404
        assert self._set(client, workspace, True).status_code == 200   # legacy agent opt-in
        monkeypatch.setattr(agent_stream.hub, "_task", None)
        real = agent_stream.hub.subscribe

        def subscribe(workspace_id, address):
            agent_stream.hub._task = asyncio.get_running_loop().create_future()
            return real(workspace_id, address)
        monkeypatch.setattr(agent_stream.hub, "subscribe", subscribe)
        assert _get_stream(client, workspace, monkeypatch, headers).status_code == 200
        assert self._set(client, workspace, False).status_code == 200
        assert _get_stream(client, workspace, monkeypatch, headers).status_code == 404

    def test_toggle_must_be_boolean(self, client, workspace):
        assert self._set(client, workspace, "yes").status_code == 400

    def test_settings_report_the_server_live_stream_switch(self, client, workspace):
        # Web/desktop clients open the live stream when settings.realtime_stream
        # is true; it mirrors the server switch, not the agent allowlist.
        get = lambda: client.get(f"/v1/workspaces/{workspace['id']}",
                                 headers={"X-Workspace-Token": workspace["token"]}).json()["data"]["settings"]
        try:
            agent_stream.configure_live_stream(True)
            assert get()["realtime_stream"] is True
            agent_stream.configure_live_stream(False)
            agent_stream.configure_allowlist("*")
            assert get()["realtime_stream"] is False
        finally:
            agent_stream.configure_live_stream(None)
            agent_stream.configure_allowlist("")


def test_live_stream_is_on_by_default_with_redis_and_can_be_turned_off(monkeypatch):
    from app import cache
    agent_stream.configure_live_stream(None)
    monkeypatch.delenv("LIVE_STREAM_ENABLED", raising=False)
    monkeypatch.setattr(cache, "_disabled", False)
    assert agent_stream.live_stream_enabled() is True
    monkeypatch.setenv("LIVE_STREAM_ENABLED", "false")
    assert agent_stream.live_stream_enabled() is False
    monkeypatch.delenv("LIVE_STREAM_ENABLED")
    monkeypatch.setattr(cache, "_disabled", True)          # no REDIS_URL: clients keep polling
    assert agent_stream.live_stream_enabled() is False


def test_hub_routes_events_and_panel_topics_to_live_streams():
    async def run():
        hub = agent_stream.WakeHub()
        hub._task = asyncio.get_running_loop().create_future()
        live = hub.subscribe_live("w1")
        agent = hub.subscribe("w1", "openagents:me")
        hub._dispatch(b"ws:w1:events", b'{"id":"e1"}')
        hub._dispatch(b"ws:w1:ui-wake", b'{"topics":["todos"]}')
        hub._dispatch(b"ws:w2:events", b'{"id":"other"}')
        events, topics, resync = await live.wait(0.01)
        assert events == [b'{"id":"e1"}'] and topics == {"todos"} and resync is False
        assert await agent.wait(0.01) == set()  # agents only react to agent-wake
        for _ in range(agent_stream.LiveSubscription.MAX_EVENTS + 1):
            hub._dispatch(b"ws:w1:events", b"{}")
        _, _, resync = await live.wait(0.01)
        assert resync is True
        hub._task.cancel()

    asyncio.run(run())


class TestLiveEndpoint:
    def _get(self, client, workspace, monkeypatch, headers):
        import app.routers.events as events_mod
        from tests.conftest import TestingSessionLocal
        monkeypatch.setattr(events_mod, "SessionLocal", TestingSessionLocal)
        monkeypatch.setattr(events_mod, "LIVE_STREAM_MAX_SECONDS", 0.3)
        monkeypatch.setattr(events_mod, "LIVE_STREAM_JITTER_SECONDS", 0.0)
        monkeypatch.setattr(events_mod, "LIVE_STREAM_KEEPALIVE_SECONDS", 0.1)
        return client.get(f"/v1/events/live?network={workspace['id']}", headers=headers)

    def test_disabled_server_gets_404(self, client, workspace, monkeypatch):
        agent_stream.configure_live_stream(False)
        try:
            r = self._get(client, workspace, monkeypatch, {"X-Workspace-Token": workspace["token"]})
        finally:
            agent_stream.configure_live_stream(None)
        assert r.status_code == 404
        assert r.json()["data"]["reason"] == "live_stream_disabled"

    def test_streams_events_wakes_and_reconnect(self, client, workspace, live_on, monkeypatch):
        monkeypatch.setattr(agent_stream.hub, "_task", None)
        real = agent_stream.hub.subscribe_live

        def subscribe_live(workspace_id):
            agent_stream.hub._task = asyncio.get_running_loop().create_future()
            sub = real(workspace_id)
            sub.deliver("events", json.dumps({"id": "e1", "type": "workspace.message.posted",
                                              "target": "channel/general", "payload": {"content": "hi"}}).encode())
            sub.deliver("ui-wake", b'{"topics":["todos","discover"]}')
            return sub

        monkeypatch.setattr(agent_stream.hub, "subscribe_live", subscribe_live)
        r = self._get(client, workspace, monkeypatch, {"X-Workspace-Token": workspace["token"]})
        assert r.status_code == 200
        assert "id: e1\ndata: " in r.text and '"content": "hi"' in r.text
        assert 'event: wake\ndata: {"topics":["discover","todos"]}' in r.text
        assert r.text.rstrip().endswith("event: reconnect\ndata: {}")
        assert agent_stream.hub.stream_count() == 0
