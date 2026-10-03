# -*- coding: utf-8 -*-
"""
Roadmap v1.1 M1 — private threads and personal agents.

A signed-in person must not see (list, read, search, be notified about, post
into) a private thread they are not a participant of, nor see or address a
personal agent they were not granted. Machines (token-only callers) are
exempt: isolation is between people.
"""

import app.access as access
import pytest
from app.models import Channel, ChannelHumanMember, ResourceGrant, User, WorkspaceMembership
from app.services.notify import notify
from sqlalchemy import select


@pytest.fixture(autouse=True)
def no_push(monkeypatch):
    import app.services.notify as notify_mod
    import app.services.push as push_mod
    monkeypatch.setattr(notify_mod, "_dispatch", lambda snapshot: None)
    # The post-commit push fan-out opens its own engine (real Postgres); keep
    # the unit tests on SQLite.
    monkeypatch.setattr(push_mod, "fanout_for_event", lambda *a, **k: None)
    # Post-message background hooks that open their own SessionLocal (real
    # Postgres): cloud-agent invocation, Slack relay, watches. Not under test.
    import app.routers.events as events_mod
    import app.services.cloud_agent as cloud_mod
    import app.services.integrations as integ_mod
    import app.services.watches as watches_mod
    noop = lambda *a, **k: None  # noqa: E731
    for mod, name in ((events_mod, "invoke_cloud_agents"), (cloud_mod, "invoke_cloud_agents"),
                      (integ_mod, "relay_for_event"), (watches_mod, "notify_watchers")):
        if hasattr(mod, name):
            monkeypatch.setattr(mod, name, noop)


def _claims(email, name=None):
    return {"provider": "firebase", "email": email, "firebase_uid": email,
            "apple_sub": None, "display_name": name or email.split("@")[0]}


@pytest.fixture
def people(db, workspace, monkeypatch):
    mapping = {}
    for name, role in {"adam": "admin", "mia": "member", "vic": "viewer"}.items():
        email = f"{name}@acme.test"
        user = User(email=email, display_name=name.capitalize())
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role=role))
        mapping[name] = _claims(email, name.capitalize())
    db.commit()
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: mapping.get(tok))
    return mapping


def _tok(ws):
    return {"X-Workspace-Token": ws["token"]}


def _bearer(name, ws=None):
    h = {"Authorization": f"Bearer {name}"}
    if ws:  # the web client sends both — identity must still win
        h.update(_tok(ws))
    return h


def _create_thread(client, ws, *, name, by, visibility="private"):
    r = client.post("/v1/events", json={
        "type": "network.channel.create",
        "source": f"human:{by}",
        "target": "core",
        "network": ws["id"],
        "payload": {"name": name, "title": name, "visibility": visibility,
                    "sender_email": f"{by}@acme.test", "participants": ["agent-alpha"]},
    }, headers=_tok(ws))
    assert r.status_code == 200, r.text
    return name


def _post(client, ws, *, channel, by, content, headers=None):
    return client.post("/v1/events", json={
        "type": "workspace.message.posted",
        "source": f"human:{by}",
        "target": f"channel/{channel}",
        "network": ws["id"],
        "payload": {"content": content, "sender_email": f"{by}@acme.test", "message_type": "chat"},
    }, headers=headers or _tok(ws))


def _discover(client, ws, headers):
    r = client.get(f"/v1/discover?network={ws['id']}", headers=headers)
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    return {c["address"].split("/", 1)[1] for c in d["channels"]}, {a["address"].split(":", 1)[1] for a in d["agents"]}


# ---------------------------------------------------------------------------
# Private threads
# ---------------------------------------------------------------------------

