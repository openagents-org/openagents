# -*- coding: utf-8 -*-
"""
Roadmap v1.1 M5 — information vs execution in directed shared threads.

In a thread with a director (``Channel.director_email``), a message from
ANOTHER person is information unless it @mentions an agent: it is recorded
but wakes nobody. A mention still routes, flagged ``from_non_director`` so
the agent can weigh it against the director's instructions. Threads without
a director, task threads, and agent-authored messages are unchanged.
"""

import app.access as access
import pytest
from app.models import User, WorkspaceMembership


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
    for name, role in {"mia": "member", "ned": "member"}.items():
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


def _create_thread(client, ws, *, name, by=None, director=None, participants=("agent-alpha",)):
    # Shared (public) threads: the director rule is about several people in
    # one thread. Since the permission model, human-created threads default
    # to private, so say so explicitly.
    payload = {"name": name, "title": name, "participants": list(participants), "visibility": "public"}
    if by:
        payload["sender_email"] = f"{by}@acme.test"
    if director:
        payload["director_email"] = director
    r = client.post("/v1/events", json={
        "type": "network.channel.create",
        "source": f"human:{by}" if by else "openagents:agent-alpha",
        "target": "core",
        "network": ws["id"],
        "payload": payload,
    }, headers=_tok(ws))
    assert r.status_code == 200, r.text
    return name


def _post(client, ws, *, channel, by, content, source=None, email=True):
    payload = {"content": content, "message_type": "chat"}
    if email:
        payload["sender_email"] = f"{by}@acme.test"
    r = client.post("/v1/events", json={
        "type": "workspace.message.posted",
        "source": source or f"human:{by}",
        "target": f"channel/{channel}",
        "network": ws["id"],
        "payload": payload,
    }, headers=_tok(ws))
    assert r.status_code == 200, r.text
    return r.json()["data"]["metadata"] or {}


def _messages(client, ws, channel):
    r = client.get("/v1/events", params={"network": ws["id"], "target": f"channel/{channel}",
                                        "type": "workspace.message.posted"}, headers=_tok(ws))
    assert r.status_code == 200
    return r.json()["data"]["events"]


class TestDirectorRule:
    def test_non_director_without_mention_is_information(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        meta = _post(client, workspace, channel=ch, by="ned", content="FYI the staging DB was rotated")
        assert meta.get("informational") is True
        assert meta.get("director_email") == "mia@acme.test"
        assert meta.get("target_agents") == ["__no_response__"]
        # It is still part of the record.
        assert any("staging DB" in (e["payload"] or {}).get("content", "") for e in _messages(client, workspace, ch))
        # No "no agent online" notice was raised — nothing was asked.
        notices = [e for e in _messages(client, workspace, ch) if (e.get("metadata") or {}).get("system_notice")]
        assert notices == []

    def test_non_director_with_mention_routes_but_is_flagged(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        meta = _post(client, workspace, channel=ch, by="ned", content="@agent-alpha can you re-run the eval?")
        assert meta.get("target_agents") == ["agent-alpha"]
        assert meta.get("from_non_director") is True
        assert meta.get("director_email") == "mia@acme.test"
        assert not meta.get("informational")

    def test_director_is_routed_as_before(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        meta = _post(client, workspace, channel=ch, by="mia", content="please start the eval")
        assert meta.get("target_agents") == ["agent-alpha"]
        assert not meta.get("informational") and not meta.get("from_non_director")

    def test_director_email_is_case_insensitive(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        meta = _post(client, workspace, channel=ch, by="Mia", content="go ahead")
        assert meta.get("target_agents") == ["agent-alpha"]
        assert not meta.get("informational")

    def test_thread_without_director_is_unchanged(self, client, workspace, people):
        # Created by an agent → no director; anyone's plain message routes.
        ch = _create_thread(client, workspace, name="open-floor", by=None)
        meta = _post(client, workspace, channel=ch, by="ned", content="status?")
        assert meta.get("target_agents") == ["agent-alpha"]
        assert not meta.get("informational") and not meta.get("from_non_director")
        assert "director_email" not in meta

    def test_unidentified_sender_is_not_treated_as_non_director(self, client, workspace, people):
        # Legacy token-only clients post as human:<name> without an email —
        # never silence them.
        ch = _create_thread(client, workspace, name="launch", by="mia")
        meta = _post(client, workspace, channel=ch, by="someone", content="hello", email=False)
        assert meta.get("target_agents") == ["agent-alpha"]
        assert not meta.get("informational")

    def test_task_thread_is_exempt(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="task:abc123", by="mia")
        meta = _post(client, workspace, channel=ch, by="ned", content="unblocked — creds are in the vault")
        assert meta.get("target_agents") == ["agent-alpha"]
        assert not meta.get("informational") and not meta.get("from_non_director")

    def test_explicit_director_field_wins_over_creator(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="handed", by="ned", director="mia@acme.test")
        meta = _post(client, workspace, channel=ch, by="ned", content="notes from the call")
        assert meta.get("informational") is True
        meta = _post(client, workspace, channel=ch, by="mia", content="kick it off")
        assert meta.get("target_agents") == ["agent-alpha"]

    def test_agent_messages_are_not_affected(self, client, workspace, people):
        ch = _create_thread(client, workspace, name="launch", by="mia")
        meta = _post(client, workspace, channel=ch, by="x", content="Done — results attached.",
                     source="openagents:agent-alpha", email=False)
        assert not meta.get("informational") and not meta.get("from_non_director")
