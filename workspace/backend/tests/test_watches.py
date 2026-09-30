# -*- coding: utf-8 -*-
"""Agent watches — bounded subscriptions that bring news back to the origin thread.

The service opens sessions via its module-level ``SessionLocal`` (patched to
the shared in-memory SQLite here, like the integrations tests). Cloud-agent
invocation is stubbed to record calls: the point is that the wake-up lands in
the origin thread targeted at the watcher and that the assistant gets invoked.
"""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

import app.services.cloud_agent as cloud_agent
import app.services.watches as svc
from app.models import AgentWatch, EventRecord, KanbanTask
from tests.conftest import TestingSessionLocal


@pytest.fixture(autouse=True)
def _patch_service_db(monkeypatch):
    monkeypatch.setattr(svc, "SessionLocal", TestingSessionLocal)


@pytest.fixture
def invoked(monkeypatch):
    """Record cloud-agent invocations instead of running an LLM."""
    calls = []

    async def fake_invoke(workspace_id, snapshot):
        calls.append((workspace_id, snapshot))

    monkeypatch.setattr(cloud_agent, "invoke_cloud_agents", fake_invoke)
    return calls


@pytest.fixture
def quiet_background(monkeypatch):
    """Stub the other post-event hooks that need a real DATABASE_URL."""
    import app.services.campaign as campaign
    import app.services.integrations as integrations
    import app.services.push as push
    import app.services.workflow as workflow

    def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(push, "fanout_for_event", noop)
    monkeypatch.setattr(workflow, "advance_workflow", noop)
    monkeypatch.setattr(integrations, "relay_for_event", noop)
    monkeypatch.setattr(campaign, "on_agent_message", noop)


def _hdr(ws):
    return {"X-Workspace-Token": ws["token"]}


def _make_thread(client, ws, title, participants, master=None):
    payload = {"title": title, "participants": participants}
    if master:
        payload["master"] = master
    r = client.post("/v1/events", json={
        "type": "network.channel.create", "source": "human:raphael", "target": "core",
        "payload": payload, "metadata": {}, "network": ws["id"],
    }, headers=_hdr(ws))
    assert r.status_code == 200, r.text
    return r.json()["data"]["metadata"]["channel_name"]


def _join(client, ws, name):
    r = client.post("/v1/join", json={
        "agent_name": name, "token": ws["token"], "network": ws["id"], "agent_type": "claude",
    })
    assert r.status_code == 200, r.text


def _events(client, ws, ch, limit=10):
    r = client.get(
        f"/v1/events?network={ws['id']}&channel={ch}&type=workspace.message.posted"
        f"&sort=desc&limit={limit}", headers=_hdr(ws),
    )
    d = r.json()["data"]
    return d if isinstance(d, list) else d.get("events", [])


def _create_watch(client, ws, origin, kind, subject, watcher="yumi", **extra):
    body = {"network": ws["id"], "source": f"openagents:{watcher}", "channel": origin,
            "subject_kind": kind, "subject": subject, "note": "relay to Li Lei", **extra}
    return client.post("/v1/watches", json=body, headers=_hdr(ws))


def _agent_event(ch, sender="agent-alpha", content="Report is ready.", **meta):
    return {
        "id": "evt-1", "type": "workspace.message.posted",
        "source": f"openagents:{sender}", "target": f"channel/{ch}",
        "payload": {"content": content, "message_type": "chat"},
        "metadata": meta, "timestamp": 1,
    }


@pytest.fixture
def setup(client, workspace):
    """Two threads: origin (yumi + human) and work (agent-alpha)."""
    _join(client, workspace, "yumi")
    origin = _make_thread(client, workspace, "Feishu: Li Lei", ["yumi"], master="yumi")
    work = _make_thread(client, workspace, "Sales report", ["agent-alpha"], master="agent-alpha")
    return {"origin": origin, "work": work}


# ---------------------------------------------------------------------------
# REST API
# ---------------------------------------------------------------------------