class TestPrivateThreads:
    def test_creator_is_first_participant(self, client, workspace, people, db):
        _create_thread(client, workspace, name="secret-1", by="mia")
        ch = db.execute(select(Channel).where(Channel.name == "secret-1")).scalar_one()
        assert ch.visibility == "private"
        assert ch.director_email == "mia@acme.test"
        emails = db.execute(select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == ch.id)).scalars().all()
        assert emails == ["mia@acme.test"]

    def test_discover_hides_private_thread_from_non_participants(self, client, workspace, people):
        _create_thread(client, workspace, name="secret-2", by="mia")
        mia_ch, _ = _discover(client, workspace, _bearer("mia", workspace))
        adam_ch, _ = _discover(client, workspace, _bearer("adam", workspace))
        machine_ch, _ = _discover(client, workspace, _tok(workspace))
        assert "secret-2" in mia_ch
        assert "secret-2" not in adam_ch, "an admin who is not a participant must not see a private thread"
        assert "secret-2" in machine_ch

    def test_workspace_thread_stays_visible_to_everyone(self, client, workspace, people):
        _create_thread(client, workspace, name="open-1", by="mia", visibility="workspace")
        adam_ch, _ = _discover(client, workspace, _bearer("adam", workspace))
        assert "open-1" in adam_ch

    def test_events_read_is_denied_and_excluded(self, client, workspace, people):
        _create_thread(client, workspace, name="secret-3", by="mia")
        assert _post(client, workspace, channel="secret-3", by="mia", content="the launch codes").status_code == 200
        # single-thread read
        r = client.get(f"/v1/events?network={workspace['id']}&channel=secret-3", headers=_bearer("adam", workspace))
        assert r.status_code == 403
        r = client.get(f"/v1/events?network={workspace['id']}&channel=secret-3", headers=_bearer("mia", workspace))
        assert r.status_code == 200 and any("launch codes" in (e["payload"] or {}).get("content", "") for e in r.json()["data"]["events"])
        # cross-thread read + search
        for extra in ("", "&search=launch"):
            r = client.get(f"/v1/events?network={workspace['id']}&type=workspace.message{extra}", headers=_bearer("adam", workspace))
            assert r.status_code == 200
            assert not any(e["target"] == "channel/secret-3" for e in r.json()["data"]["events"])
        r = client.get(f"/v1/events?network={workspace['id']}&type=workspace.message&search=launch", headers=_tok(workspace))
        assert any(e["target"] == "channel/secret-3" for e in r.json()["data"]["events"])

    def test_non_participant_cannot_post(self, client, workspace, people):
        _create_thread(client, workspace, name="secret-4", by="mia")
        r = _post(client, workspace, channel="secret-4", by="adam", content="hi", headers=_bearer("adam", workspace))
        assert r.status_code == 403
        # token-only client that still identifies the sender is stopped in the pipeline
        r = _post(client, workspace, channel="secret-4", by="adam", content="hi")
        assert r.status_code in (401, 403), r.text

    def test_participant_can_open_thread_admin_cannot_touch_it(self, client, workspace, people):
        _create_thread(client, workspace, name="secret-5", by="mia")
        r = client.patch(f"/v1/workspaces/{workspace['id']}/channels/secret-5", json={"visibility": "workspace"},
                         headers=_bearer("adam", workspace))
        assert r.status_code == 403
        r = client.patch(f"/v1/workspaces/{workspace['id']}/channels/secret-5", json={"visibility": "workspace"},
                         headers=_bearer("mia", workspace))
        assert r.status_code == 200, r.text
        adam_ch, _ = _discover(client, workspace, _bearer("adam", workspace))
        assert "secret-5" in adam_ch

    def test_locking_a_thread_keeps_the_locker_in(self, client, workspace, people, db):
        _create_thread(client, workspace, name="open-2", by="mia", visibility="workspace")
        r = client.patch(f"/v1/workspaces/{workspace['id']}/channels/open-2", json={"visibility": "private"},
                         headers=_bearer("adam", workspace))
        assert r.status_code == 200, r.text
        adam_ch, _ = _discover(client, workspace, _bearer("adam", workspace))
        mia_ch, _ = _discover(client, workspace, _bearer("mia", workspace))
        assert "open-2" in adam_ch
        assert "open-2" in mia_ch, "the creator stays a participant when someone else locks the thread"
        vic_ch, _ = _discover(client, workspace, _bearer("vic", workspace))
        assert "open-2" not in vic_ch

    def test_notifications_follow_thread_and_recipient(self, client, workspace, people, db):
        _create_thread(client, workspace, name="secret-6", by="mia")
        notify(db, workspace["id"], source="openagents:agent-alpha", title="in private", message="x", channel_name="secret-6")
        notify(db, workspace["id"], source="openagents:agent-alpha", title="for adam", message="x", recipient_email="adam@acme.test")
        notify(db, workspace["id"], source="openagents:agent-alpha", title="for all", message="x")
        db.commit()
        def titles(h):
            r = client.get(f"/v1/notifications?network={workspace['id']}", headers=h)
            assert r.status_code == 200
            return {n["title"] for n in r.json()["data"]["notifications"]}
        assert titles(_bearer("adam", workspace)) == {"for adam", "for all"}
        assert titles(_bearer("mia", workspace)) == {"in private", "for all"}
        assert titles(_tok(workspace)) >= {"in private", "for adam", "for all"}


# ---------------------------------------------------------------------------
# Personal agents
# ---------------------------------------------------------------------------

def _join(client, ws, agent):
    r = client.post("/v1/join", json={"network": ws["id"], "agent_name": agent, "agent_type": "claude", "token": ws["token"]}, headers=_tok(ws))
    assert r.status_code == 200, r.text


def _revoke_everyone(client, ws, agent, headers):
    """Permission model: "personal" = the agent's default `everyone` grant is
    revoked. What an agent can be used for is exactly its grants."""
    r = client.get(f"/v1/grants?network={ws['id']}&resource_kind=agent&resource_id={agent}", headers=headers)
    assert r.status_code == 200, r.text
    found = False
    for g in r.json()["data"]["grants"]:
        if g["grantee_kind"] == "group" and g["grantee_label"] == "Everyone":
            assert client.delete(f"/v1/grants/{g['id']}?network={ws['id']}", headers=headers).status_code == 200
            found = True
    assert found, "a new agent starts with an `everyone` grant"


