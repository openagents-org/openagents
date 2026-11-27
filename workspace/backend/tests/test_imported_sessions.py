# -*- coding: utf-8 -*-
"""Importing a person's own local CLI session as a private thread."""

from app.models import Channel, ChannelHumanMember, ChannelMember, EventRecord, WorkspaceMember
from tests.test_nodes import _connect_node, _owner, _tok, pairing_identity  # noqa: F401


def _make_workspace(client):
    r = client.post("/v1/workspaces", json={"name": "WS", "creator_email": "a@x.com", "agent_name": "agent-alpha"})
    assert r.status_code == 200
    return r.json()["data"]


def _setup(client, db):
    ws = _make_workspace(client)
    node_id = _connect_node(client, ws)
    # The owner's own agent (agent-alpha was registered by the workspace creator a@x.com).
    m = db.query(WorkspaceMember).filter_by(workspace_id=ws["workspaceId"], agent_name="agent-alpha").one()
    m.owner_email = "a@x.com"
    db.commit()
    return ws, node_id


def _command(client, ws, node_id, args):
    """The owner starts an import; the device picks the command up (running)."""
    r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "import_local_session", "args": args}, headers=_owner())
    assert r.status_code == 200, r.text
    client.post("/v1/nodes/heartbeat", json={"node_id": node_id}, headers=_tok(ws["device_token"]))
    return r.json()["data"]["commandId"]


def _upload(client, ws, node_id, body, token=None):
    return client.post(f"/v1/nodes/{node_id}/imported-sessions", json=body, headers=_tok(token or ws["device_token"]))


MESSAGES = [
    {"role": "user", "text": "Add pagination to /users", "at": "2026-11-02T09:00:01Z"},
    {"role": "tool", "text": "Ran: pytest -q", "at": "2026-11-02T09:00:04Z"},
    {"role": "assistant", "text": "Done, added limit and offset.", "at": "2026-11-02T09:00:09Z"},
]


def _events(db, ws, channel):
    return db.query(EventRecord).filter(EventRecord.network_id == ws["workspaceId"],
                                        EventRecord.target == f"channel/{channel}").order_by(EventRecord.timestamp).all()


def test_import_creates_a_private_thread_of_history(client, db):
    ws, node_id = _setup(client, db)
    cid = _command(client, ws, node_id, {"type": "codex", "id": "s1", "agent": "agent-alpha"})
    r = _upload(client, ws, node_id, {"command_id": cid, "title": "Add pagination to /users", "cwd": "/work/api",
                                       "messages": MESSAGES, "final": True})
    assert r.status_code == 200, r.text
    channel = r.json()["data"]["channel"]
    ch = db.query(Channel).filter(Channel.name == channel).one()
    assert ch.visibility == "private" and ch.owner_email == "a@x.com" and ch.title == "Add pagination to /users"
    assert ch.last_event_at
    assert db.query(ChannelHumanMember).filter_by(channel_id=ch.id, user_email="a@x.com").count() == 1
    assert db.query(ChannelMember).filter_by(channel_id=ch.id, agent_name="agent-alpha").count() == 1
    events = _events(db, ws, channel)
    assert [e.source for e in events] == ["system:import", "human:a@x.com", "openagents:agent-alpha"]
    assert events[0].payload["content"].startswith("Imported from Codex · /work/api")
    assert events[2].payload["content"] == "_Ran: pytest -q_\n\nDone, added limit and offset."
    assert events[1].payload["imported"]["at"] == "2026-11-02T09:00:01Z"
    assert all(e.metadata_["target_agents"] == ["__no_response__"] for e in events)


def test_later_batches_append_only_into_the_commands_thread(client, db):
    ws, node_id = _setup(client, db)
    cid = _command(client, ws, node_id, {"type": "claude", "id": "s2", "agent": "agent-alpha"})
    channel = _upload(client, ws, node_id, {"command_id": cid, "truncated": True, "total": 900,
                                             "messages": MESSAGES[:1]}).json()["data"]["channel"]
    assert _upload(client, ws, node_id, {"command_id": cid, "channel": channel, "messages": MESSAGES[2:], "final": True}).status_code == 200
    events = _events(db, ws, channel)
    assert "the most recent 400 of 900 messages" in events[0].payload["content"]
    assert [e.payload["content"] for e in events[1:]] == ["Add pagination to /users", "Done, added limit and offset."]
    # Another thread can't be extended through this import.
    assert _upload(client, ws, node_id, {"command_id": cid, "channel": "general", "messages": MESSAGES}).status_code == 404