class TestApi:
    def test_create_list_stop(self, client, workspace, setup):
        r = _create_watch(client, workspace, setup["origin"], "thread", setup["work"], minutes=30)
        assert r.status_code == 200, r.text
        w = r.json()["data"]["watch"]
        assert w["status"] == "active" and w["fires"] == 0 and w["max_fires"] == 10
        exp = datetime.fromisoformat(w["expires_at"])
        assert timedelta(minutes=29) < exp - datetime.now(timezone.utc) < timedelta(minutes=31)

        r = client.get("/v1/watches", params={"network": workspace["id"], "source": "openagents:yumi"},
                       headers=_hdr(workspace))
        assert [x["id"] for x in r.json()["data"]["watches"]] == [w["id"]]

        r = client.delete(f"/v1/watches/{w['id']}", params={"network": workspace["id"]},
                          headers=_hdr(workspace))
        assert r.status_code == 200 and r.json()["data"]["status"] == "stopped"
        r = client.get("/v1/watches", params={"network": workspace["id"]}, headers=_hdr(workspace))
        assert r.json()["data"]["watches"] == []

    def test_requires_token(self, client, workspace, setup):
        body = {"network": workspace["id"], "source": "openagents:yumi", "channel": setup["origin"],
                "subject_kind": "thread", "subject": setup["work"]}
        assert client.post("/v1/watches", json=body).status_code == 401

    def test_validation(self, client, workspace, setup):
        assert _create_watch(client, workspace, setup["origin"], "thread", "nope-thread").status_code == 404
        assert _create_watch(client, workspace, setup["origin"], "agent", "nobody").status_code == 404
        assert _create_watch(client, workspace, setup["origin"], "thread", setup["origin"]).status_code == 400
        assert _create_watch(client, workspace, setup["origin"], "agent", "yumi").status_code == 400
        # Clamped, not rejected.
        r = _create_watch(client, workspace, setup["origin"], "agent", "agent-alpha", minutes=99999, max_fires=999)
        assert r.status_code == 200
        w = r.json()["data"]["watch"]
        assert w["max_fires"] == svc.MAX_MAX_FIRES
        assert datetime.fromisoformat(w["expires_at"]) - datetime.now(timezone.utc) < timedelta(hours=24, minutes=1)

    def test_rearm_refreshes_in_place(self, client, workspace, setup):
        first = _create_watch(client, workspace, setup["origin"], "thread", setup["work"], minutes=5)
        again = _create_watch(client, workspace, setup["origin"], "thread", setup["work"], minutes=60)
        assert again.json()["data"]["refreshed"] is True
        assert again.json()["data"]["watch"]["id"] == first.json()["data"]["watch"]["id"]
        r = client.get("/v1/watches", params={"network": workspace["id"]}, headers=_hdr(workspace))
        assert len(r.json()["data"]["watches"]) == 1

    def test_active_cap(self, client, workspace, setup, monkeypatch):
        monkeypatch.setattr(svc, "MAX_ACTIVE_PER_WATCHER", 1)
        assert _create_watch(client, workspace, setup["origin"], "thread", setup["work"]).status_code == 200
        assert _create_watch(client, workspace, setup["origin"], "agent", "agent-alpha").status_code == 400


# ---------------------------------------------------------------------------
# notify_watchers hook
# ---------------------------------------------------------------------------