def _make_private(client, ws, agent, owner):
    r = client.patch(f"/v1/workspaces/{ws['id']}/members/{agent}",
                     json={"owner_email": f"{owner}@acme.test"}, headers=_bearer(owner, ws))
    assert r.status_code == 200, r.text
    _revoke_everyone(client, ws, agent, _bearer(owner, ws))


class TestPersonalAgents:
    def test_claim_and_hide(self, client, workspace, people):
        _join(client, workspace, "deploy-bot")
        # a member may claim an unowned agent for themselves …
        r = client.patch(f"/v1/workspaces/{workspace['id']}/members/deploy-bot",
                         json={"owner_email": "mia@acme.test", "visibility": "personal"}, headers=_bearer("mia", workspace))
        assert r.status_code == 200, r.text
        # `visibility` is deprecated and ignored: the agent stays usable by
        # everyone until the owner revokes the `everyone` grant.
        _, adam_ag = _discover(client, workspace, _bearer("adam", workspace))
        assert "deploy-bot" in adam_ag
        _revoke_everyone(client, workspace, "deploy-bot", _bearer("mia", workspace))
        # … but not someone else's
        r = client.patch(f"/v1/workspaces/{workspace['id']}/members/deploy-bot",
                         json={"owner_email": "vic@acme.test"}, headers=_bearer("vic", workspace))
        assert r.status_code == 403
        _, mia_ag = _discover(client, workspace, _bearer("mia", workspace))
        _, adam_ag = _discover(client, workspace, _bearer("adam", workspace))
        _, machine_ag = _discover(client, workspace, _tok(workspace))
        assert "deploy-bot" in mia_ag and "deploy-bot" in machine_ag
        assert "deploy-bot" not in adam_ag

    def test_grant_reveals_agent(self, client, workspace, people, db):
        _join(client, workspace, "deploy-bot")
        _make_private(client, workspace, "deploy-bot", "mia")
        db.add(ResourceGrant(workspace_id=workspace["id"], resource_kind="agent", resource_id="deploy-bot",
                             grantee_kind="human", grantee_id="vic@acme.test", rights=["read", "act"],
                             granted_by="mia@acme.test"))
        db.commit()
        _, vic_ag = _discover(client, workspace, _bearer("vic", workspace))
        assert "deploy-bot" in vic_ag
        g = db.execute(select(ResourceGrant).where(ResourceGrant.grantee_kind == "human")).scalar_one()
        g.revoked_at = g.created_at
        db.commit()
        _, vic_ag = _discover(client, workspace, _bearer("vic", workspace))
        assert "deploy-bot" not in vic_ag

    def test_mention_of_hidden_agent_is_not_routed(self, client, workspace, people):
        _join(client, workspace, "deploy-bot")
        _make_private(client, workspace, "deploy-bot", "mia")
        ch = workspace["channel"]["name"]
        r = _post(client, workspace, channel=ch, by="adam", content="@deploy-bot ship it", headers=_bearer("adam", workspace))
        assert r.status_code == 200, r.text
        targets = r.json()["data"]["metadata"].get("target_agents") or []
        assert "deploy-bot" not in targets
        r = _post(client, workspace, channel=ch, by="mia", content="@deploy-bot ship it", headers=_bearer("mia", workspace))
        assert "deploy-bot" in (r.json()["data"]["metadata"].get("target_agents") or [])

    def test_profile_fields_and_validation(self, client, workspace, people):
        _join(client, workspace, "deploy-bot")
        r = client.patch(f"/v1/workspaces/{workspace['id']}/members/deploy-bot",
                         json={"visibility": "personal"}, headers=_tok(workspace))
        assert r.status_code == 200  # deprecated field: accepted, ignored
        r = client.patch(f"/v1/workspaces/{workspace['id']}/members/deploy-bot", json={
            "owner_email": "mia@acme.test", "purpose": "Launch endpoints on HyperPod",
            "example_requests": ["Deploy the eval model", ""], "cost_owner": "owner"}, headers=_tok(workspace))
        assert r.status_code == 200, r.text
        _, _ = _discover(client, workspace, _tok(workspace))
        d = client.get(f"/v1/discover?network={workspace['id']}", headers=_tok(workspace)).json()["data"]
        bot = next(a for a in d["agents"] if a["address"] == "openagents:deploy-bot")
        assert bot["owner_email"] == "mia@acme.test"
        assert bot["purpose"].startswith("Launch")
        assert bot["example_requests"] == ["Deploy the eval model"]
        assert bot["cost_owner"] == "owner"
        assert bot["visibility"] == "team"
