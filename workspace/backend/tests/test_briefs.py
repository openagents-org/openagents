# -*- coding: utf-8 -*-
"""
Roadmap v1.1 M5 — the per-thread work brief.

GET/PUT /v1/channels/{channel}/brief: empty until written, partial upserts,
writer rules (machine / admin+ / human participant) and thread visibility.
"""

import app.access as access
import pytest
from app.models import Channel, ChannelHumanMember, User, WorkspaceMembership
from sqlalchemy import select


@pytest.fixture(autouse=True)
def no_push(monkeypatch):
    import app.services.notify as notify_mod
    import app.services.push as push_mod
    monkeypatch.setattr(notify_mod, "_dispatch", lambda snapshot: None)
    monkeypatch.setattr(push_mod, "fanout_for_event", lambda *a, **k: None)
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
    for name, role in {"adam": "admin", "mia": "member", "vic": "viewer", "ned": "member"}.items():
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
    if ws:
        h.update(_tok(ws))
    return h


def _create_thread(client, ws, *, name, by, visibility="workspace"):
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


def _get(client, ws, channel, headers):
    return client.get(f"/v1/channels/{channel}/brief?network={ws['id']}", headers=headers)


def _put(client, ws, channel, headers, **fields):
    return client.put(f"/v1/channels/{channel}/brief", json={"network": ws["id"], **fields}, headers=headers)


class TestBriefReadWrite:
    def test_empty_until_written(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        r = _get(client, workspace, ch, _tok(workspace))
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["channel"] == "launch"
        for k in ("objective", "owner", "latest_result", "next_step", "updated_by", "updated_at"):
            assert d[k] is None
        assert d["open_questions"] == []
        assert d["director_email"] == "mia@acme.test"
        assert d["can_edit"] is True  # machine caller

    def test_machine_partial_upsert(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        r = _put(client, workspace, ch, _tok(workspace),
                 objective="Ship the eval endpoint", source="openagents:agent-alpha")
        assert r.status_code == 200, r.text
        d = r.json()["data"]
        assert d["objective"] == "Ship the eval endpoint"
        assert d["updated_by"] == "openagents:agent-alpha"
        assert d["updated_at"]

        # A second partial write leaves the objective alone.
        r = _put(client, workspace, ch, _tok(workspace),
                 latest_result="Endpoint deployed to staging",
                 open_questions=["Which region?", "", "   ", "Who signs off?"],
                 next_step="Load test", owner="openagents:agent-alpha",
                 source="openagents:agent-alpha")
        assert r.status_code == 200, r.text
        d = _get(client, workspace, ch, _tok(workspace)).json()["data"]
        assert d["objective"] == "Ship the eval endpoint"
        assert d["latest_result"] == "Endpoint deployed to staging"
        assert d["open_questions"] == ["Which region?", "Who signs off?"]
        assert d["next_step"] == "Load test"
        assert d["owner"] == "openagents:agent-alpha"

        # Explicit null / empty clears a field; absent keys do not.
        r = _put(client, workspace, ch, _tok(workspace), next_step="", open_questions=[])
        assert r.status_code == 200
        d = r.json()["data"]
        assert d["next_step"] is None
        assert d["open_questions"] == []
        assert d["latest_result"] == "Endpoint deployed to staging"
        assert d["updated_by"] == "openagents:unknown"  # machine without a source

    def test_nothing_to_update_and_bad_shapes(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        r = _put(client, workspace, ch, _tok(workspace))
        assert r.status_code == 400
        r = _put(client, workspace, ch, _tok(workspace), open_questions="not a list")
        assert r.status_code == 422
        r = _put(client, workspace, ch, _tok(workspace), source="openagents:x")
        assert r.status_code == 400

    def test_requires_workspace_access(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        assert _get(client, workspace, ch, {"X-Workspace-Token": "nope"}).status_code == 401
        assert _put(client, workspace, ch, {"X-Workspace-Token": "nope"}, objective="x").status_code == 401
        assert client.get(f"/v1/channels/{ch}/brief?network=missing", headers=_tok(workspace)).status_code == 404

    def test_unknown_channel_reads_empty(self, client, workspace, people):
        r = _get(client, workspace, "never-created", _tok(workspace))
        assert r.status_code == 200
        assert r.json()["data"]["objective"] is None
        assert r.json()["data"]["director_email"] is None


class TestBriefWriters:
    def test_participant_can_edit_and_is_recorded(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")  # mia is the first participant
        r = _get(client, workspace, ch, _bearer("mia", workspace))
        assert r.json()["data"]["can_edit"] is True
        r = _put(client, workspace, ch, _bearer("mia", workspace), objective="Ship it")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["updated_by"] == "human:mia@acme.test"

    def test_non_participant_member_cannot_edit(self, client, workspace, people, db):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        r = _get(client, workspace, ch, _bearer("ned", workspace))
        assert r.status_code == 200 and r.json()["data"]["can_edit"] is False
        r = _put(client, workspace, ch, _bearer("ned", workspace), objective="hijack")
        assert r.status_code == 403
        # …until they are a participant of the thread.
        channel = db.execute(select(Channel).where(Channel.name == ch)).scalar_one()
        db.add(ChannelHumanMember(channel_id=channel.id, user_email="ned@acme.test"))
        db.commit()
        r = _put(client, workspace, ch, _bearer("ned", workspace), objective="now allowed")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["updated_by"] == "human:ned@acme.test"

    def test_admin_can_edit_without_being_a_participant(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        r = _put(client, workspace, ch, _bearer("adam", workspace), next_step="Review")
        assert r.status_code == 200, r.text
        assert r.json()["data"]["updated_by"] == "human:adam@acme.test"

    def test_viewer_cannot_edit(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        r = _put(client, workspace, ch, _bearer("vic", workspace), objective="x")
        assert r.status_code == 403
        assert _get(client, workspace, ch, _bearer("vic", workspace)).status_code == 200


class TestBriefVisibility:
    def test_private_thread_hidden_from_non_participants(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="secret", by="mia", visibility="private")
        _put(client, workspace, ch, _tok(workspace), objective="hush", source="openagents:agent-alpha")
        assert _get(client, workspace, ch, _bearer("mia", workspace)).status_code == 200
        assert _get(client, workspace, ch, _tok(workspace)).status_code == 200
        # an admin who is not in the thread cannot read or write its brief
        assert _get(client, workspace, ch, _bearer("adam", workspace)).status_code == 403
        assert _put(client, workspace, ch, _bearer("adam", workspace), objective="x").status_code == 403
        assert _get(client, workspace, ch, _bearer("ned", workspace)).status_code == 403
