from openagents.models.event import Event
from openagents.mods.workspace.messaging.mod import ThreadMessagingNetworkMod


def test_extract_content_preserves_arbitrary_message_embeds_and_actions():
    mod = ThreadMessagingNetworkMod()
    event = Event(
        event_name="thread.channel_message.post",
        source_id="agent-a",
        destination_id="channel:approvals",
        payload={
            "channel": "approvals",
            "message_type": "channel_message",
            "content": {
                "text": "Approval requested",
                "schema": "openagents.message.v1",
                "embeds": [
                    {
                        "id": "approval-1",
                        "type": "approval_request",
                        "title": "Human approval requested",
                    }
                ],
                "actions": [
                    {
                        "id": "approve",
                        "type": "submit",
                        "label": "Yes, approved",
                    }
                ],
                "custom": {"vendor": "example"},
            },
        },
    )

    content = mod._extract_content_from_event(event)

    assert content["text"] == "Approval requested"
    assert content["schema"] == "openagents.message.v1"
    assert content["embeds"][0]["type"] == "approval_request"
    assert content["actions"][0]["id"] == "approve"
    assert content["custom"] == {"vendor": "example"}