def test_the_device_credential_alone_cannot_create_threads(client, db):
    """Every agent on the device holds its credential: without an import the
    owner started, nothing can be written."""
    ws, node_id = _setup(client, db)
    assert _upload(client, ws, node_id, {"command_id": "nope", "messages": MESSAGES}).status_code == 403
    cid = _command(client, ws, node_id, {"type": "codex", "id": "s1"})
    assert _upload(client, ws, node_id, {"command_id": cid, "messages": MESSAGES}, token="wrong").status_code == 403
    assert client.post(f"/v1/nodes/{node_id}/imported-sessions", json={"command_id": cid, "messages": MESSAGES},
                       headers=_owner()).status_code == 403
    # Once the device reports the command finished, it can't be reused.
    client.post(f"/v1/nodes/commands/{cid}/result", json={"ok": True, "data": {}}, headers=_tok(ws["device_token"]))
    assert _upload(client, ws, node_id, {"command_id": cid, "messages": MESSAGES}).status_code == 403


def test_a_private_session_goes_only_to_the_owners_own_agents(client, db):
    ws, node_id = _setup(client, db)
    m = db.query(WorkspaceMember).filter_by(workspace_id=ws["workspaceId"], agent_name="agent-alpha").one()
    m.owner_email = "someone-else@x.com"
    db.commit()
    cid = _command(client, ws, node_id, {"type": "codex", "id": "s1", "agent": "agent-alpha"})
    assert _upload(client, ws, node_id, {"command_id": cid, "messages": MESSAGES}).status_code == 403


def test_importing_the_same_session_again_returns_its_thread(client, db):
    ws, node_id = _setup(client, db)
    cid = _command(client, ws, node_id, {"type": "codex", "id": "s1", "agent": "agent-alpha"})
    first = _upload(client, ws, node_id, {"command_id": cid, "messages": MESSAGES, "final": True}).json()["data"]["channel"]
    cid2 = _command(client, ws, node_id, {"type": "codex", "id": "s1", "agent": "agent-alpha"})
    again = _upload(client, ws, node_id, {"command_id": cid2, "messages": MESSAGES, "final": True}).json()["data"]
    assert again["channel"] == first and again["existing"] is True

    # Even an older device only reports the name of the reused thread.
    reported = {"ok": True, "data": {"channel": first, "existing": True}}
    result = client.post(f"/v1/nodes/commands/{cid2}/result", json=reported, headers=_tok(ws["device_token"]))
    assert result.status_code == 200
    url = f"/v1/nodes/{node_id}/commands/{cid2}"
    assert client.get(url, headers=_owner()).json()["data"]["result"]["data"]["channelStatus"] == "active"
    channel = db.query(Channel).filter_by(workspace_id=ws["workspaceId"], name=first).one()
    channel.status = "archived"
    db.commit()
    assert client.get(url, headers=_owner()).json()["data"]["result"]["data"]["channelStatus"] == "archived"
    assert "data" not in client.get(url, headers=_tok(ws["device_token"])).json()["data"]["result"]


def test_a_half_made_import_is_replaced(client, db):
    ws, node_id = _setup(client, db)
    cid = _command(client, ws, node_id, {"type": "codex", "id": "s9", "agent": "agent-alpha"})
    broken = _upload(client, ws, node_id, {"command_id": cid, "messages": MESSAGES[:1]}).json()["data"]["channel"]  # never final
    cid2 = _command(client, ws, node_id, {"type": "codex", "id": "s9", "agent": "agent-alpha"})
    fresh = _upload(client, ws, node_id, {"command_id": cid2, "messages": MESSAGES, "final": True}).json()["data"]["channel"]
    assert fresh != broken
    assert db.query(Channel).filter(Channel.name == broken).one().status == "deleted"


def test_session_titles_are_hidden_from_the_device_credential(client, db):
    ws, node_id = _setup(client, db)
    r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "list_local_sessions", "args": {"type": "codex"}}, headers=_owner())
    cid = r.json()["data"]["commandId"]
    client.post(f"/v1/nodes/commands/{cid}/result", json={"ok": True, "data": {"sessions": [{"id": "s1", "title": "secret plan"}]}},
                headers=_tok(ws["device_token"]))
    as_device = client.get(f"/v1/nodes/{node_id}/commands", headers=_tok(ws["device_token"])).json()["data"]
    assert "data" not in as_device[0]["result"]
    one = client.get(f"/v1/nodes/{node_id}/commands/{cid}", headers=_tok(ws["device_token"])).json()["data"]
    assert "data" not in one["result"]
    as_owner = client.get(f"/v1/nodes/{node_id}/commands/{cid}", headers=_owner()).json()["data"]
    assert as_owner["result"]["data"]["sessions"][0]["title"] == "secret plan"


def test_batches_are_capped(client, db):
    ws, node_id = _setup(client, db)
    cid = _command(client, ws, node_id, {"type": "codex", "id": "s1"})
    assert _upload(client, ws, node_id, {"command_id": cid, "messages": [MESSAGES[0]] * 51}).status_code == 422
