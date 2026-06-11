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
        }, headers={"X-Workspace-Token": workspace["token"]})
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
        disc = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
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
        resp = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        data = resp.json()["data"]
        agents = data["agents"]
        assert len(agents) >= 1
        names = [a["address"] for a in agents]
        assert "openagents:agent-alpha" in names

    def test_discover_channels(self, client, workspace):
        """Discover shows workspace channels."""
        resp = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
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

        resp = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        agents = resp.json()["data"]["agents"]
        names = [a["address"] for a in agents]
        assert "openagents:agent-beta" in names

    def test_discover_nonexistent_network(self, client):
        """Discover on nonexistent network returns 404."""
        resp = client.get("/v1/discover", params={"network": "nonexistent"})
        assert resp.status_code == 404

    def test_discover_keeps_stale_members_as_offline(self, client, workspace, db):
        """A member whose heartbeat went stale stays in the agent list, marked
        offline — it is still connected to the workspace, just not online.

        The mobile clients (OpenAgents Go / go/web) rely on this: they decide
        whether to show the "connect an agent" onboarding from membership
        (is the agent in this list?), not from online status. Dropping the
        member here would make the UI wrongly prompt to connect a new agent.
        """
        from datetime import datetime, timedelta, timezone
        from app.config import config
        from app.models import WorkspaceMember

        client.post("/v1/join", json={
            "agent_name": "agent-beta",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        # Age the heartbeat past the timeout so discover downgrades it.
        member = db.query(WorkspaceMember).filter_by(
            workspace_id=workspace["id"], agent_name="agent-beta",
        ).one()
        member.last_heartbeat = datetime.now(timezone.utc) - timedelta(
            seconds=config.AGENT_TIMEOUT_SECONDS + 60,
        )
        db.commit()

        resp = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        agents = resp.json()["data"]["agents"]
        names = [a["address"] for a in agents]
        # Still a member (connected), so the UI must not treat the workspace
        # as agent-less and push the connect-agent flow.
        assert "openagents:agent-beta" in names
        beta = next(a for a in agents if a["address"] == "openagents:agent-beta")
        assert beta["status"] == "offline"


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
        resp = client.get("/v1/profile", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
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


class TestSessionEnforcement:
    """Session rotation + validation prevents duplicate clients from replying as the same agent."""

    def test_join_returns_session_id(self, client, workspace):
        """Every join receives a fresh session_id."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-sess1",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data.get("session_id"), "join response must include session_id"
        assert len(data["session_id"]) >= 16

    def test_rejoin_rotates_session_id(self, client, workspace):
        """A second join as the same agent rotates the session, invalidating the first."""
        r1 = client.post("/v1/join", json={
            "agent_name": "agent-sess2",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        s1 = r1.json()["data"]["session_id"]

        r2 = client.post("/v1/join", json={
            "agent_name": "agent-sess2",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        s2 = r2.json()["data"]["session_id"]

        assert s1 and s2 and s1 != s2, "rejoin must rotate session_id"

    def test_heartbeat_with_stale_session_is_rejected(self, client, workspace):
        """Heartbeat with a revoked session_id returns 401 session_revoked."""
        r1 = client.post("/v1/join", json={
            "agent_name": "agent-sess3",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        stale_session = r1.json()["data"]["session_id"]

        # Rejoin (rotates the session)
        client.post("/v1/join", json={
            "agent_name": "agent-sess3",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        # Old client heartbeats with its now-stale session_id
        hb = client.post("/v1/heartbeat", json={
            "agent_name": "agent-sess3",
            "network": workspace["id"],
            "session_id": stale_session,
        })
        assert hb.status_code == 401
        assert "session_revoked" in hb.json().get("message", "").lower()

    def test_heartbeat_with_current_session_ok(self, client, workspace):
        """Heartbeat with the current session_id succeeds."""
        r = client.post("/v1/join", json={
            "agent_name": "agent-sess4",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        sid = r.json()["data"]["session_id"]

        hb = client.post("/v1/heartbeat", json={
            "agent_name": "agent-sess4",
            "network": workspace["id"],
            "session_id": sid,
        })
        assert hb.status_code == 200

    def test_heartbeat_without_session_id_legacy_ok(self, client, workspace):
        """Legacy clients that don't send session_id still work during transition."""
        client.post("/v1/join", json={
            "agent_name": "agent-sess5",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        hb = client.post("/v1/heartbeat", json={
            "agent_name": "agent-sess5",
            "network": workspace["id"],
            # no session_id
        })
        assert hb.status_code == 200

    def test_message_post_with_stale_session_is_rejected(self, client, workspace):
        """Events posted with a stale session_id are rejected."""
        r1 = client.post("/v1/join", json={
            "agent_name": "agent-sess6",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        stale_session = r1.json()["data"]["session_id"]

        # Rejoin (rotates)
        client.post("/v1/join", json={
            "agent_name": "agent-sess6",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        # Create a channel so the event has somewhere to go
        resp = client.post("/v1/events", json={
            "network": workspace["id"],
            "type": "workspace.message.posted",
            "source": "openagents:agent-sess6",
            "target": "channel/general",
            "payload": {"content": "ghost reply", "message_type": "chat"},
            "metadata": {"session_id": stale_session},
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 401
        assert "session_revoked" in resp.json().get("message", "").lower()
