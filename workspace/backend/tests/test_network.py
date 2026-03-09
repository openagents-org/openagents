# -*- coding: utf-8 -*-
"""
Tests for the network endpoints (join, leave, heartbeat, discover, profile).
These endpoints emit events through the mod pipeline.
"""

import pytest


class TestJoinNetwork:
    """POST /v1/join — agent joins a network."""

    def test_join_new_agent(self, client, workspace):
        """New agent joins the workspace network."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["network_id"] == workspace["id"]
        assert data["agent_name"] == "agent-beta"
        assert data["role"] == "member"
        assert data["status"] == "online"

    def test_join_existing_agent_reconnects(self, client, workspace):
        """Rejoining sets agent back to online."""
        # Join
        client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        # Leave
        client.post("/v1/leave", json={
            "agent_name": "agent-beta",
            "network": workspace["id"],
        })
        # Rejoin
        resp = client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "online"

    def test_join_by_slug(self, client, workspace):
        """Can join by workspace slug instead of ID."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-gamma",
            "token": workspace["token"],
            "network": workspace["slug"],
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["network_id"] == workspace["id"]

    def test_join_wrong_token(self, client, workspace):
        """Wrong token is rejected."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": "wrong-token",
            "network": workspace["id"],
        })
        assert resp.status_code == 401

    def test_join_nonexistent_network(self, client):
        """Joining nonexistent network returns 404."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": "any",
            "network": "nonexistent",
        })
        assert resp.status_code == 404

    def test_join_creates_event(self, client, workspace):
        """Joining generates a network.agent.join event in the event store."""
        client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        # Check event store
        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "network.agent.join",
        })
        events = resp.json()["data"]["events"]
        assert len(events) >= 1
        join_event = events[-1]
        assert join_event["type"] == "network.agent.join"
        assert join_event["source"] == "openagents:agent-beta"


class TestTokenResolve:
    """POST /v1/token/resolve — resolve workspace from token."""

    def test_resolve_valid_token(self, client, workspace):
        """Valid token returns workspace info."""
        resp = client.post("/v1/token/resolve", json={
            "token": workspace["token"],
        })
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["workspace_id"] == workspace["id"]
        assert data["slug"] == workspace["slug"]
        assert data["name"] == "Test Workspace"

    def test_resolve_invalid_token(self, client, workspace):
        """Invalid token returns 404."""
        resp = client.post("/v1/token/resolve", json={
            "token": "invalid-token-xyz",
        })
        assert resp.status_code == 404
        assert "Invalid or expired" in resp.json()["message"]

    def test_resolve_empty_token(self, client, workspace):
        """Empty string token returns 404."""
        resp = client.post("/v1/token/resolve", json={
            "token": "",
        })
        assert resp.status_code == 404

    def test_resolve_missing_token_field(self, client):
        """Missing token field returns 422."""
        resp = client.post("/v1/token/resolve", json={})
        assert resp.status_code == 422


