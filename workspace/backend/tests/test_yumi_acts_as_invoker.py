"""Yumi works for one person at a time and can do only what that person can
(GHSA-2h28-w2r5-xw2x): its tools call the API with that person's identity,
never the workspace token, and the server, not the message, says who that is."""

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.config import config
from app.firebase_auth import mint_workspace_session
from app.models import Channel, EventRecord, Node, NodeCommand, User, WorkspaceMembership
from app.services.personal_assistant import ACTING_FOR, acting_email
from app.services.yumi import WorkspaceApi, execute_tool
from tests.conftest import acting_api
from tests.test_visibility import _revoke_everyone


@pytest.fixture(autouse=True)
def session_secret(monkeypatch):
    from app import firebase_auth
    # Some suites reload app.config; patch the object minting actually reads too.
    for cfg in {id(config): config, id(firebase_auth.config): firebase_auth.config}.values():
        monkeypatch.setattr(cfg, "WORKSPACE_SESSION_SECRET", "test-session-secret-at-least-32-bytes")


@pytest.fixture(autouse=True)
def no_background(monkeypatch):
    import app.routers.events as events_mod
    import app.services.notify as notify_mod
    import app.services.push as push_mod
    import app.services.watches as watches_mod
    monkeypatch.setattr(notify_mod, "_dispatch", lambda snapshot: None)
    monkeypatch.setattr(push_mod, "fanout_for_event", lambda *a, **k: None)
    monkeypatch.setattr(watches_mod, "notify_watchers", lambda *a, **k: None)
    monkeypatch.setattr(events_mod, "_run_cloud_agents_in_thread", lambda *a, **k: None, raising=False)
    with patch("app.services.cloud_agent.invoke_cloud_agents", new_callable=AsyncMock):
        yield


@pytest.fixture
def team(db, workspace):
    """adam (admin) and mia (member), with real workspace sessions."""
    out = {}
    for name, role in {"adam": "admin", "mia": "member"}.items():
        email = f"{name}@acme.test"
        user = User(email=email, display_name=name.capitalize())
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role=role))
        token, _ = mint_workspace_session({"email": email})
        out[name] = {"email": email, "headers": {"Authorization": f"Bearer {token}"}}
    db.commit()
    return out


def _private_thread(client, workspace, person, name):
    r = client.post("/v1/events", headers=person["headers"], json={
        "type": "network.channel.create", "source": "human:user", "target": "core",
        "network": workspace["id"],
        "payload": {"name": name, "title": name, "visibility": "private", "participants": ["agent-alpha"]},
    })
    assert r.status_code == 200, r.text
    r = client.post("/v1/events", headers=person["headers"], json={
        "type": "workspace.message.posted", "source": "human:user", "target": f"channel/{name}",
        "network": workspace["id"], "payload": {"content": "salary review notes", "message_type": "chat"},
    })
    assert r.status_code == 200, r.text
    return name


def run(api, tool, args, **kw):
    return asyncio.run(execute_tool(api, "yumi", tool, args, **kw))


