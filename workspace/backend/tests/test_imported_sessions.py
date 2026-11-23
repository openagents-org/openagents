# -*- coding: utf-8 -*-
"""Importing a person's own local CLI session as a private thread."""

from app.models import Channel, ChannelHumanMember, ChannelMember, EventRecord
from tests.test_nodes import _connect_node, _owner, _tok, pairing_identity  # noqa: F401


def _make_workspace(client):
    r = client.post("/v1/workspaces", json={"name": "WS", "creator_email": "a@x.com", "agent_name": "agent-alpha"})
    assert r.status_code == 200
    return r.json()["data"]


def _import(client, ws, node_id, body, token=None):
    return client.post(f"/v1/nodes/{node_id}/imported-sessions", json=body, headers=_tok(token or ws["device_token"]))


MESSAGES = [
    {"role": "user", "text": "Add pagination to /users", "at": "2026-11-02T09:00:01Z"},
    {"role": "tool", "text": "Ran: pytest -q", "at": "2026-11-02T09:00:04Z"},
    {"role": "assistant", "text": "Done, added limit and offset.", "at": "2026-11-02T09:00:09Z"},
]


def _thread_events(db, ws, channel):
    return db.query(EventRecord).filter(EventRecord.network_id == ws["workspaceId"],
                                        EventRecord.target == f"channel/{channel}").order_by(EventRecord.timestamp).all()


def test_import_creates_a_private_thread_of_history(client, db):
    ws = _make_workspace(client)
    node_id = _connect_node(client, ws)
    r = _import(client, ws, node_id, {"type": "codex", "session_id": "s1", "title": "Add pagination to /users",
                                       "cwd": "/work/api", "agent": "agent-alpha", "messages": MESSAGES})
    assert r.status_code == 200, r.text
    channel = r.json()["data"]["channel"]
    ch = db.query(Channel).filter(Channel.name == channel).one()
    assert ch.visibility == "private" and ch.owner_email == "a@x.com" and ch.title == "Add pagination to /users"
    assert db.query(ChannelHumanMember).filter_by(channel_id=ch.id, user_email="a@x.com").count() == 1
    assert db.query(ChannelMember).filter_by(channel_id=ch.id, agent_name="agent-alpha").count() == 1
    events = _thread_events(db, ws, channel)
    assert [e.source for e in events] == ["system:import", "human:a@x.com", "openagents:agent-alpha"]
    assert events[0].payload["content"].startswith("Imported from Codex · /work/api")
    # The tool note is folded into the answer that follows it.
    assert events[2].payload["content"] == "_Ran: pytest -q_\n\nDone, added limit and offset."
    assert events[1].payload["imported"]["at"] == "2026-11-02T09:00:01Z"
    # History: nothing is addressed to an agent.
    assert all(e.metadata_["target_agents"] == ["__no_response__"] for e in events)


def test_later_batches_append_in_order(client, db):
    ws = _make_workspace(client)
    node_id = _connect_node(client, ws)
    channel = _import(client, ws, node_id, {"type": "claude", "session_id": "s2", "agent": "agent-alpha",
                                             "truncated": True, "total": 900, "messages": MESSAGES[:1]}).json()["data"]["channel"]
    r = _import(client, ws, node_id, {"channel": channel, "messages": MESSAGES[2:]})
    assert r.status_code == 200, r.text
    events = _thread_events(db, ws, channel)
    assert "the most recent 400 of 900 messages" in events[0].payload["content"]
    assert [e.payload["content"] for e in events[1:]] == ["Add pagination to /users", "Done, added limit and offset."]


def test_only_the_device_itself_can_import(client):
    ws = _make_workspace(client)
    node_id = _connect_node(client, ws)
    body = {"type": "codex", "session_id": "s1", "messages": MESSAGES}
    assert _import(client, ws, node_id, body, token="wrong").status_code == 403
    assert client.post(f"/v1/nodes/{node_id}/imported-sessions", json=body, headers=_owner()).status_code == 403


def test_appends_only_into_imported_threads_and_unknown_tools_are_refused(client):
    ws = _make_workspace(client)
    node_id = _connect_node(client, ws)
    assert _import(client, ws, node_id, {"channel": ws["channel"]["name"] if isinstance(ws.get("channel"), dict) else "general",
                                         "messages": MESSAGES}).status_code == 404
    assert _import(client, ws, node_id, {"type": "aider", "messages": MESSAGES}).status_code == 400
    assert _import(client, ws, node_id, {"type": "codex", "agent": "nobody", "messages": MESSAGES}).status_code == 400


def test_batches_are_capped(client):
    ws = _make_workspace(client)
    node_id = _connect_node(client, ws)
    r = _import(client, ws, node_id, {"type": "codex", "messages": [MESSAGES[0]] * 51})
    assert r.status_code == 422
