# -*- coding: utf-8 -*-
"""
Roadmap v1.1 M3/M4/M6 — busy presence, availability, specialist profile,
shared context for teammates' requests, the private-resume guard, and the
structured agent-to-agent hand-off.
"""

from datetime import datetime, timedelta, timezone

import pytest
from app.models import Channel, ChannelMember, Node, WorkspaceMember
from sqlalchemy import select

# Fixtures + helpers shared with the M1 suite (same people, same stubs).
from tests.test_visibility import (  # noqa: F401
    _bearer, _create_thread, _join, _post, _revoke_everyone, _tok, no_push, people,
)


def _heartbeat(client, ws, agent, **fields):
    body = {"agent_name": agent, "network": ws["id"], **fields}
    r = client.post("/v1/heartbeat", json=body, headers=_tok(ws))
    assert r.status_code == 200, r.text
    return r


def _agent(client, ws, name, headers=None):
    d = client.get(f"/v1/discover?network={ws['id']}", headers=headers or _tok(ws)).json()["data"]
    return next(a for a in d["agents"] if a["address"] == f"openagents:{name}")


def _member(db, ws, name):
    return db.execute(select(WorkspaceMember).where(
        WorkspaceMember.workspace_id == ws["id"], WorkspaceMember.agent_name == name)).scalar_one()


def _availability(client, ws, agent, headers=None):
    return client.get(f"/v1/agents/{agent}/availability?network={ws['id']}", headers=headers or _tok(ws))


def _profile(client, ws, agent, headers):
    return client.get(f"/v1/agents/{agent}/profile?network={ws['id']}", headers=headers)


