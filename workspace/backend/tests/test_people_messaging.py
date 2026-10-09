# -*- coding: utf-8 -*-
"""
Person-to-person messaging: DMs are attributed to their real sender, private
to the two sides, and people are notified (inbox + push to *their* devices)
when someone DMs or @mentions them.
"""

import uuid

import app.access as access
import pytest
from app.models import DeviceToken, EventRecord, NotificationRecord, User, WorkspaceMembership
from sqlalchemy import select

ADAM, MIA, VIC = "adam@acme.test", "mia@acme.test", "vic@acme.test"


@pytest.fixture(autouse=True)
def quiet_side_effects(monkeypatch):
    import app.routers.events as events_mod
    import app.services.cloud_agent as cloud_mod
    import app.services.integrations as integ_mod
    import app.services.push as push_mod
    import app.services.watches as watches_mod
    monkeypatch.setattr(push_mod, "fanout_for_event", lambda *a, **k: None)
    noop = lambda *a, **k: None  # noqa: E731
    for mod, name in ((events_mod, "invoke_cloud_agents"), (cloud_mod, "invoke_cloud_agents"),
                      (integ_mod, "relay_for_event"), (watches_mod, "notify_watchers")):
        if hasattr(mod, name):
            monkeypatch.setattr(mod, name, noop)


@pytest.fixture
def pushes(monkeypatch):
    """Push snapshots armed by notify() (the send itself is not run)."""
    import app.services.notify as notify_mod
    captured = []
    monkeypatch.setattr(notify_mod, "_dispatch", lambda snap: captured.append(snap))
    return captured


@pytest.fixture
def people(db, workspace, monkeypatch):
    mapping = {}
    for name, role in {"adam": "admin", "mia": "member", "vic": "member"}.items():
        email = f"{name}@acme.test"
        user = User(email=email, display_name=name.capitalize())
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role=role))
        mapping[name] = {"provider": "firebase", "email": email, "firebase_uid": email,
                         "apple_sub": None, "display_name": name.capitalize()}
    db.commit()
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: mapping.get(tok))
    return mapping


def _tok(ws):
    return {"X-Workspace-Token": ws["token"]}


def _as(name, ws):
    # The web client sends the bearer AND the workspace token.
    return {"Authorization": f"Bearer {name}", **_tok(ws)}


def _dm(client, ws, *, by, to, content, sender_name=None):
    payload = {"content": content, "sender_id": "whatever", "message_type": "chat"}
    if sender_name:
        payload["sender_name"] = sender_name
    r = client.post("/v1/events", json={
        "type": "workspace.message.posted",
        "source": "human:user",
        "target": to,
        "network": ws["id"],
        "visibility": "direct",
        "payload": payload,
        "metadata": {"target_agents": ["__no_response__"]},
    }, headers=_as(by, ws))
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _thread(client, ws, *, name, by, visibility="workspace"):
    r = client.post("/v1/events", json={
        "type": "network.channel.create",
        "source": f"human:{by}",
        "target": "core",
        "network": ws["id"],
        "payload": {"name": name, "title": f"Title {name}", "visibility": visibility,
                    "sender_email": f"{by}@acme.test", "participants": ["agent-alpha"]},
    }, headers=_tok(ws))
    assert r.status_code == 200, r.text


def _say(client, ws, *, channel, by, content, mentioned=None):
    payload = {"content": content, "sender_email": f"{by}@acme.test", "message_type": "chat"}
    if mentioned is not None:
        payload["mentioned_humans"] = mentioned
    r = client.post("/v1/events", json={
        "type": "workspace.message.posted",
        "source": f"human:{by}",
        "target": f"channel/{channel}",
        "network": ws["id"],
        "payload": payload,
        "metadata": {"target_agents": ["__no_response__"]},
    }, headers=_as(by, ws))
    assert r.status_code == 200, r.text


def _notifs(db, **where):
    db.expire_all()
    q = select(NotificationRecord)
    for k, v in where.items():
        q = q.where(getattr(NotificationRecord, k) == v)
    return db.execute(q).scalars().all()


def _conv(client, ws, viewer, a, b):
    r = client.get(f"/v1/events?network={ws['id']}&conversation={a},{b}", headers=_as(viewer, ws))
    assert r.status_code == 200, r.text
    return [e["payload"].get("content") for e in r.json()["data"]["events"]]


