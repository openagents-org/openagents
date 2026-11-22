# -*- coding: utf-8 -*-
"""OpenAgents Share: publishing a shared thread and what its guest link allows."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models import (
    Channel, EventRecord, ThreadGuest, ThreadGuestLink, User, Workspace, WorkspaceMember,
    WorkspaceMembership,
)
from tests.test_visibility import no_push  # noqa: F401


def _key():
    return "pub-" + uuid.uuid4().hex


def _publish(client, key=None, headers=None, **over):
    body = {
        "idempotency_key": key or _key(),
        "title": "PR reviewer",
        "agent_name": "pr-reviewer",
        "agent_type": "claude",
        "agent_display_name": "Claude Code",
        "owner_name": "Alex",
        "excerpts": [
            {"author": "owner", "text": "Review PR #18 for accessibility and missing tests."},
            {"author": "agent", "text": "I found one keyboard issue in the settings form."},
        ],
        "intro": "Paste a public GitHub pull request and mention me; I'll review it.",
    }
    body.update(over)
    r = client.post("/v1/share/publish", json=body, headers=headers or {})
    return r


def _published(client, **over):
    r = _publish(client, **over)
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _token(data):
    return data["guestUrl"].rsplit("/", 1)[1]


def _guest(client, token, name="Maya"):
    r = client.post(f"/v1/thread-links/public/{token}/guests", json={"name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _post(client, token, session, content, key=None):
    body = {"content": content}
    if key:
        body["idempotency_key"] = key
    return client.post(f"/v1/thread-links/public/{token}/messages", json=body,
                       headers={"X-Guest-Session": session} if session else {})


def _messages(client, token, after=None):
    url = f"/v1/thread-links/public/{token}/messages" + (f"?after={after}" if after else "")
    r = client.get(url)
    assert r.status_code == 200, r.text
    return r.json()["data"]["messages"]


def test_publish_makes_one_passive_thread_with_the_chosen_excerpts(client, db, no_push):
    data = _published(client)
    assert data["created"] is True
    assert data["guestUrl"].startswith("https://") and "/share/thread/" in data["guestUrl"]
    assert data["token"] in data["ownerUrl"], "the owner link carries the creator credential"
    assert data["token"] not in data["guestUrl"], "the guest link never carries the workspace token"

    channel = db.query(Channel).filter(Channel.name == data["channel"]["name"]).one()
    assert channel.response_mode == "passive", "a comment must never run the agent"
    assert channel.master_agent == "pr-reviewer"
    assert [m.agent_name for m in channel.participants] == ["pr-reviewer"]
    ws = db.get(Workspace, data["workspaceId"])
    assert ws.creator_email is None and ws.require_login is True

    msgs = _messages(client, _token(data))
    assert [m["payload"]["sender_name"] for m in msgs] == ["Alex", "Claude Code", "Claude Code"]
    assert all(m["metadata"]["share_seed"] for m in msgs)
    assert msgs[-1]["metadata"]["share_seed_kind"] == "intro"
    assert msgs[1]["source"] == "openagents:pr-reviewer"


def test_publish_retry_returns_the_same_workspace_and_link(client, db, no_push):
    key = _key()
    first = _published(client, key=key)
    again = _published(client, key=key)
    assert again["created"] is False
    for field in ("workspaceId", "token", "guestUrl", "ownerUrl"):
        assert again[field] == first[field]
    assert db.query(ThreadGuestLink).count() == 1
    assert db.query(Workspace).filter(Workspace.settings.isnot(None)).count() >= 1


def test_publish_validates_its_input(client, no_push):
    assert _publish(client, key="short").status_code == 400
    assert _publish(client, agent_name="bad name!").status_code == 400
    assert _publish(client, excerpts=[{"author": "someone", "text": "x"}]).status_code == 400
    assert _publish(client, excerpts=[{"author": "owner", "text": "x" * 9000}]).status_code == 400
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert _publish(client, link_expires_at=past).status_code == 400


def test_link_never_expires_by_default_and_can_be_given_an_expiry(client, no_push):
    data = _published(client)
    assert data["link"]["expiresAt"] is None
    soon = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    timed = _published(client, link_expires_at=soon)
    assert timed["link"]["expiresAt"].startswith(soon[:16])


def test_signed_in_publisher_owns_the_workspace(client, db, monkeypatch, no_push):
    import app.access as access
    user = User(email="alex@acme.test", display_name="Alex A")
    db.add(user)
    db.commit()
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: {
        "provider": "firebase", "email": "alex@acme.test", "firebase_uid": "alex",
        "apple_sub": None, "display_name": "Alex A"} if tok == "alex" else None)
    data = _published(client, headers={"Authorization": "Bearer alex"}, owner_name=None)
    ws = db.get(Workspace, data["workspaceId"])
    assert ws.creator_email == "alex@acme.test"
    assert db.query(WorkspaceMembership).filter_by(workspace_id=ws.id, role="owner").count() == 1
    msgs = _messages(client, _token(data))
    assert msgs[0]["payload"]["sender_name"] == "Alex A"
    assert msgs[0]["source"] == "human:member", "a member's email never reaches a guest"

    stale = _publish(client, headers={"Authorization": "Bearer nobody"})
    assert stale.status_code == 401, "a stale sign-in must not silently publish anonymously"


def test_guest_reads_without_a_name_and_posts_after_choosing_one(client, db, no_push):
    data = _published(client)
    token = _token(data)
    info = client.get(f"/v1/thread-links/public/{token}")
    assert info.status_code == 200
    assert info.headers["referrer-policy"] == "no-referrer"
    body = info.json()["data"]
    assert body["thread"]["title"] == "PR reviewer"
    assert body["owner"]["name"] == "Alex"
    assert body["guest"] is None and body["canPost"] is True
    assert body["agents"] == [{"name": "pr-reviewer", "displayName": "Claude Code", "type": "claude",
                               "online": False, "acceptsGuests": False}]

    assert _post(client, token, None, "hello").status_code == 401
    g = _guest(client, token)
    again = client.get(f"/v1/thread-links/public/{token}", headers={"X-Guest-Session": g["session"]})
    assert again.json()["data"]["guest"] == g["guest"]
    assert db.query(ThreadGuest).one().session_hash != g["session"], "only a hash is stored"

    r = _post(client, token, g["session"], "Nice work on the settings form!")
    assert r.status_code == 200, r.text
    msg = r.json()["data"]
    assert msg["source"].endswith("@guest.invalid")
    assert msg["metadata"]["guest"]["name"] == "Maya"
    stored = db.get(EventRecord, msg["id"])
    db.refresh(stored)
    assert stored.metadata_.get("target_agents") in (None, [], ["__no_response__"]), \
        "a plain comment does not run the agent"


def _join(client, data, capabilities):
    r = client.post("/v1/join", json={"agent_name": "pr-reviewer", "token": data["token"],
                                      "network": data["workspaceId"], "agent_type": "claude",
                                      "capabilities": capabilities})
    assert r.status_code == 200, r.text


def test_addressing_the_agent_routes_the_message_to_it(client, db, no_push):
    data = _published(client)
    _join(client, data, ["guest_turns", "made-up"])
    member = db.query(WorkspaceMember).filter_by(workspace_id=data["workspaceId"], agent_name="pr-reviewer").one()
    assert member.capabilities == ["guest_turns"], "unknown capabilities are dropped"
    token = _token(data)
    info = client.get(f"/v1/thread-links/public/{token}").json()["data"]
    assert info["agents"][0]["acceptsGuests"] is True and info["agents"][0]["online"] is True
    g = _guest(client, token)
    r = _post(client, token, g["session"], "@pr-reviewer please review https://github.com/example/repo/pull/42")
    assert r.status_code == 200, r.text
    stored = db.get(EventRecord, r.json()["data"]["id"])
    assert stored.metadata_.get("target_agents") == ["pr-reviewer"], stored.metadata_


def test_guest_cannot_address_an_agent_outside_the_thread(client, db, no_push):
    data = _published(client)
    db.add(WorkspaceMember(workspace_id=data["workspaceId"], agent_name="deployer", status="online"))
    db.commit()
    g = _guest(client, _token(data))
    r = _post(client, _token(data), g["session"], "@deployer ship it")
    assert r.status_code == 403


def test_retried_post_is_delivered_once(client, db, no_push):
    data = _published(client)
    token = _token(data)
    g = _guest(client, token)
    first = _post(client, token, g["session"], "@pr-reviewer review PR 42", key="k-1")
    second = _post(client, token, g["session"], "@pr-reviewer review PR 42", key="k-1")
    assert first.status_code == second.status_code == 200
    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    guest_msgs = [m for m in _messages(client, token) if "guest" in m["metadata"]]
    assert len(guest_msgs) == 1
    assert db.get(ThreadGuest, g["guest"]["id"]).post_window_count == 1, "a retry is not charged twice"


def test_messages_page_forward_with_after(client, no_push):
    data = _published(client)
    token = _token(data)
    g = _guest(client, token)
    seeded = _messages(client, token)
    _post(client, token, g["session"], "one")
    _post(client, token, g["session"], "two")
    newer = _messages(client, token, after=seeded[-1]["id"])
    assert [m["payload"]["content"] for m in newer] == ["one", "two"]
    assert _messages(client, token, after=newer[-1]["id"]) == []
    for m in newer:
        assert "_delivery_hash" not in m["metadata"] and "sender_email" not in m["payload"]


def test_guest_link_reaches_only_its_own_thread(client, db, no_push):
    a = _published(client)
    b = _published(client)
    other = db.query(EventRecord).filter(EventRecord.target == f"channel/{b['channel']['name']}").first()
    r = client.get(f"/v1/thread-links/public/{_token(a)}/messages?after={other.id}")
    assert r.status_code == 400, "an id from another thread is not a valid cursor"
    g = _guest(client, _token(a))
    # A guest session is bound to its link.
    assert _post(client, _token(b), g["session"], "hi").status_code == 401
    # The guest link is not a workspace credential.
    assert client.get(f"/v1/events?network={a['workspaceId']}",
                      headers={"X-Workspace-Token": _token(a)}).status_code in (401, 403)


def test_revoked_and_expired_links_stop_working(client, db, no_push):
    data = _published(client)
    token = _token(data)
    g = _guest(client, token)
    link_id = data["link"]["id"]

    # Only the owner manages links: the guest token is not enough.
    denied = client.delete(f"/v1/thread-links/{link_id}?network={data['workspaceId']}",
                           headers={"X-Workspace-Token": token})
    assert denied.status_code == 403

    owner = {"X-Workspace-Token": data["token"]}
    listed = client.get(f"/v1/thread-links?network={data['workspaceId']}", headers=owner)
    assert [l["id"] for l in listed.json()["data"]["links"]] == [link_id]

    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.query(ThreadGuestLink).filter_by(id=link_id).update({"expires_at": past})
    db.commit()
    assert client.get(f"/v1/thread-links/public/{token}").status_code == 410
    assert _post(client, token, g["session"], "still here?").status_code == 410

    patched = client.patch(f"/v1/thread-links/{link_id}?network={data['workspaceId']}",
                           json={"expires_at": None}, headers=owner)
    assert patched.status_code == 200 and patched.json()["data"]["link"]["expiresAt"] is None
    assert client.get(f"/v1/thread-links/public/{token}").status_code == 200

    revoked = client.delete(f"/v1/thread-links/{link_id}?network={data['workspaceId']}", headers=owner)
    assert revoked.status_code == 200
    assert client.get(f"/v1/thread-links/public/{token}").status_code == 404
    assert _post(client, token, g["session"], "hello?").status_code == 404
    assert client.post(f"/v1/thread-links/public/{token}/guests", json={"name": "Sam"}).status_code == 404


def test_guest_posting_is_rate_limited(client, monkeypatch, no_push):
    import app.services.thread_links as svc
    monkeypatch.setattr(svc, "GUEST_POSTS_PER_HOUR", 2)
    data = _published(client)
    token = _token(data)
    g = _guest(client, token)
    assert _post(client, token, g["session"], "1").status_code == 200
    assert _post(client, token, g["session"], "2").status_code == 200
    assert _post(client, token, g["session"], "3").status_code == 429


def test_guest_name_is_required_and_cleaned(client, no_push):
    token = _token(_published(client))
    assert client.post(f"/v1/thread-links/public/{token}/guests", json={"name": "  "}).status_code == 400
    g = _guest(client, token, name="Maya‮  Lee")
    assert g["guest"]["name"] == "Maya Lee"


def test_no_sign_in_can_claim_a_guest_address(db):
    from app.access import get_or_create_user
    assert get_or_create_user(db, {"email": "guest-abc@guest.invalid", "email_verified": True}) is None


def test_instructions_name_this_servers_own_endpoints(client, monkeypatch):
    from app.config import config
    monkeypatch.setattr(config, "PUBLIC_API_BASE", "https://api.example.test/")
    monkeypatch.setattr(config, "FRONTEND_BASE_URL", "https://app.example.test")
    r = client.get("/v1/share/instructions")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert "https://api.example.test/v1/share/publish" in r.text
    assert "{API}" not in r.text and "{APP}" not in r.text
    assert "openagents.org" not in r.text.replace("@openagents-org/", ""), "self-hosters get their own URLs"


def test_an_older_launcher_never_gets_a_guests_request(client, db, no_push):
    """A client that doesn't say it runs guest turns read-only would run them
    with the owner's full rights: the guest gets a notice instead."""
    data = _published(client)
    _join(client, data, [])
    token = _token(data)
    g = _guest(client, token)
    r = _post(client, token, g["session"], "@pr-reviewer review https://github.com/example/repo/pull/1")
    assert r.status_code == 200
    stored = db.get(EventRecord, r.json()["data"]["id"])
    assert stored.metadata_.get("target_agents") == ["__no_response__"]
    notices = [m for m in _messages(client, token) if "launcher" in m["payload"].get("content", "")]
    assert notices, "the guest is told why nothing happens"
    assert "Alex" in notices[-1]["payload"]["content"]

    # Rejoining from an updated launcher turns guest requests on.
    _join(client, data, ["guest_turns"])
    r = _post(client, token, g["session"], "@pr-reviewer review https://github.com/example/repo/pull/2")
    assert db.get(EventRecord, r.json()["data"]["id"]).metadata_.get("target_agents") == ["pr-reviewer"]
    # ...and a later join from an old launcher turns them off again.
    _join(client, data, None)
    db.expire_all()
    member = db.query(WorkspaceMember).filter_by(workspace_id=data["workspaceId"], agent_name="pr-reviewer").one()
    assert member.capabilities == []
