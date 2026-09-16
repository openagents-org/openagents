"""Desktop sender identity and agent completion control push recipients."""

import asyncio

import pytest
from sqlalchemy.orm import sessionmaker

from app.models import ChannelHumanMember, WorkspaceCollaborator
from app.services import push
from app.services.message_identity import human_sender_email


@pytest.mark.parametrize(
    "payload, metadata",
    [
        ({"sender_id": "Owner@Example.com"}, {}),
        ({}, {"sender_email": "Owner@Example.com"}),
        ({"sender_email": "Owner@Example.com"}, {}),
    ],
)
def test_desktop_sender_identity(payload, metadata):
    assert human_sender_email(payload, metadata) == "owner@example.com"


def test_non_email_sender_id_is_anonymous():
    assert human_sender_email({"sender_id": "profile-123"}) is None


def test_web_post_skips_own_device_and_agent_reply_reaches_it(
    client, workspace, db, monkeypatch,
):
    email = "owner@example.com"
    token = "OWNER-FCM-TOKEN"
    channel = workspace["channel"]["name"]
    headers = {"X-Workspace-Token": workspace["token"]}
    registered = client.post("/v1/devices/register", json={
        "network": workspace["id"],
        "fcm_token": token,
        "device_type": "ios",
        "user_email": email,
        "prefs": {"allMessages": False, "taskCompletions": True, "mentions": True},
    }, headers=headers)
    assert registered.status_code == 200

    sent = []

    def fake_send(tokens, alert, data):
        sent.append((list(tokens), data["reason"]))
        return list(tokens), []

    monkeypatch.setattr(push, "SessionLocal", sessionmaker(bind=db.get_bind()))
    monkeypatch.setattr(push, "send_push", fake_send)
    from app.services import cloud_agent

    async def skip_cloud_agents(*_args):
        return None

    monkeypatch.setattr(cloud_agent, "invoke_cloud_agents", skip_cloud_agents)

    # The embedded Workspace UI sends the account email as sender_id.
    posted = client.post("/v1/events", json={
        "network": workspace["id"],
        "type": "workspace.message.posted",
        "source": f"human:{email}",
        "target": f"channel/{channel}",
        "payload": {
            "content": "@agent-alpha Please reply",
            "message_type": "chat",
            "sender_id": email,
        },
    }, headers=headers)
    assert posted.status_code == 200, posted.text
    assert sent == []
    assert db.query(ChannelHumanMember).filter_by(user_email=email).count() == 1
    assert db.query(WorkspaceCollaborator).filter_by(email=email).count() == 1

    # A later Agent reply in the same channel reaches that member's phone.
    push.fanout_for_event(workspace["id"], {
        "id": "agent-reply",
        "type": "workspace.message.posted",
        "source": "openagents:agent-alpha",
        "target": f"channel/{channel}",
        "payload": {"content": "Done", "message_type": "chat"},
        "metadata": {"status_kind": "completed"},
    })
    assert sent == [([token], "task_completed")]


def test_cloud_reply_marks_completion_for_default_phone_prefs(
    workspace, db, monkeypatch,
):
    from app.pipeline_factory import pipeline
    from app.services import cloud_agent, integrations, workflow

    captured = []

    async def accept_event(event, _context):
        return event

    monkeypatch.setattr(pipeline, "process", accept_event)
    monkeypatch.setattr(push, "fanout_for_event", lambda _workspace_id, event: captured.append(event))
    monkeypatch.setattr(workflow, "advance_workflow", lambda *_args: None)
    monkeypatch.setattr(integrations, "relay_for_event", lambda *_args: None)

    asyncio.run(cloud_agent._post_response(
        db, workspace["id"], f"channel/{workspace['channel']['name']}",
        "agent-alpha", "Here is the answer", depth=0,
        explicit_targets=[],
    ))

    assert len(captured) == 1
    assert captured[0]["metadata"]["status_kind"] == "completed"
    assert push._should_push(captured[0], set())[1] == "task_completed"