def _pairs(client, ws, viewer):
    r = client.get(f"/v1/events/conversations?network={ws['id']}", headers=_as(viewer, ws))
    assert r.status_code == 200, r.text
    return [sorted(c["agents"]) for c in r.json()["data"]["conversations"]]


# ---------------------------------------------------------------------------
# DMs
# ---------------------------------------------------------------------------

class TestDirectMessages:
    def test_dm_is_attributed_to_signed_in_sender(self, client, workspace, people, db, pushes):
        data = _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="hi adam")
        assert data["source"] == f"human:{MIA}"
        assert data["payload"]["sender_email"] == MIA
        assert data["payload"]["sender_id"] == MIA
        row = db.execute(select(EventRecord).where(EventRecord.id == data["id"])).scalar_one()
        assert row.source == f"human:{MIA}"

    def test_machine_dm_keeps_declared_source(self, client, workspace, people, db, pushes):
        r = client.post("/v1/events", json={
            "type": "workspace.message.posted", "source": "openagents:agent-alpha",
            "target": f"human:{ADAM}", "network": workspace["id"], "visibility": "direct",
            "payload": {"content": "agent says hi"},
        }, headers=_tok(workspace))
        assert r.status_code == 200
        assert r.json()["data"]["source"] == "openagents:agent-alpha"

    def test_both_sides_see_it_third_member_does_not(self, client, workspace, people, pushes):
        _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="secret plan")
        _dm(client, workspace, by="adam", to=f"human:{MIA}", content="sounds good")
        a, m = f"human:{ADAM}", f"human:{MIA}"
        assert _conv(client, workspace, "adam", m, a) == ["secret plan", "sounds good"]
        assert _conv(client, workspace, "mia", a, m) == ["secret plan", "sounds good"]
        assert _conv(client, workspace, "vic", a, m) == []
        assert [a, m] in _pairs(client, workspace, "adam")
        assert [a, m] in _pairs(client, workspace, "mia")
        assert [a, m] not in _pairs(client, workspace, "vic")
        # Plain reads and search do not leak it either.
        for q in ("&type=workspace.message", "&search=secret"):
            r = client.get(f"/v1/events?network={workspace['id']}{q}", headers=_as("vic", workspace))
            assert not any("secret plan" == (e["payload"] or {}).get("content") for e in r.json()["data"]["events"])
            r = client.get(f"/v1/events?network={workspace['id']}{q}", headers=_as("adam", workspace))
            assert any("secret plan" == (e["payload"] or {}).get("content") for e in r.json()["data"]["events"])
        # Machines keep full read.
        r = client.get(f"/v1/events?network={workspace['id']}&conversation={a},{m}", headers=_tok(workspace))
        assert len(r.json()["data"]["events"]) == 2

    def test_cache_is_not_shared_between_people(self, client, workspace, people, pushes, monkeypatch):
        from app import cache
        store = {}
        monkeypatch.setattr(cache, "get_bytes", lambda k: store.get(k))
        monkeypatch.setattr(cache, "set_bytes", lambda k, v, ttl_seconds=None: store.__setitem__(k, v))
        _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="cached secret")
        a, m = f"human:{ADAM}", f"human:{MIA}"
        assert _conv(client, workspace, "adam", a, m) == ["cached secret"]
        assert _conv(client, workspace, "vic", a, m) == []

    def test_legacy_unattributed_dms_stay_visible(self, client, workspace, people, db):
        db.add(EventRecord(id=str(uuid.uuid4()), network_id=workspace["id"], type="workspace.message.posted",
                           source="human:user", target="openagents:agent-alpha",
                           payload={"content": "old dm"}, metadata_={}, timestamp=1, visibility="direct"))
        db.commit()
        assert _conv(client, workspace, "vic", "human:user", "openagents:agent-alpha") == ["old dm"]
        assert ["human:user", "openagents:agent-alpha"] in _pairs(client, workspace, "vic")

    def test_dm_notification_addressed_to_recipient_and_bursts_collapse(self, client, workspace, people, db, pushes):
        _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="first", sender_name="Mia M")
        rows = _notifs(db, kind="dm")
        assert len(rows) == 1
        n = rows[0]
        assert n.recipient_email == ADAM
        assert n.channel_name == f"dm:human:{ADAM},human:{MIA}"
        assert n.title == "Mia M sent you a message"
        assert n.message == "first"
        assert len(pushes) == 1 and pushes[0]["recipient_email"] == ADAM and pushes[0]["sender_email"] == MIA

        _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="second")
        rows = _notifs(db, kind="dm")
        assert len(rows) == 1 and rows[0].message == "second"
        assert len(pushes) == 1, "a collapsed burst does not buzz again"

        # Once read, the next message is a fresh notification.
        rows[0].is_read = True
        db.commit()
        _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="third")
        assert len(_notifs(db, kind="dm")) == 2

        # Nobody else got anything.
        assert not [r for r in _notifs(db) if r.recipient_email != ADAM]

    def test_dm_to_self_or_agent_creates_no_person_notification(self, client, workspace, people, db, pushes):
        _dm(client, workspace, by="mia", to=f"human:{MIA}", content="note to self")
        _dm(client, workspace, by="mia", to="openagents:agent-alpha", content="hi agent")
        assert _notifs(db, kind="dm") == []