class TestNotify:
    def test_thread_watch_wakes_watcher_in_origin(self, client, workspace, setup, invoked):
        _create_watch(client, workspace, setup["origin"], "thread", setup["work"])
        svc.notify_watchers(workspace["id"], _agent_event(setup["work"], status_kind="completed"))

        wake = _events(client, workspace, setup["origin"])[0]
        assert wake["source"] == "system:watch"
        assert wake["metadata"]["target_agents"] == ["yumi"]
        assert wake["metadata"]["watch"]["subject_thread"] == setup["work"]
        assert wake["metadata"]["watch"]["kind"] == "completed"
        assert wake["metadata"]["cloud_agent_depth"] == 1
        content = wake["payload"]["content"]
        assert content.startswith("👀 Watch update")
        assert "agent-alpha" in content and "Sales report" in content
        assert "Report is ready." in content and "relay to Li Lei" in content

        # The assistant is invoked with the wake-up snapshot.
        assert len(invoked) == 1 and invoked[0][1]["source"] == "system:watch"

        db = TestingSessionLocal()
        try:
            w = db.execute(select(AgentWatch)).scalar_one()
            assert w.fires == 1 and w.status == "active" and w.last_fired_at is not None
        finally:
            db.close()

    def test_agent_watch_matches_any_thread(self, client, workspace, setup, invoked):
        other = _make_thread(client, workspace, "Elsewhere", ["agent-alpha"], master="agent-alpha")
        _create_watch(client, workspace, setup["origin"], "agent", "agent-alpha")
        svc.notify_watchers(workspace["id"], _agent_event(other, content="done elsewhere"))
        wake = _events(client, workspace, setup["origin"])[0]
        assert wake["source"] == "system:watch" and "done elsewhere" in wake["payload"]["content"]
        assert wake["metadata"]["watch"]["kind"] == "reply"

    def test_thread_and_agent_watch_coalesce_into_one_wake(self, client, workspace, setup, invoked):
        _create_watch(client, workspace, setup["origin"], "thread", setup["work"])
        _create_watch(client, workspace, setup["origin"], "agent", "agent-alpha")
        svc.notify_watchers(workspace["id"], _agent_event(setup["work"]))
        wakes = [e for e in _events(client, workspace, setup["origin"]) if e["source"] == "system:watch"]
        assert len(wakes) == 1
        assert len(wakes[0]["metadata"]["watch"]["ids"]) == 2
        assert len(invoked) == 1

    def test_guards(self, client, workspace, setup, invoked):
        _create_watch(client, workspace, setup["origin"], "thread", setup["work"])
        _create_watch(client, workspace, setup["origin"], "agent", "agent-alpha")
        ignored = [
            # human message in the watched thread
            {**_agent_event(setup["work"]), "source": "human:raphael"},
            # status / thinking chatter
            {**_agent_event(setup["work"]), "payload": {"content": "Bash › ls", "message_type": "status"}},
            {**_agent_event(setup["work"]), "payload": {"content": "hmm", "message_type": "thinking"}},
            # the watcher's own message
            _agent_event(setup["work"], sender="yumi"),
            # a wake-up itself must never re-match
            _agent_event(setup["work"], watch={"ids": ["x"]}),
            # activity in the origin thread (watcher already sees it)
            _agent_event(setup["origin"]),
            # empty content
            {**_agent_event(setup["work"]), "payload": {"content": "  ", "message_type": "chat"}},
            # other event types
            {**_agent_event(setup["work"]), "type": "network.channel.join"},
        ]
        for ev in ignored:
            svc.notify_watchers(workspace["id"], ev)
        assert invoked == []
        assert not [e for e in _events(client, workspace, setup["origin"]) if e["source"] == "system:watch"]

    def test_error_kind_and_max_fires(self, client, workspace, setup, invoked):
        _create_watch(client, workspace, setup["origin"], "thread", setup["work"], max_fires=2)
        svc.notify_watchers(workspace["id"], _agent_event(setup["work"], content="boom", status_kind="error"))
        assert _events(client, workspace, setup["origin"])[0]["metadata"]["watch"]["kind"] == "error"
        svc.notify_watchers(workspace["id"], _agent_event(setup["work"]))
        svc.notify_watchers(workspace["id"], _agent_event(setup["work"]))  # exhausted → no third wake
        wakes = [e for e in _events(client, workspace, setup["origin"]) if e["source"] == "system:watch"]
        assert len(wakes) == 2 and len(invoked) == 2
        db = TestingSessionLocal()
        try:
            assert db.execute(select(AgentWatch)).scalar_one().status == "exhausted"
        finally:
            db.close()

    def test_task_thread_reports_column(self, client, workspace, setup, invoked, db):
        task_ch = _make_thread(client, workspace, "hidden", ["agent-alpha"], master="agent-alpha")
        # Rename to a task thread and attach a Kanban card in Need Input.
        from app.models import Channel
        ch = db.execute(select(Channel).where(Channel.name == task_ch)).scalar_one()
        ch.name = "task:abc"
        db.add(KanbanTask(workspace_id=workspace["id"], title="Ship it", status="need_input",
                          assignee="agent-alpha", created_by="human:raphael", channel_name="task:abc"))
        db.commit()
        _create_watch(client, workspace, setup["origin"], "thread", "task:abc")
        svc.notify_watchers(workspace["id"], _agent_event("task:abc", content="Which region?"))
        wake = _events(client, workspace, setup["origin"])[0]
        assert "need input" in wake["metadata"]["watch"]["kind"]
        assert "Ship it" in wake["payload"]["content"]

    def test_expired_watch_does_not_fire(self, client, workspace, setup, invoked, db):
        _create_watch(client, workspace, setup["origin"], "thread", setup["work"])
        w = db.execute(select(AgentWatch)).scalar_one()
        w.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()
        svc.notify_watchers(workspace["id"], _agent_event(setup["work"]))
        assert invoked == []

    def test_route_hook_fires_end_to_end(self, client, workspace, setup, invoked, quiet_background):
        """Posting an agent reply through POST /v1/events wakes the watcher."""
        _create_watch(client, workspace, setup["origin"], "thread", setup["work"])
        r = client.post("/v1/events", json={
            "type": "workspace.message.posted", "source": "openagents:agent-alpha",
            "target": f"channel/{setup['work']}",
            "payload": {"content": "All done.", "message_type": "chat"},
            "metadata": {}, "network": workspace["id"],
        }, headers=_hdr(workspace))
        assert r.status_code == 200, r.text
        wake = _events(client, workspace, setup["origin"])[0]
        assert wake["source"] == "system:watch" and "All done." in wake["payload"]["content"]
        # The route also invokes cloud agents for the original message; the
        # wake-up must be exactly one extra invocation.
        assert [s["source"] for _, s in invoked if s["source"] == "system:watch"] == ["system:watch"]


# ---------------------------------------------------------------------------
# Expiry sweep
# ---------------------------------------------------------------------------