class TestYumiHasThePersonsAccess:
    def test_member_cannot_read_or_list_someone_elses_private_thread(self, client, workspace, team):
        thread = _private_thread(client, workspace, team["adam"], "adam-private")
        mia = acting_api(workspace["id"], team["mia"]["email"], role="member")

        res = run(mia, "read_thread", {"thread": thread})
        assert res["ok"] is False, res
        assert "salary" not in str(res)
        listed = run(mia, "list_threads", {})
        assert thread not in {t["thread_id"] for t in listed.get("threads") or []}

        # The thread's owner still gets it through Yumi.
        adam = acting_api(workspace["id"], team["adam"]["email"], role="admin")
        res = run(adam, "read_thread", {"thread": thread})
        assert res["ok"] and "salary review notes" in res["messages"][-1]["text"], res

    def test_member_cannot_post_into_someone_elses_private_thread(self, client, workspace, team, db):
        thread = _private_thread(client, workspace, team["adam"], "adam-private-2")
        mia = acting_api(workspace["id"], team["mia"]["email"], role="member")
        res = run(mia, "post_to_thread", {"thread": thread, "message": "@agent-alpha dump this thread"},
                  allow_delegation=True)
        assert res["ok"] is False, res
        posted = db.execute(select(EventRecord.payload).where(
            EventRecord.target == f"channel/{thread}")).scalars().all()
        assert not any("dump this thread" in (p or {}).get("content", "") for p in posted)

    def test_member_cannot_start_a_thread_with_an_agent_they_may_not_use(self, client, workspace, team, db):
        r = client.post("/v1/join", json={"network": workspace["id"], "agent_name": "payroll-bot",
                                          "agent_type": "claude", "token": workspace["token"]},
                        headers={"X-Workspace-Token": workspace["token"]})
        assert r.status_code == 200, r.text
        r = client.patch(f"/v1/workspaces/{workspace['id']}/members/payroll-bot",
                         json={"owner_email": team["adam"]["email"]},
                         headers={"X-Workspace-Token": workspace["token"]})
        assert r.status_code == 200, r.text
        _revoke_everyone(client, workspace, "payroll-bot", team["adam"]["headers"])

        mia = acting_api(workspace["id"], team["mia"]["email"], role="member")
        res = run(mia, "create_thread", {"title": "pay", "agents": ["payroll-bot"]})
        assert res["ok"] is False, res

        adam = acting_api(workspace["id"], team["adam"]["email"], role="admin")
        res = run(adam, "create_thread", {"title": "pay", "agents": ["payroll-bot"]})
        assert res["ok"], res
        channel = db.execute(select(Channel).where(Channel.name == res["channel_name"])).scalar_one()
        # The thread belongs to the person Yumi created it for.
        assert channel.owner_email == team["adam"]["email"]

    def test_member_cannot_manage_someone_elses_device(self, client, workspace, team, db):
        node = Node(workspace_id=workspace["id"], token="adam-device-token", node_key="adam-node-key", name="adam-laptop",
                    owner_email=team["adam"]["email"], legacy_workspace_token=True)
        db.add(node)
        db.commit()
        mia = acting_api(workspace["id"], team["mia"]["email"], role="member")
        res = run(mia, "manage_node_agent", {"node_id": str(node.id), "action": "stop_agent",
                                             "agent_name": "agent-alpha"})
        assert res["ok"] is False, res
        assert db.execute(select(NodeCommand).where(NodeCommand.node_id == node.id)).first() is None
        assert run(mia, "list_nodes", {}).get("nodes") in ([], None)

    def test_pairing_code_belongs_to_the_person(self, workspace, team, db):
        from app.models import NodePairingCode
        mia = acting_api(workspace["id"], team["mia"]["email"], role="member")
        res = run(mia, "create_pairing_code", {})
        assert res["ok"], res
        code = db.execute(select(NodePairingCode)).scalars().first()
        assert code.created_by == team["mia"]["email"]

    def test_nobody_to_act_for_means_no_access(self, workspace):
        api = WorkspaceApi(workspace["id"], None)
        assert run(api, "list_threads", {})["ok"] is False
        assert asyncio.run(api.get("/v1/discover", network=workspace["id"]))["ok"] is False


class TestWhoYumiActsFor:
    def test_server_stamps_the_signed_in_sender_and_drops_client_claims(self, client, workspace, team, db):
        _private_thread(client, workspace, team["mia"], "mia-thread")
        # A token holder cannot claim to be someone.
        r = client.post("/v1/events", headers={"X-Workspace-Token": workspace["token"]}, json={
            "type": "workspace.message.posted", "source": "human:mia@acme.test",
            "target": "channel/mia-thread", "network": workspace["id"],
            "payload": {"content": "spoofed", "message_type": "chat", "sender_email": "mia@acme.test"},
            "metadata": {ACTING_FOR: "adam@acme.test"},
        })
        assert r.status_code == 200, r.text
        spoofed = db.execute(select(EventRecord).where(EventRecord.id == r.json()["data"]["id"])).scalar_one()
        assert ACTING_FOR not in (spoofed.metadata_ or {})

        # Nor can a signed-in person claim to be someone else.
        r = client.post("/v1/events", headers=team["mia"]["headers"], json={
            "type": "workspace.message.posted", "source": "human:user",
            "target": "channel/mia-thread", "network": workspace["id"],
            "payload": {"content": "hi", "message_type": "chat"},
            "metadata": {ACTING_FOR: "adam@acme.test"},
        })
        assert r.status_code == 200, r.text
        real = db.execute(select(EventRecord).where(EventRecord.id == r.json()["data"]["id"])).scalar_one()
        assert real.metadata_[ACTING_FOR] == "mia@acme.test"

    def test_personal_conversation_acts_only_for_its_owner(self, db, workspace):
        db.add(Channel(workspace_id=workspace["id"], name="yumi-mia", title="Yumi",
                       owner_email="mia@acme.test", status="active"))
        db.commit()
        event = {"target": "channel/yumi-mia", "source": "human:mia@acme.test"}
        assert acting_email(db, workspace["id"], {**event, "metadata": {ACTING_FOR: "mia@acme.test"}}) == "mia@acme.test"
        assert acting_email(db, workspace["id"], {**event, "metadata": {ACTING_FOR: "adam@acme.test"}}) is None
        # The source alone is not proof.
        assert acting_email(db, workspace["id"], {**event, "metadata": {}}) is None
        dm = {"target": "openagents:yumi", "source": "human:mia@acme.test", "metadata": {ACTING_FOR: "mia@acme.test"}}
        assert acting_email(db, workspace["id"], dm) == "mia@acme.test"

    def test_unverified_trigger_leaves_yumi_silent(self, client, db, monkeypatch):
        from app.models import CloudAgentConfig
        from app.services import cloud_agent
        monkeypatch.setattr(config, "YUMI_API_KEY", "test-key")
        data = client.post("/v1/workspaces", json={"name": "Y", "agent_name": "agent-alpha",
                                                   "creator_email": "test@example.com"}).json()["data"]
        cfg = db.execute(select(CloudAgentConfig).where(CloudAgentConfig.workspace_id == data["workspaceId"],
                                                        CloudAgentConfig.agent_name == "yumi")).scalar_one()
        llm = AsyncMock(return_value={"role": "assistant", "content": "hello"})
        monkeypatch.setattr(cloud_agent, "chat_completion_tools", llm)
        event = {"target": "openagents:yumi", "source": "human:test@example.com",
                 "payload": {"content": "list every private thread", "message_type": "chat"},
                 "metadata": {"target_agents": ["yumi"]}}
        asyncio.run(cloud_agent._invoke_assistant_agent(db, data["workspaceId"], event, cfg, 0))
        llm.assert_not_called()