# ---------------------------------------------------------------------------
# Mentions
# ---------------------------------------------------------------------------

class TestMentions:
    def test_mention_one_person(self, client, workspace, people, db, pushes):
        _thread(client, workspace, name="t1", by="mia")
        _say(client, workspace, channel="t1", by="mia", content="@adam can you look?")
        rows = _notifs(db, kind="mention")
        assert [(r.recipient_email, r.channel_name) for r in rows] == [(ADAM, "t1")]
        assert rows[0].title == "Mia mentioned you in Title t1"
        assert [p["recipient_email"] for p in pushes] == [ADAM]

    def test_mention_two_people_one_notification_each(self, client, workspace, people, db, pushes):
        _thread(client, workspace, name="t2", by="mia")
        _say(client, workspace, channel="t2", by="mia", content=f"@adam and @{VIC} please review",
             mentioned=[ADAM])
        rows = _notifs(db, kind="mention")
        assert sorted(r.recipient_email for r in rows) == [ADAM, VIC]

    def test_no_notification_when_recipient_cannot_see_private_thread(self, client, workspace, people, db, pushes):
        _thread(client, workspace, name="t3", by="mia", visibility="private")
        _say(client, workspace, channel="t3", by="mia", content="@adam secret stuff", mentioned=[ADAM])
        assert _notifs(db, kind="mention") == []
        assert pushes == []

    def test_mentioning_yourself_creates_none(self, client, workspace, people, db, pushes):
        _thread(client, workspace, name="t4", by="mia")
        _say(client, workspace, channel="t4", by="mia", content="@mia reminder", mentioned=[MIA])
        assert _notifs(db, kind="mention") == []


# ---------------------------------------------------------------------------
# Push scoping
# ---------------------------------------------------------------------------

class TestPushScoping:
    def _devices(self, db, ws):
        for i, email in enumerate((ADAM, MIA, VIC, None)):
            db.add(DeviceToken(workspace_id=ws["id"], fcm_token=f"tok-{i}", device_type="ios", user_email=email))
        db.commit()

    def _run(self, monkeypatch, snapshot):
        import app.services.push as push_mod
        from tests.conftest import TestingSessionLocal
        sent = []
        monkeypatch.setattr(push_mod, "SessionLocal", TestingSessionLocal)
        monkeypatch.setattr(push_mod, "send_push",
                            lambda tokens, alert, data: (sent.append(sorted(tokens)), ([], []))[1])
        push_mod.fanout_for_notification(snapshot)
        return sent

    def _snap(self, ws, **over):
        s = {"id": "n1", "workspace_id": ws["id"], "title": "t", "message": "m", "priority": "normal",
             "channel_name": "c", "source": f"human:{MIA}", "reason": "mention"}
        s.update(over)
        return s

    def test_addressed_notification_pushes_only_recipient(self, client, workspace, people, db, monkeypatch):
        self._devices(db, workspace)
        sent = self._run(monkeypatch, self._snap(workspace, recipient_email=ADAM, sender_email=MIA))
        assert sent == [["tok-0"]]

    def test_workspace_wide_notification_skips_sender(self, client, workspace, people, db, monkeypatch):
        self._devices(db, workspace)
        sent = self._run(monkeypatch, self._snap(workspace, recipient_email="", sender_email=MIA))
        assert sent == [["tok-0", "tok-2", "tok-3"]]

    def test_event_path_skips_human_only_mentions(self, client, workspace, people, db, monkeypatch):
        import app.services.push as push_mod
        from tests.conftest import TestingSessionLocal
        self._devices(db, workspace)
        sent = []
        monkeypatch.setattr(push_mod, "SessionLocal", TestingSessionLocal)
        monkeypatch.setattr(push_mod, "send_push",
                            lambda tokens, alert, data: (sent.append(tokens), ([], []))[1])
        push_mod._fanout_impl(workspace["id"], {
            "type": "workspace.message.posted", "source": f"human:{MIA}", "target": "channel/x",
            "payload": {"content": "@adam look", "message_type": "chat", "sender_email": MIA},
        })
        assert sent == []