class TestExpiry:
    def _expire(self, watch_id, db):
        w = db.get(AgentWatch, watch_id)
        w.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()

    def test_silent_watch_gets_final_wake(self, client, workspace, setup, invoked, db):
        wid = _create_watch(client, workspace, setup["origin"], "thread", setup["work"]).json()["data"]["watch"]["id"]
        self._expire(wid, db)

        async def run():
            n = await svc.expire_due(db)
            await asyncio.sleep(0)  # let the scheduled invoke task run
            return n

        assert asyncio.run(run()) == 1
        db.expire_all()
        assert db.get(AgentWatch, wid).status == "expired"
        wake = _events(client, workspace, setup["origin"])[0]
        assert wake["source"] == "system:watch" and wake["payload"]["content"].startswith("⌛ Watch expired")
        assert wake["metadata"]["watch"]["kind"] == "expired"
        assert len(invoked) == 1

    def test_fired_watch_expires_quietly(self, client, workspace, setup, invoked, db):
        wid = _create_watch(client, workspace, setup["origin"], "thread", setup["work"]).json()["data"]["watch"]["id"]
        svc.notify_watchers(workspace["id"], _agent_event(setup["work"]))
        assert len(invoked) == 1
        self._expire(wid, db)
        assert asyncio.run(svc.expire_due(db)) == 1
        db.expire_all()
        assert db.get(AgentWatch, wid).status == "expired"
        assert len(invoked) == 1  # no second wake
        assert asyncio.run(svc.expire_due(db)) == 0


# ---------------------------------------------------------------------------
# Yumi tools + context
# ---------------------------------------------------------------------------

class TestYumiTools:
    def test_watch_list_stop_via_tools(self, client, workspace, setup):
        from app.services.yumi import WorkspaceApi, execute_tool
        api = WorkspaceApi(workspace["id"], workspace["token"])

        res = asyncio.run(execute_tool(api, "yumi", "watch_thread",
                                       {"thread": setup["work"], "note": "relay to Li Lei", "minutes": 45},
                                       channel_name=setup["origin"]))
        assert res["ok"], res
        assert res["watching"] == f"thread {setup['work']}" and "Armed" in res["note"]
        wid = res["watch_id"]

        res = asyncio.run(execute_tool(api, "yumi", "watch_agent",
                                       {"agent": "agent-alpha", "note": "any result"},
                                       channel_name=setup["origin"]))
        assert res["ok"], res

        # Refuses the current thread and outside-of-thread use.
        assert asyncio.run(execute_tool(api, "yumi", "watch_thread",
                                        {"thread": setup["origin"], "note": "x"},
                                        channel_name=setup["origin"]))["ok"] is False
        assert asyncio.run(execute_tool(api, "yumi", "watch_thread",
                                        {"thread": setup["work"], "note": "x"}))["ok"] is False

        res = asyncio.run(execute_tool(api, "yumi", "list_watches", {}))
        assert {w["subject"] for w in res["watches"]} == {setup["work"], "agent-alpha"}

        res = asyncio.run(execute_tool(api, "yumi", "stop_watch", {"watch_id": wid}))
        assert res["ok"] and res["status"] == "stopped"
        res = asyncio.run(execute_tool(api, "yumi", "list_watches", {}))
        assert [w["subject"] for w in res["watches"]] == ["agent-alpha"]

    def test_tools_are_advertised(self):
        from app.services.yumi import build_tools
        names = {t["function"]["name"] for t in build_tools()}
        assert {"watch_thread", "watch_agent", "list_watches", "stop_watch"} <= names

    def test_bridged_thread_context(self, client, workspace):
        from app.services.yumi import WorkspaceApi, bridged_thread_context, thread_context
        assert bridged_thread_context("channel-abc") == ""
        assert bridged_thread_context(None) == ""
        block = bridged_thread_context("ext-lark-12345678-oc_1")
        assert "FRONT DESK" in block and "Feishu/Lark" in block and "watch_thread" in block
        assert "Slack" in bridged_thread_context("ext-slack-12345678-D0AAA")

        _join(client, workspace, "yumi")
        api = WorkspaceApi(workspace["id"], workspace["token"])
        ch = _make_thread(client, workspace, "Plain", ["yumi"], master="yumi")
        # A watch wake-up is flagged as automated in the live thread block.
        ctx = asyncio.run(thread_context(api, ch, "system:watch", {}))
        assert "automated Watch update" in ctx
        ctx = asyncio.run(thread_context(api, ch, "human:raphael",
                                         {"sender_display_name": "Raphael"}))
        assert "talking with: Raphael" in ctx and "Watch update" not in ctx

    def test_system_sources_are_labelled_as_system(self):
        from app.services.cloud_agent import speaker_label
        assert speaker_label("system:watch", {}) == "system:watch"
        assert speaker_label("system:timer", {"sender_display_name": "x"}) == "system:timer"
        assert speaker_label("human:a", {"sender_display_name": "Raphael"}) == "Raphael"