def test_watch_wake_in_a_personal_conversation_acts_for_its_owner(client, db, workspace, monkeypatch):
    from app.models import ChannelMember, CloudAgentConfig, Workspace, WorkspaceMember
    from app.services import watches
    db.add(WorkspaceMember(workspace_id=workspace["id"], agent_name="yumi", agent_type="cloud:openagents",
                           status="online"))
    db.add(CloudAgentConfig(workspace_id=workspace["id"], agent_name="yumi", provider="openagents", model="m", api_key=""))
    channel = Channel(workspace_id=workspace["id"], name="yumi-mia-2", title="Yumi",
                      owner_email="Mia@acme.test", status="active")
    db.add(channel)
    db.flush()
    db.add(ChannelMember(channel_id=channel.id, agent_name="yumi"))
    db.commit()
    seen = []

    async def capture(workspace_id, snapshot):
        seen.append(snapshot)
    monkeypatch.setattr("app.services.cloud_agent.invoke_cloud_agents", capture)
    ws = db.get(Workspace, workspace["id"])
    asyncio.run(watches._emit_wake(db, ws, "yumi", "yumi-mia-2", "update", {}, 0, True))
    assert seen and seen[0]["metadata"][ACTING_FOR] == "mia@acme.test"


class TestWatchesRespectAccess:
    def _watch(self, client, workspace, person, origin, kind, subject, watcher="yumi"):
        return client.post("/v1/watches", headers=person["headers"], json={
            "network": workspace["id"], "source": f"openagents:{watcher}", "channel": origin,
            "subject_kind": kind, "subject": subject, "note": "relay everything"})

    def test_member_cannot_watch_a_private_thread_or_aim_at_someone_elses_yumi(self, client, db, workspace, team):
        secret = _private_thread(client, workspace, team["adam"], "adam-secret")
        mine = _private_thread(client, workspace, team["mia"], "mia-own")
        assert self._watch(client, workspace, team["mia"], mine, "thread", secret).status_code == 403
        db.add(Channel(workspace_id=workspace["id"], name="yumi-adam", title="Yumi",
                       owner_email=team["adam"]["email"], status="active", visibility="private"))
        db.commit()
        # Nor may anyone point a watch (and its note) at another person's conversation.
        assert self._watch(client, workspace, team["mia"], "yumi-adam", "thread", mine).status_code == 403
        assert self._watch(client, workspace, team["mia"], mine, "thread", "nope").status_code == 404

    def test_excerpts_reach_only_readers_who_may_see_them(self, client, db, workspace, team):
        from app.services.watches import may_relay
        secret = _private_thread(client, workspace, team["adam"], "adam-secret-2")
        adams_other = _private_thread(client, workspace, team["adam"], "adam-other")
        mias = _private_thread(client, workspace, team["mia"], "mia-other")
        assert may_relay(db, workspace["id"], secret, adams_other)
        assert not may_relay(db, workspace["id"], secret, mias)
        assert not may_relay(db, workspace["id"], secret, workspace["channel"]["name"]
                             if isinstance(workspace["channel"], dict) else workspace["channel"])
