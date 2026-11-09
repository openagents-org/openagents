"""Forking a thread copies its settings, agents and history into a new private thread."""
import time
import uuid

from sqlalchemy import select

from app.models import Channel, ChannelHumanMember, ChannelMember, EventRecord
from tests.test_visibility import _bearer, _create_thread, _post, people, no_push  # noqa: F401


def _add_event(db, ws, channel, *, source, content, message_type="chat", metadata=None):
    record = EventRecord(
        id=str(uuid.uuid4()), network_id=ws["id"], type="workspace.message.posted", source=source,
        target=f"channel/{channel}", payload={"content": content, "message_type": message_type},
        metadata_=metadata or {}, timestamp=int(time.time() * 1000),
    )
    db.add(record)
    db.commit()
    return record.id


def _messages(db, ws, channel):
    return db.execute(select(EventRecord).where(
        EventRecord.network_id == ws["id"], EventRecord.target == f"channel/{channel}",
        EventRecord.type == "workspace.message.posted",
    ).order_by(EventRecord.timestamp, EventRecord.id)).scalars().all()


def _fork(client, ws, channel, user, **body):
    return client.post(f"/v1/channels/{channel}/fork", headers=_bearer(user, ws),
                       json={"network": ws["id"], **body})


def _seed(client, db, workspace):
    _create_thread(client, workspace, name="src", by="mia")
    src = db.execute(select(Channel).where(Channel.name == "src")).scalar_one()
    src.response_mode = "passive"
    db.commit()
    assert _post(client, workspace, channel="src", by="mia", content="plan the launch",
                 headers=_bearer("mia", workspace)).status_code == 200
    question = _messages(db, workspace, "src")[0].id
    _add_event(db, workspace, "src", source="openagents:agent-alpha", content="thinking...", message_type="status")
    _add_event(db, workspace, "src", source="openagents:agent-alpha", content="Here is the plan",
               metadata={"reply_to": {"message_id": question}, "in_reply_to": question})
    _add_event(db, workspace, "src", source="human:mia", content="oops", metadata={"recalled": True})
    return question


def test_fork_copies_settings_agents_and_history(client, db, workspace, people):
    question = _seed(client, db, workspace)
    resp = _fork(client, workspace, "src", "mia")
    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["title"] == "src (fork)"
    assert data["forkedFrom"] == "src"
    assert data["visibility"] == "private"
    assert data["ownerEmail"] == "mia@acme.test"
    assert data["responseMode"] == "passive"
    assert data["participants"] == ["agent-alpha"]

    copied = _messages(db, workspace, data["name"])
    assert [m.payload["content"] for m in copied] == ["plan the launch", "Here is the plan"]
    original_ids = {m.id for m in _messages(db, workspace, "src")}
    assert not original_ids & {m.id for m in copied}
    assert copied[1].metadata_["reply_to"]["message_id"] == copied[0].id
    assert copied[1].metadata_["in_reply_to"] == copied[0].id
    assert copied[0].metadata_["forked_from_event_id"] == question

    fork = db.execute(select(Channel).where(Channel.name == data["name"])).scalar_one()
    assert fork.forked_at_event_id == _messages(db, workspace, "src")[2].id
    humans = db.execute(select(ChannelHumanMember.user_email).where(ChannelHumanMember.channel_id == fork.id)).scalars().all()
    assert humans == ["mia@acme.test"]


def test_fork_and_original_diverge(client, db, workspace, people):
    _seed(client, db, workspace)
    before = len(_messages(db, workspace, "src"))
    name = _fork(client, workspace, "src", "mia", title="Side topic").json()["data"]["name"]
    assert db.execute(select(Channel.title).where(Channel.name == name)).scalar_one() == "Side topic"
    assert _post(client, workspace, channel=name, by="mia", content="unrelated question",
                 headers=_bearer("mia", workspace)).status_code == 200
    assert len(_messages(db, workspace, "src")) == before
    assert _messages(db, workspace, name)[-1].payload["content"] == "unrelated question"
    agents = db.execute(select(ChannelMember.agent_name).join(Channel, Channel.id == ChannelMember.channel_id)
                        .where(Channel.name == "src")).scalars().all()
    assert agents == ["agent-alpha"]


def test_only_people_who_can_read_the_thread_can_fork(client, db, workspace, people):
    _seed(client, db, workspace)
    assert _fork(client, workspace, "src", "vic").status_code == 404
    assert _fork(client, workspace, "missing", "mia").status_code == 404
    token_only = client.post("/v1/channels/src/fork", headers={"X-Workspace-Token": workspace["token"]},
                             json={"network": workspace["id"]})
    assert token_only.status_code == 400


def test_public_thread_fork_is_private_to_the_forker(client, db, workspace, people):
    _create_thread(client, workspace, name="open", by="mia", visibility="public")
    _post(client, workspace, channel="open", by="mia", content="hello", headers=_bearer("mia", workspace))
    data = _fork(client, workspace, "open", "adam").json()["data"]
    assert data["visibility"] == "private" and data["ownerEmail"] == "adam@acme.test"
    assert [m.payload["content"] for m in _messages(db, workspace, data["name"])] == ["hello"]