def _shared_context(client, ws, agent, headers, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
    return client.get(f"/v1/agents/{agent}/shared-context?network={ws['id']}&{q}", headers=headers)


def _set_profile(client, ws, agent, **fields):
    r = client.patch(f"/v1/workspaces/{ws['id']}/members/{agent}", json=fields, headers=_tok(ws))
    assert r.status_code == 200, r.text


def _knowledge(client, ws, title, content):
    r = client.post("/v1/knowledge", json={"network": ws["id"], "title": title, "content": content,
                                           "source": "human:user"}, headers=_tok(ws))
    assert r.status_code == 200, r.text
    return r.json()["data"]["slug"]


# ---------------------------------------------------------------------------
# M3 — busy / queued presence via heartbeat
# ---------------------------------------------------------------------------

class TestPresenceHeartbeat:
    def test_heartbeat_fields_reach_discover(self, client, workspace):
        _join(client, workspace, "agent-beta")
        _heartbeat(client, workspace, "agent-beta", presence_state="working",
                   busy_channels=["session-1", "session-2"], queue_depth=3)
        a = _agent(client, workspace, "agent-beta")
        assert a["presence_state"] == "working"
        assert a["busy_channels"] == ["session-1", "session-2"]
        assert a["queue_depth"] == 3

        _heartbeat(client, workspace, "agent-beta", presence_state="idle", busy_channels=[], queue_depth=0)
        a = _agent(client, workspace, "agent-beta")
        assert a["presence_state"] == "idle"
        assert a["busy_channels"] == []
        assert a["queue_depth"] == 0

    def test_old_connector_heartbeat_leaves_presence_untouched(self, client, workspace):
        _join(client, workspace, "agent-beta")
        _heartbeat(client, workspace, "agent-beta", presence_state="working", busy_channels=["s"], queue_depth=1)
        _heartbeat(client, workspace, "agent-beta")  # pre-v1.1 body: no presence fields
        a = _agent(client, workspace, "agent-beta")
        assert (a["presence_state"], a["busy_channels"], a["queue_depth"]) == ("working", ["s"], 1)

    def test_garbage_presence_is_normalised(self, client, workspace):
        _join(client, workspace, "agent-beta")
        _heartbeat(client, workspace, "agent-beta", presence_state="WORKING ", busy_channels=["a", "", "a", " b "], queue_depth=-4)
        a = _agent(client, workspace, "agent-beta")
        assert a["presence_state"] == "working"
        assert a["busy_channels"] == ["a", "b"]
        assert a["queue_depth"] == 0
        r = client.post("/v1/heartbeat", json={"agent_name": "agent-beta", "network": workspace["id"],
                                               "presence_state": "dancing"}, headers=_tok(workspace))
        assert r.status_code == 200
        assert _agent(client, workspace, "agent-beta")["presence_state"] is None


# ---------------------------------------------------------------------------
# M3 — availability reasons
# ---------------------------------------------------------------------------

class TestAvailability:
    def test_unknown_agent_is_404(self, client, workspace):
        assert _availability(client, workspace, "nobody").status_code == 404

    def test_reason_precedence(self, client, workspace, db):
        _join(client, workspace, "agent-beta")
        _heartbeat(client, workspace, "agent-beta", presence_state="idle", busy_channels=[], queue_depth=0)
        d = _availability(client, workspace, "agent-beta").json()["data"]
        assert d["reason"] == "available" and d["status"] == "online"
        assert d["runtime_status"] is None  # manual-token join: no node

        _heartbeat(client, workspace, "agent-beta", presence_state="working", busy_channels=["s-1"], queue_depth=2)
        d = _availability(client, workspace, "agent-beta").json()["data"]
        assert d["reason"] == "busy" and d["busy_channels"] == ["s-1"] and d["queue_depth"] == 2

        # queued but idle still counts as busy
        _heartbeat(client, workspace, "agent-beta", presence_state="idle", busy_channels=[], queue_depth=1)
        assert _availability(client, workspace, "agent-beta").json()["data"]["reason"] == "busy"

        # stale heartbeat → agent offline even though the column still says online
        m = _member(db, workspace, "agent-beta")
        m.last_heartbeat = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
        d = _availability(client, workspace, "agent-beta").json()["data"]
        assert d["reason"] == "agent_offline" and d["status"] == "offline"

        # a dead runtime explains everything else
        node = Node(workspace_id=workspace["id"], node_key="dev-1", name="Mia's laptop", hostname="mia-mbp",
                    status="offline", last_heartbeat=datetime.now(timezone.utc) - timedelta(hours=2))
        db.add(node)
        db.flush()
        m = _member(db, workspace, "agent-beta")
        m.node_id = node.id
        m.last_heartbeat = datetime.now(timezone.utc)
        db.commit()
        d = _availability(client, workspace, "agent-beta").json()["data"]
        assert d["reason"] == "runtime_offline"
        assert d["runtime_status"] == "offline" and d["runtime_name"] == "Mia's laptop"

        # runtime back → the agent's own state decides again
        node = db.execute(select(Node).where(Node.node_key == "dev-1")).scalar_one()
        node.status = "online"
        node.last_heartbeat = datetime.now(timezone.utc)
        db.commit()
        d = _availability(client, workspace, "agent-beta").json()["data"]
        assert d["runtime_status"] == "online" and d["reason"] == "busy"

    def test_hidden_personal_agent_is_404_for_outsiders(self, client, workspace, people):
        _join(client, workspace, "deploy-bot")
        _set_profile(client, workspace, "deploy-bot", owner_email="mia@acme.test")
        _revoke_everyone(client, workspace, "deploy-bot", _tok(workspace))
        assert _availability(client, workspace, "deploy-bot", _bearer("adam", workspace)).status_code == 404
        assert _availability(client, workspace, "deploy-bot", _bearer("mia", workspace)).status_code == 200
        assert _availability(client, workspace, "deploy-bot").status_code == 200


# ---------------------------------------------------------------------------
# M4 — specialist profile
# ---------------------------------------------------------------------------

LONG_INSTRUCTIONS = ("Deploy only to the staging HyperPod cluster. " * 12).strip()  # > 240 chars


@pytest.fixture
def specialist(client, workspace, people):
    _join(client, workspace, "deploy-bot")
    slug = _knowledge(client, workspace, "HyperPod runbook", "# Runbook\n\nkubectl apply -f hyperpod.yaml")
    _set_profile(client, workspace, "deploy-bot",
                 owner_email="mia@acme.test", purpose="Ship models to HyperPod",
                 example_requests=["Deploy the eval model"], required_inputs="model id + cluster",
                 shared_instructions=LONG_INSTRUCTIONS, allowed_knowledge=[slug, "does-not-exist"],
                 cost_owner="owner")
    return {"agent": "deploy-bot", "slug": slug}


class TestProfile:
    def test_owner_sees_everything(self, client, workspace, specialist):
        r = _profile(client, workspace, "deploy-bot", _bearer("mia", workspace))
        assert r.status_code == 200, r.text
        p = r.json()["data"]
        assert p["can_manage"] is True
        assert p["owner_email"] == "mia@acme.test" and p["owner_display_name"] == "Mia"
        assert p["shared_instructions"] == LONG_INSTRUCTIONS
        assert p["allowed_knowledge"] == [{"slug": specialist["slug"], "title": "HyperPod runbook"}]
        assert p["purpose"] == "Ship models to HyperPod"
        assert p["example_requests"] == ["Deploy the eval model"]
        assert p["required_inputs"] == "model id + cluster"
        assert p["cost_owner"] == "owner"
        assert p["grant_count"] == 0
        assert p["availability"]["reason"] in ("available", "agent_offline")
        assert "shared_instructions_summary" not in p

    def test_admin_and_machine_can_manage(self, client, workspace, specialist):
        for h in (_bearer("adam", workspace), _tok(workspace)):
            p = _profile(client, workspace, "deploy-bot", h).json()["data"]
            assert p["can_manage"] is True and p["shared_instructions"] == LONG_INSTRUCTIONS

    def test_teammate_gets_summary_only(self, client, workspace, specialist):
        r = _profile(client, workspace, "deploy-bot", _bearer("vic", workspace))
        assert r.status_code == 200, r.text
        p = r.json()["data"]
        assert p["can_manage"] is False
        assert "shared_instructions" not in p and "allowed_knowledge" not in p
        assert p["shared_instructions_summary"] == LONG_INSTRUCTIONS[:240]
        assert p["allowed_knowledge_count"] == 1
        # public parts of the card are still there
        assert p["purpose"] == "Ship models to HyperPod" and p["owner_email"] == "mia@acme.test"
        assert "availability" in p and "reason" in p["availability"]

    def test_personal_agent_hidden_from_non_grantees(self, client, workspace, specialist, db):
        _revoke_everyone(client, workspace, "deploy-bot", _tok(workspace))
        assert _profile(client, workspace, "deploy-bot", _bearer("vic", workspace)).status_code == 404
        assert _profile(client, workspace, "deploy-bot", _bearer("mia", workspace)).status_code == 200
        assert _profile(client, workspace, "deploy-bot", _tok(workspace)).status_code == 200
        from app.models import ResourceGrant
        db.add(ResourceGrant(workspace_id=workspace["id"], resource_kind="agent", resource_id="deploy-bot",
                             grantee_kind="human", grantee_id="vic@acme.test", rights=["read", "act"],
                             granted_by="mia@acme.test"))
        db.commit()
        r = _profile(client, workspace, "deploy-bot", _bearer("vic", workspace))
        assert r.status_code == 200
        assert r.json()["data"]["grant_count"] == 1 and r.json()["data"]["can_manage"] is False


# ---------------------------------------------------------------------------
# M4 — shared context for the agent's own runs
# ---------------------------------------------------------------------------

class TestSharedContext:
    def test_machine_only(self, client, workspace, specialist):
        r = _shared_context(client, workspace, "deploy-bot", {"Authorization": "Bearer mia"}, requester_email="vic@acme.test")
        assert r.status_code == 403
        r = _shared_context(client, workspace, "deploy-bot", _tok(workspace), requester_email="vic@acme.test")
        assert r.status_code == 200, r.text

    def test_owner_request_does_not_apply(self, client, workspace, specialist):
        d = _shared_context(client, workspace, "deploy-bot", _tok(workspace), requester_email="Mia@Acme.test").json()["data"]
        assert d["apply"] is False
        assert d["owner_email"] == "mia@acme.test" and d["requester_email"] == "mia@acme.test"
        assert d["shared_instructions"] is None and d["allowed_knowledge"] == []

    def test_teammate_request_applies_with_knowledge_content(self, client, workspace, specialist):
        d = _shared_context(client, workspace, "deploy-bot", _tok(workspace), requester_email="vic@acme.test").json()["data"]
        assert d["apply"] is True
        assert d["shared_instructions"] == LONG_INSTRUCTIONS
        assert d["cost_owner"] == "owner"
        assert [k["slug"] for k in d["allowed_knowledge"]] == [specialist["slug"]]
        assert "kubectl apply" in d["allowed_knowledge"][0]["content"]
        assert d["allowed_knowledge"][0]["title"] == "HyperPod runbook"

    def test_unowned_agent_never_applies(self, client, workspace, people):
        _join(client, workspace, "free-bot")
        _set_profile(client, workspace, "free-bot", shared_instructions="x")
        d = _shared_context(client, workspace, "free-bot", _tok(workspace), requester_email="vic@acme.test").json()["data"]
        assert d["apply"] is False

    def test_director_who_is_not_owner_applies(self, client, workspace, specialist):
        # vic opened (and therefore directs) the thread; the owner's own message
        # there is still a shared request.
        _create_thread(client, workspace, name="vic-thread", by="vic", visibility="workspace")
        d = _shared_context(client, workspace, "deploy-bot", _tok(workspace),
                            requester_email="mia@acme.test", channel="vic-thread").json()["data"]
        assert d["apply"] is True and d["director_email"] == "vic@acme.test"
        # the owner's own thread, owner asking → private context is fine
        _create_thread(client, workspace, name="mia-thread", by="mia", visibility="workspace")
        d = _shared_context(client, workspace, "deploy-bot", _tok(workspace),
                            requester_email="mia@acme.test", channel="mia-thread").json()["data"]
        assert d["apply"] is False

    def test_knowledge_budget_is_capped(self, client, workspace, people, monkeypatch):
        import app.routers.agent_profile as ap
        monkeypatch.setattr(ap, "SHARED_KNOWLEDGE_CAP", 30)
        _join(client, workspace, "cap-bot")
        s1 = _knowledge(client, workspace, "Doc one", "A" * 25)
        s2 = _knowledge(client, workspace, "Doc two", "B" * 25)
        _set_profile(client, workspace, "cap-bot", owner_email="mia@acme.test", allowed_knowledge=[s1, s2])
        d = _shared_context(client, workspace, "cap-bot", _tok(workspace), requester_email="vic@acme.test").json()["data"]
        assert [len(k["content"]) for k in d["allowed_knowledge"]] == [25, 5]
        assert d["allowed_knowledge"][1]["truncated"] is True


# ---------------------------------------------------------------------------
# M4 — a shared request never resumes from a private thread
# ---------------------------------------------------------------------------

def _create_resuming(client, ws, *, name, by, resume_from, humans=None, source=None, sender_email=True):
    payload = {"name": name, "title": name, "resume_from": resume_from, "participants": ["agent-alpha"]}
    if sender_email:
        payload["sender_email"] = f"{by}@acme.test"
    if humans is not None:
        payload["human_participants"] = humans
    return client.post("/v1/events", json={
        "type": "network.channel.create", "source": source or f"human:{by}", "target": "core",
        "network": ws["id"], "payload": payload,
    }, headers=_tok(ws))


class TestPrivateResumeGuard:
    def test_outsider_cannot_resume_private_thread(self, client, workspace, people, db):
        _create_thread(client, workspace, name="secret-r", by="mia")
        r = _create_resuming(client, workspace, name="leak-1", by="adam", resume_from="secret-r")
        assert r.status_code in (401, 403), r.text
        assert "private_resume" in r.text
        assert db.execute(select(Channel).where(Channel.name == "leak-1")).scalar_one_or_none() is None

    def test_participant_can_resume_alone_but_not_with_outsiders(self, client, workspace, people, db):
        _create_thread(client, workspace, name="secret-r2", by="mia")
        r = _create_resuming(client, workspace, name="ok-1", by="mia", resume_from="secret-r2")
        assert r.status_code == 200, r.text
        assert db.execute(select(Channel).where(Channel.name == "ok-1")).scalar_one().resume_from == "secret-r2"
        r = _create_resuming(client, workspace, name="leak-2", by="mia", resume_from="secret-r2", humans=["adam@acme.test"])
        assert r.status_code in (401, 403), r.text
        # everyone in the new thread is in the private one → fine
        from app.models import ChannelHumanMember
        ch = db.execute(select(Channel).where(Channel.name == "secret-r2")).scalar_one()
        db.add(ChannelHumanMember(channel_id=ch.id, user_email="adam@acme.test"))
        db.commit()
        r = _create_resuming(client, workspace, name="ok-2", by="mia", resume_from="secret-r2", humans=["adam@acme.test"])
        assert r.status_code == 200, r.text

    def test_unidentified_human_creator_is_refused(self, client, workspace, people):
        _create_thread(client, workspace, name="secret-r3", by="mia")
        r = _create_resuming(client, workspace, name="leak-3", by="mia", resume_from="secret-r3", sender_email=False)
        assert r.status_code in (401, 403), r.text

    def test_workspace_thread_resume_is_unaffected(self, client, workspace, people):
        _create_thread(client, workspace, name="open-r", by="mia", visibility="workspace")
        r = _create_resuming(client, workspace, name="ok-3", by="adam", resume_from="open-r")
        assert r.status_code == 200, r.text


# ---------------------------------------------------------------------------
# M6 — structured hand-off routing
# ---------------------------------------------------------------------------

def _handoff_payload(frm, to, request, **extra):
    h = {"from": frm, "to": to, "request": request, "context": extra.get("context"),
         "output": extra.get("output"), "next_owner": extra.get("next_owner")}
    content = f"@{to} {request}"
    if h["context"]:
        content += f"\n\nContext:\n{h['context']}"
    if h["output"]:
        content += f"\n\nOutput so far:\n{h['output']}"
    if h["next_owner"]:
        content += f"\n\nNext owner: {h['next_owner']}"
    return {"content": content, "message_type": "chat", "handoff": h}, {"handoff": h}


class TestHandoffRouting:
    def _post_handoff(self, client, ws, channel, frm, to, metadata_extra=None):
        payload, metadata = _handoff_payload(frm, to, "please deploy the eval model",
                                             context="model id m-42, cluster staging",
                                             output="artifacts uploaded to /files/eval.tgz",
                                             next_owner=to)
        metadata.update(metadata_extra or {})
        return client.post("/v1/events", json={
            "type": "workspace.message.posted", "source": f"openagents:{frm}",
            "target": f"channel/{channel}", "network": ws["id"], "payload": payload, "metadata": metadata,
        }, headers=_tok(ws))

    def test_leading_mention_handoff_targets_and_adds_member(self, client, workspace, db):
        _join(client, workspace, "agent-beta")
        ch = workspace["channel"]["name"]
        r = self._post_handoff(client, workspace, ch, "agent-alpha", "agent-beta")
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["metadata"]["target_agents"] == ["agent-beta"]
        assert data["metadata"]["handoff"]["next_owner"] == "agent-beta"
        assert data["payload"]["handoff"]["to"] == "agent-beta"
        channel = db.execute(select(Channel).where(Channel.workspace_id == workspace["id"], Channel.name == ch)).scalar_one()
        members = set(db.execute(select(ChannelMember.agent_name).where(ChannelMember.channel_id == channel.id)).scalars().all())
        assert "agent-beta" in members

    def test_declared_explicit_targets_also_route(self, client, workspace, db):
        _join(client, workspace, "agent-beta")
        ch = workspace["channel"]["name"]
        r = self._post_handoff(client, workspace, ch, "agent-alpha", "agent-beta", {"explicit_targets": ["agent-beta"]})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["metadata"]["target_agents"] == ["agent-beta"]

    def test_handoff_survives_in_event_log(self, client, workspace):
        _join(client, workspace, "agent-beta")
        ch = workspace["channel"]["name"]
        self._post_handoff(client, workspace, ch, "agent-alpha", "agent-beta")
        r = client.get(f"/v1/events?network={workspace['id']}&channel={ch}&type=workspace.message&sort=desc&limit=50",
                       headers=_tok(workspace))
        assert r.status_code == 200
        handoffs = [e for e in r.json()["data"]["events"] if (e.get("payload") or {}).get("handoff")]
        assert len(handoffs) == 1
        assert handoffs[0]["payload"]["handoff"]["request"] == "please deploy the eval model"