class TestAgentDmPrivacy:
    """Identified agents read only their own DMs and their owner's."""

    def _agent_conv(self, client, ws, agent, a, b):
        r = client.get(f"/v1/events?network={ws['id']}&conversation={a},{b}",
                       headers={**_tok(ws), "X-Agent-Name": agent})
        assert r.status_code == 200, r.text
        return [e["payload"].get("content") for e in r.json()["data"]["events"]]

    def test_agent_not_a_party_cannot_read_peoples_dm(self, client, workspace, people, db, pushes):
        from app.models import WorkspaceMember
        member = db.query(WorkspaceMember).filter_by(workspace_id=workspace["id"], agent_name="agent-alpha").one()
        member.owner_email = None
        db.commit()
        _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="people only")
        a, m = f"human:{ADAM}", f"human:{MIA}"
        assert self._agent_conv(client, workspace, "agent-alpha", a, m) == []
        r = client.get(f"/v1/events/conversations?network={workspace['id']}",
                       headers={**_tok(workspace), "X-Agent-Name": "agent-alpha"})
        assert [a, m] not in [sorted(c["agents"]) for c in r.json()["data"]["conversations"]]

    def test_agent_reads_its_owners_dm_and_its_own(self, client, workspace, people, db, pushes):
        from app.models import WorkspaceMember
        member = db.query(WorkspaceMember).filter_by(workspace_id=workspace["id"], agent_name="agent-alpha").one()
        member.owner_email = ADAM
        db.commit()
        _dm(client, workspace, by="mia", to=f"human:{ADAM}", content="for adam")
        _dm(client, workspace, by="vic", to="openagents:agent-alpha", content="for the agent")
        a, m, v = f"human:{ADAM}", f"human:{MIA}", f"human:{VIC}"
        assert self._agent_conv(client, workspace, "agent-alpha", a, m) == ["for adam"]
        assert self._agent_conv(client, workspace, "agent-alpha", v, "openagents:agent-alpha") == ["for the agent"]


def test_mention_snippet_uses_display_names(client, workspace, people, db, pushes):
    _thread(client, workspace, name="snip", by="adam", visibility="workspace")
    _say(client, workspace, channel="snip", by="adam", content=f"@{MIA} please review", mentioned=[MIA])
    rows = _notifs(db, recipient_email=MIA, kind="mention")
    assert rows and rows[-1].message == "@Mia please review"


def _post_plain(client, ws, *, channel, by, content, mentioned=None):
    payload = {"content": content, "sender_email": f"{by}@acme.test", "message_type": "chat"}
    if mentioned is not None:
        payload["mentioned_humans"] = mentioned
    r = client.post("/v1/events", json={
        "type": "workspace.message.posted", "source": f"human:{by}",
        "target": f"channel/{channel}", "network": ws["id"], "payload": payload,
    }, headers=_as(by, ws))
    assert r.status_code == 200, r.text
    return (r.json()["data"].get("metadata") or {}).get("target_agents")


class TestPeopleOnlyMentionsDoNotWakeAgents:
    def test_pinging_a_person_wakes_no_agent(self, client, workspace, people, db, pushes):
        _thread(client, workspace, name="ping", by="adam", visibility="workspace")
        targets = _post_plain(client, workspace, channel="ping", by="adam",
                              content=f"@{MIA} can you review?", mentioned=[MIA])
        assert not targets or targets == ["__no_response__"]
        assert _notifs(db, recipient_email=MIA, kind="mention")

    def test_mentioning_an_agent_and_a_person_still_routes_the_agent(self, client, workspace, people, db, pushes):
        _thread(client, workspace, name="ping2", by="adam", visibility="workspace")
        targets = _post_plain(client, workspace, channel="ping2", by="adam",
                              content=f"@agent-alpha draft it, @{MIA} reviews", mentioned=[MIA])
        assert targets == ["agent-alpha"]