class TestJoinTokenOnly:
    """POST /v1/join — token-only join (no network field)."""

    def test_join_token_only(self, client, workspace):
        """Join with only a token (no network) resolves workspace from token."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-token-only",
            "token": workspace["token"],
        })
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["network_id"] == workspace["id"]
        assert data["agent_name"] == "agent-token-only"
        assert data["status"] == "online"

    def test_join_token_only_wrong_token(self, client, workspace):
        """Token-only join with invalid token returns 404."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-bad-token",
            "token": "wrong-token-value",
        })
        assert resp.status_code == 404

    def test_join_token_only_with_agent_type(self, client, workspace):
        """Token-only join with agent_type records the type."""
        resp = client.post("/v1/join", json={
            "agent_name": "claude-bot",
            "token": workspace["token"],
            "agent_type": "claude",
        })
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["agent_name"] == "claude-bot"

        # Verify agent appears in discover with correct type
        disc = client.get("/v1/discover", params={"network": workspace["id"]})
        agents = disc.json()["data"]["agents"]
        claude_agents = [a for a in agents if a["address"] == "openagents:claude-bot"]
        assert len(claude_agents) == 1

    def test_join_token_only_null_network(self, client, workspace):
        """Explicitly null network field still works via token resolution."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-null-net",
            "token": workspace["token"],
            "network": None,
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["network_id"] == workspace["id"]


class TestLeaveNetwork:
    """POST /v1/leave — agent leaves a network."""

    def test_leave_online_agent(self, client, workspace):
        """Online agent goes offline after leaving."""
        # Join first
        client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        # Leave
        resp = client.post("/v1/leave", json={
            "agent_name": "agent-beta",
            "network": workspace["id"],
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "offline"

    def test_leave_unknown_agent(self, client, workspace):
        """Leaving when not a member is a no-op but still succeeds (event recorded)."""
        resp = client.post("/v1/leave", json={
            "agent_name": "unknown-agent",
            "network": workspace["id"],
        })
        # In event model, the event is recorded even if agent wasn't a member
        assert resp.status_code == 200


class TestHeartbeat:
    """POST /v1/heartbeat — agent presence heartbeat."""

    def test_heartbeat_updates_presence(self, client, workspace):
        """Heartbeat updates the agent's status to online."""
        # Join first
        client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        # Heartbeat
        resp = client.post("/v1/heartbeat", json={
            "agent_name": "agent-beta",
            "network": workspace["id"],
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "online"

    def test_heartbeat_unknown_agent(self, client, workspace):
        """Heartbeat for non-member is a no-op but still succeeds (event recorded)."""
        resp = client.post("/v1/heartbeat", json={
            "agent_name": "unknown-agent",
            "network": workspace["id"],
        })
        # In event model, the event is recorded even if agent wasn't a member
        assert resp.status_code == 200


class TestDiscover:
    """GET /v1/discover — discover agents and channels."""

    def test_discover_agents(self, client, workspace):
        """Discover shows workspace agents."""
        # The workspace fixture already has agent-alpha as master
        resp = client.get("/v1/discover", params={"network": workspace["id"]})
        assert resp.status_code == 200
        data = resp.json()["data"]
        agents = data["agents"]
        assert len(agents) >= 1
        names = [a["address"] for a in agents]
        assert "openagents:agent-alpha" in names

    def test_discover_channels(self, client, workspace):
        """Discover shows workspace channels."""
        resp = client.get("/v1/discover", params={"network": workspace["id"]})
        data = resp.json()["data"]
        channels = data["channels"]
        assert len(channels) >= 1
        # Channel has the expected structure
        ch = channels[0]
        assert "address" in ch
        assert ch["address"].startswith("channel/")
        assert "participants" in ch

    def test_discover_includes_joined_agents(self, client, workspace):
        """Agents that join show up in discover."""
        client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        resp = client.get("/v1/discover", params={"network": workspace["id"]})
        agents = resp.json()["data"]["agents"]
        names = [a["address"] for a in agents]
        assert "openagents:agent-beta" in names

    def test_discover_nonexistent_network(self, client):
        """Discover on nonexistent network returns 404."""
        resp = client.get("/v1/discover", params={"network": "nonexistent"})
        assert resp.status_code == 404


class TestNetworkManifest:
    """GET /.well-known/openagents.json — ONM network manifest."""

    def test_manifest_returns_onm_metadata(self, client):
        """Manifest returns ONM version, transports, auth, capabilities."""
        resp = client.get("/.well-known/openagents.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["onm_version"] == "1.0"
        assert "transports" in data
        assert len(data["transports"]) >= 1
        assert data["transports"][0]["type"] == "http"
        assert "auth" in data
        assert "token" in data["auth"]["methods"]
        assert "capabilities" in data
        assert "channels" in data["capabilities"]

    def test_manifest_no_auth_required(self, client):
        """Manifest is publicly accessible (no token needed)."""
        resp = client.get("/.well-known/openagents.json")
        assert resp.status_code == 200


class TestNetworkProfile:
    """GET /v1/profile — network profile metadata."""

    def test_profile_returns_metadata(self, client, workspace):
        """Profile returns workspace metadata and capabilities."""
        resp = client.get("/v1/profile", params={"network": workspace["id"]})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["id"] == workspace["id"]
        assert data["slug"] == workspace["slug"]
        assert data["name"] == workspace["name"]
        assert "capabilities" in data
        assert "agents_online" in data

    def test_profile_nonexistent(self, client):
        """Profile for nonexistent network returns 404."""
        resp = client.get("/v1/profile", params={"network": "nonexistent"})
        assert resp.status_code == 404
