# -*- coding: utf-8 -*-
"""
Tests for the event-native API (POST/GET /v1/events).
"""

import pytest


class TestSendEvent:
    """POST /v1/events — send events through the pipeline."""

    def test_send_message_event(self, client, workspace):
        """Send a workspace.message.posted event through the pipeline."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": f"channel/{channel_name}",
            "payload": {"content": "Hello, world!"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["type"] == "workspace.message.posted"
        assert data["source"] == "human:user1"
        assert data["target"] == f"channel/{channel_name}"
        assert "id" in data
        assert "timestamp" in data

    def test_send_event_missing_network(self, client, workspace):
        """Events without network field are rejected."""
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": "channel/test",
        })
        assert resp.status_code == 400

    def test_send_event_invalid_network(self, client, workspace):
        """Events with nonexistent network are rejected."""
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": "channel/test",
            "network": "nonexistent",
        })
        assert resp.status_code == 404

    def test_send_event_wrong_token(self, client, workspace):
        """Events with wrong token are rejected by auth mod."""
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": "channel/test",
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": "wrong-token"})
        assert resp.status_code == 401

    def test_send_event_stamps_network_id(self, client, workspace):
        """Auth mod stamps network ID on the event."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {"content": "test"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200

        # Verify event was persisted
        poll = client.get("/v1/events", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert poll.status_code == 200
        events = poll.json()["data"]["events"]
        assert len(events) >= 1
        found = [e for e in events if e["type"] == "workspace.message.posted"]
        assert len(found) >= 1

    def test_send_event_with_metadata(self, client, workspace):
        """Custom metadata is preserved through the pipeline."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {"content": "test"},
            "metadata": {"custom_key": "custom_value"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["metadata"]["custom_key"] == "custom_value"

    def test_human_message_routes_to_master(self, client, workspace):
        """Human messages are routed to the channel master agent."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user1",
            "target": f"channel/{channel_name}",
            "payload": {"content": "Hello agent!"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # workspace_mod should add target_agents with the channel master
        assert "target_agents" in data["metadata"]
        assert "agent-alpha" in data["metadata"]["target_agents"]


    def test_agent_message_master_no_targeting_in_single_agent_channel(self, client, workspace):
        """Master agent messages in single-agent channels have no target_agents.

        With the LLM router, multi-agent routing uses the router.
        In single-agent channels (or when router is disabled), the fallback
        applies: master's own messages get no targeting.
        """
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {
                "content": "@agent-beta please review the code",
                "message_type": "chat",
            },
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # Master's message in a single-agent channel — no targeting
        assert "target_agents" not in data["metadata"]

    def test_master_message_without_mentions_no_target_agents(self, client, workspace):
        """Master agent messages without mentions have no target_agents (no self-trigger)."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",  # agent-alpha is the channel master
            "target": f"channel/{channel_name}",
            "payload": {"content": "Just a status update"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # Master's own messages should NOT trigger itself
        assert "target_agents" not in data["metadata"]

    def test_member_message_without_mentions_routes_to_master(self, client, workspace):
        """Member agent messages without mentions route back to channel master."""
        # Add a member agent
        client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-beta",  # member, not master
            "target": f"channel/{channel_name}",
            "payload": {"content": "I finished the task."},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # Member's response should be routed back to the master
        assert data["metadata"]["target_agents"] == ["agent-alpha"]

    def test_member_message_with_mention_routes_to_mentioned_agent(self, client, workspace):
        """Agent messages with explicit @mentions route to the mentioned agent."""
        # Add member agents to workspace (not to channel — so channel stays single-participant)
        for name in ["agent-beta", "agent-gamma"]:
            client.post("/v1/join", json={
                "agent_name": name,
                "token": workspace["token"],
                "network": workspace["id"],
            })

        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-beta",
            "target": f"channel/{channel_name}",
            "payload": {"content": "@agent-gamma can you review this?"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        assert resp.status_code == 200
        data = resp.json()["data"]
        # Explicit @mention routes directly to the mentioned agent
        assert data["metadata"]["target_agents"] == ["agent-gamma"]


class TestPollEvents:
    """GET /v1/events — poll events from a network."""

    def test_poll_empty_network(self, client, workspace):
        """Polling a new network returns empty list."""
        resp = client.get("/v1/events", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["events"] == []
        assert data["has_more"] is False

    def test_poll_after_send(self, client, workspace):
        """Events appear after being sent."""
        channel_name = workspace["channel"]["name"]
        # Send an event
        client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {"content": "msg1"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        # Poll
        resp = client.get("/v1/events", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        events = resp.json()["data"]["events"]
        assert len(events) == 1
        assert events[0]["payload"]["content"] == "msg1"

    def test_poll_filter_by_type(self, client, workspace):
        """Filter events by type prefix."""
        channel_name = workspace["channel"]["name"]
        # Send two different event types
        for etype in ("workspace.message.posted", "workspace.session.created"):
            client.post("/v1/events", json={
                "type": etype,
                "source": "openagents:agent-alpha",
                "target": f"channel/{channel_name}",
                "payload": {},
                "network": workspace["id"],
            }, headers={"X-Workspace-Token": workspace["token"]})

        # Filter by workspace.session
        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "workspace.session",
        }, headers={"X-Workspace-Token": workspace["token"]})
        events = resp.json()["data"]["events"]
        assert len(events) == 1
        assert events[0]["type"] == "workspace.session.created"

    def test_poll_filter_by_target(self, client, workspace):
        """Filter events by target address."""
        channel_name = workspace["channel"]["name"]
        client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "openagents:agent-alpha",
            "target": f"channel/{channel_name}",
            "payload": {},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})

        # Filter by exact target
        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "target": f"channel/{channel_name}",
        }, headers={"X-Workspace-Token": workspace["token"]})
        events = resp.json()["data"]["events"]
        assert len(events) == 1

        # Different target returns empty
        resp2 = client.get("/v1/events", params={
            "network": workspace["id"],
            "target": "channel/nonexistent",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp2.json()["data"]["events"] == []

    def test_poll_cursor_pagination(self, client, workspace):
        """Cursor-based pagination with after parameter."""
        channel_name = workspace["channel"]["name"]
        # Send 3 events
        event_ids = []
        for i in range(3):
            resp = client.post("/v1/events", json={
                "type": "workspace.message.posted",
                "source": "openagents:agent-alpha",
                "target": f"channel/{channel_name}",
                "payload": {"content": f"msg{i}"},
                "network": workspace["id"],
            }, headers={"X-Workspace-Token": workspace["token"]})
            event_ids.append(resp.json()["data"]["id"])

        # Get first page (limit 2)
        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "limit": 2,
        }, headers={"X-Workspace-Token": workspace["token"]})
        data = resp.json()["data"]
        assert len(data["events"]) == 2
        assert data["has_more"] is True

        # Get second page using cursor
        resp2 = client.get("/v1/events", params={
            "network": workspace["id"],
            "after": data["events"][1]["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})
        data2 = resp2.json()["data"]
        assert len(data2["events"]) == 1
        assert data2["has_more"] is False

    def test_poll_invalid_network(self, client):
        """Polling nonexistent network returns 404."""
        resp = client.get("/v1/events", params={"network": "nonexistent"})
        assert resp.status_code == 404
