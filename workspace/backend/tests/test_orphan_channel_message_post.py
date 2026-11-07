# -*- coding: utf-8 -*-
"""A message posted to a thread name that has no Channel row must not vanish
into an invisible thread.

`POST /v1/events` with ``target="channel/<name>"`` accepts any name. The
message pipeline resolved the Channel by name, got ``None`` for a name that
was never created, and carried on: the event was stored and read back through
``GET /v1/events?channel=<name>``, but because no ``channels`` row existed the
thread was absent from ``/v1/discover`` and every thread endpoint
(``/v1/channels/<name>/participants``, ``PATCH /v1/channels/<name>``) answered
404 "Thread not found". The thread could never be opened, so the messages were
unreachable from the dashboard.

Two live cases produced this: the dashboard verification harness (it uses a
fresh ``dashboard-verification-<hex>`` name as a scratch scope and posts into
it) and the workflow engine's task threads (``task:<uuid>``).
"""

from sqlalchemy import select

from app.models import Channel, EventRecord


MARK = "orphan-repro-thread"


def _headers(workspace):
    return {"X-Workspace-Token": workspace["token"]}


def _post(client, workspace, target, content="hello"):
    return client.post(
        "/v1/events",
        json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{target}",
            "network": workspace["id"],
            "payload": {"content": content, "message_type": "chat"},
        },
        headers=_headers(workspace),
    )


def test_message_to_unknown_thread_creates_the_thread(client, workspace, db):
    """The first message to an unknown name materializes the thread."""
    assert db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace["id"], Channel.name == MARK,
        )
    ).scalar_one_or_none() is None

    response = _post(client, workspace, MARK)
    assert response.status_code == 200, response.text
    assert response.json()["code"] == 0

    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace["id"], Channel.name == MARK,
        )
    ).scalar_one_or_none()
    assert channel is not None, "posting created no Channel row — thread is invisible"
    assert channel.status == "active"

    event = db.execute(
        select(EventRecord).where(EventRecord.target == f"channel/{MARK}")
    ).scalar_one_or_none()
    assert event is not None, "the message was not stored"
    assert event.metadata_.get("channel_id") == str(channel.id)


def test_created_thread_is_discoverable_and_answerable(client, workspace):
    """The materialized thread shows up in discovery and its endpoints answer."""
    assert _post(client, workspace, MARK).status_code == 200

    discovery = client.get(
        f"/v1/discover?network={workspace['id']}", headers=_headers(workspace),
    ).json()["data"]
    assert any(c["address"] == f"channel/{MARK}" for c in discovery["channels"])

    participants = client.get(
        f"/v1/channels/{MARK}/participants?network={workspace['id']}",
        headers=_headers(workspace),
    )
    assert participants.status_code == 200, participants.text
    assert participants.json()["code"] == 0

    # A thread whose only message came from an agent keeps working as a target.
    assert _post(client, workspace, MARK, "second").status_code == 200


def test_existing_thread_is_reused_not_duplicated(client, workspace, db):
    """A channel that already exists is not recreated on the next message."""
    existing = workspace["channel"]["name"]
    before = len(db.execute(
        select(Channel).where(Channel.workspace_id == workspace["id"])
    ).scalars().all())

    assert _post(client, workspace, existing).status_code == 200
    assert _post(client, workspace, existing, "again").status_code == 200

    after = db.execute(
        select(Channel).where(Channel.workspace_id == workspace["id"])
    ).scalars().all()
    assert len(after) == before
    assert [c for c in after if c.name == existing]


def test_materialized_thread_keeps_visibility_invariant(client, workspace, db):
    """An agent's post cannot widen a thread: a public thread stays public and
    a private one stays private and keeps its owner."""
    assert _post(client, workspace, MARK).status_code == 200
    channel = db.execute(
        select(Channel).where(
            Channel.workspace_id == workspace["id"], Channel.name == MARK,
        )
    ).scalar_one()
    # No identified human creator on an agent post → public, like channel.create.
    assert channel.visibility == "public"
    assert channel.name == MARK
    assert channel.title is None
    assert channel.created_by == "openagents:agent-alpha"
