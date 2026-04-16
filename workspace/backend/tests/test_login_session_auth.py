# -*- coding: utf-8 -*-
"""
Integration tests for login and session authentication endpoints.

Covers:
  - Workspace token auth (X-Workspace-Token header)
  - Firebase bearer token auth (Authorization: Bearer)
  - Workspace claim flow (POST /v1/workspaces/{id}/claim)
  - Token rotation security
  - Session lifecycle (join → heartbeat → leave → rejoin)
  - Cross-workspace token isolation
  - Auth mod pipeline rejection
  - Event auth via both token and bearer paths
"""

import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_workspace(client, name="Test WS", agent_name="agent-alpha", creator_email=None):
    """Create a workspace and return its details."""
    body = {"name": name, "agent_name": agent_name}
    if creator_email:
        body["creator_email"] = creator_email
    resp = client.post("/v1/workspaces", json=body)
    assert resp.status_code == 200
    return resp.json()["data"]


def _mock_firebase_verify(email):
    """Return a patcher that makes verify_firebase_token return the given email."""
    return patch(
        "app.firebase_auth.verify_firebase_token",
        return_value=email,
    )


# ===========================================================================
# Token-Based Login (Workspace Token)
# ===========================================================================

class TestTokenLogin:
    """Login/join flow using workspace tokens (X-Workspace-Token header)."""

    def test_join_with_correct_token(self, client, workspace):
        """Agent joins successfully with the correct workspace token."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-new",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["agent_name"] == "agent-new"
        assert data["status"] == "online"

    def test_join_with_wrong_token_rejected(self, client, workspace):
        """Agent cannot join with an incorrect token."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-intruder",
            "token": "definitely-wrong-token",
            "network": workspace["id"],
        })
        assert resp.status_code == 401

    def test_send_event_with_correct_token(self, client, workspace):
        """Events pass auth mod when X-Workspace-Token is correct."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user",
            "target": f"channel/{channel_name}",
            "payload": {"content": "hello"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200

    def test_send_event_with_wrong_token_rejected(self, client, workspace):
        """Events are rejected by auth mod when token is wrong."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user",
            "target": f"channel/{channel_name}",
            "payload": {"content": "hello"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": "wrong-token"})
        assert resp.status_code == 401

    def test_send_event_with_no_token_rejected(self, client, workspace):
        """Events without any auth credentials are rejected."""
        channel_name = workspace["channel"]["name"]
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user",
            "target": f"channel/{channel_name}",
            "payload": {"content": "hello"},
            "network": workspace["id"],
        })
        assert resp.status_code == 401


# ===========================================================================
# Firebase Bearer Token Auth
# ===========================================================================

class TestBearerAuth:
    """Login/auth via Firebase bearer token (Authorization: Bearer)."""

    def test_send_event_with_valid_bearer(self, client, workspace):
        """Events pass auth mod when bearer token resolves to workspace creator."""
        channel_name = workspace["channel"]["name"]
        with _mock_firebase_verify("test@example.com"):
            resp = client.post("/v1/events", json={
                "type": "workspace.message.posted",
                "source": "human:user",
                "target": f"channel/{channel_name}",
                "payload": {"content": "via bearer"},
                "network": workspace["id"],
            }, headers={"Authorization": "Bearer valid-firebase-token"})
        assert resp.status_code == 200

    def test_send_event_bearer_wrong_email_rejected(self, client, workspace):
        """Bearer token with a different email than creator is rejected."""
        channel_name = workspace["channel"]["name"]
        with _mock_firebase_verify("wrong@example.com"):
            resp = client.post("/v1/events", json={
                "type": "workspace.message.posted",
                "source": "human:user",
                "target": f"channel/{channel_name}",
                "payload": {"content": "intruder"},
                "network": workspace["id"],
            }, headers={"Authorization": "Bearer wrong-user-token"})
        assert resp.status_code == 401

    def test_send_event_bearer_returns_none_rejected(self, client, workspace):
        """Bearer token that fails Firebase verification is rejected."""
        channel_name = workspace["channel"]["name"]
        with _mock_firebase_verify(None):
            resp = client.post("/v1/events", json={
                "type": "workspace.message.posted",
                "source": "human:user",
                "target": f"channel/{channel_name}",
                "payload": {"content": "bad token"},
                "network": workspace["id"],
            }, headers={"Authorization": "Bearer invalid-token"})
        assert resp.status_code == 401

    def test_rotate_token_via_bearer(self, client, workspace):
        """Workspace owner can rotate token using bearer auth instead of token."""
        with _mock_firebase_verify("test@example.com"):
            resp = client.post(
                f"/v1/workspaces/{workspace['id']}/rotate-token",
                headers={"Authorization": "Bearer valid-firebase-token"},
            )
        assert resp.status_code == 200
        new_token = resp.json()["data"]["token"]
        assert new_token != workspace["token"]

    def test_remove_member_via_bearer(self, client, workspace):
        """Workspace owner can remove members using bearer auth."""
        # Join an agent
        client.post("/v1/join", json={
            "agent_name": "agent-removable",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        with _mock_firebase_verify("test@example.com"):
            resp = client.delete(
                f"/v1/workspaces/{workspace['id']}/members/agent-removable",
                headers={"Authorization": "Bearer valid-firebase-token"},
            )
        assert resp.status_code == 200
        assert resp.json()["data"]["removed"] is True

    def test_get_channel_via_bearer(self, client, workspace):
        """Workspace owner can access channels using bearer auth."""
        channel_name = workspace["channel"]["name"]
        with _mock_firebase_verify("test@example.com"):
            resp = client.get(
                f"/v1/workspaces/{workspace['id']}/channels/{channel_name}",
                headers={"Authorization": "Bearer valid-firebase-token"},
            )
        assert resp.status_code == 200
        assert resp.json()["data"]["name"] == channel_name

    def test_get_channel_bearer_wrong_email(self, client, workspace):
        """Non-owner bearer auth cannot access channels."""
        channel_name = workspace["channel"]["name"]
        with _mock_firebase_verify("other@example.com"):
            resp = client.get(
                f"/v1/workspaces/{workspace['id']}/channels/{channel_name}",
                headers={"Authorization": "Bearer other-user-token"},
            )
        assert resp.status_code == 401


# ===========================================================================
# Workspace Claim Flow
# ===========================================================================

class TestWorkspaceClaim:
    """POST /v1/workspaces/{id}/claim — claim workspace ownership."""

    def test_claim_unclaimed_workspace(self, client):
        """User can claim a workspace that has no creator_email set."""
        ws = _create_workspace(client, name="Unclaimed WS", agent_name="bot")
        ws_id = ws["workspaceId"]

        with _mock_firebase_verify("claimer@example.com"):
            resp = client.post(
                f"/v1/workspaces/{ws_id}/claim",
                headers={"Authorization": "Bearer claim-token"},
            )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["creatorEmail"] == "claimer@example.com"

    def test_claim_already_owned_by_same_user(self, client, workspace):
        """Re-claiming by the same owner succeeds (idempotent)."""
        with _mock_firebase_verify("test@example.com"):
            resp = client.post(
                f"/v1/workspaces/{workspace['id']}/claim",
                headers={"Authorization": "Bearer valid-token"},
            )
        assert resp.status_code == 200
        assert resp.json()["data"]["creatorEmail"] == "test@example.com"

    def test_claim_already_owned_by_different_user(self, client, workspace):
        """Claiming a workspace owned by someone else is forbidden."""
        with _mock_firebase_verify("attacker@evil.com"):
            resp = client.post(
                f"/v1/workspaces/{workspace['id']}/claim",
                headers={"Authorization": "Bearer attacker-token"},
            )
        assert resp.status_code == 403
        assert "already claimed" in resp.json()["message"].lower()

    def test_claim_without_bearer_token(self, client, workspace):
        """Claim without bearer token returns 401."""
        resp = client.post(f"/v1/workspaces/{workspace['id']}/claim")
        assert resp.status_code == 401

    def test_claim_with_invalid_bearer(self, client, workspace):
        """Claim with invalid Firebase token returns 401."""
        with _mock_firebase_verify(None):
            resp = client.post(
                f"/v1/workspaces/{workspace['id']}/claim",
                headers={"Authorization": "Bearer expired-token"},
            )
        assert resp.status_code == 401

    def test_claim_nonexistent_workspace(self, client):
        """Claiming nonexistent workspace returns 404."""
        with _mock_firebase_verify("user@example.com"):
            resp = client.post(
                "/v1/workspaces/nonexistent/claim",
                headers={"Authorization": "Bearer valid-token"},
            )
        assert resp.status_code == 404

    def test_claimed_workspace_accessible_via_bearer(self, client):
        """After claiming, the owner can use bearer auth to access protected endpoints."""
        ws = _create_workspace(client, name="Claimable", agent_name="bot")
        ws_id = ws["workspaceId"]

        # Claim
        with _mock_firebase_verify("owner@example.com"):
            client.post(
                f"/v1/workspaces/{ws_id}/claim",
                headers={"Authorization": "Bearer claim-token"},
            )

        # Now use bearer auth to rotate token (a protected action)
        with _mock_firebase_verify("owner@example.com"):
            resp = client.post(
                f"/v1/workspaces/{ws_id}/rotate-token",
                headers={"Authorization": "Bearer owner-token"},
            )
        assert resp.status_code == 200


# ===========================================================================
# Token Rotation Security
# ===========================================================================

class TestTokenRotationSecurity:
    """Security tests for token rotation."""

    def test_old_token_invalid_after_rotation(self, client, workspace):
        """Old workspace token stops working immediately after rotation."""
        old_token = workspace["token"]

        # Rotate
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/rotate-token",
            headers={"X-Workspace-Token": old_token},
        )
        new_token = resp.json()["data"]["token"]

        # Old token should fail to join
        resp = client.post("/v1/join", json={
            "agent_name": "agent-late",
            "token": old_token,
            "network": workspace["id"],
        })
        assert resp.status_code == 401

        # New token should work
        resp = client.post("/v1/join", json={
            "agent_name": "agent-late",
            "token": new_token,
            "network": workspace["id"],
        })
        assert resp.status_code == 200

    def test_old_token_invalid_for_events_after_rotation(self, client, workspace):
        """Old token can't send events after rotation."""
        old_token = workspace["token"]
        channel_name = workspace["channel"]["name"]

        # Rotate
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/rotate-token",
            headers={"X-Workspace-Token": old_token},
        )
        new_token = resp.json()["data"]["token"]

        # Old token should be rejected
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user",
            "target": f"channel/{channel_name}",
            "payload": {"content": "stale auth"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": old_token})
        assert resp.status_code == 401

        # New token should work
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user",
            "target": f"channel/{channel_name}",
            "payload": {"content": "fresh auth"},
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": new_token})
        assert resp.status_code == 200

    def test_old_token_invalid_for_resolve_after_rotation(self, client, workspace):
        """Token resolve returns not-found for old token after rotation."""
        old_token = workspace["token"]

        # Rotate
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/rotate-token",
            headers={"X-Workspace-Token": old_token},
        )
        new_token = resp.json()["data"]["token"]

        # Old token can't resolve
        resp = client.post("/v1/token/resolve", json={"token": old_token})
        assert resp.status_code == 404

        # New token resolves
        resp = client.post("/v1/token/resolve", json={"token": new_token})
        assert resp.status_code == 200
        assert resp.json()["data"]["workspace_id"] == workspace["id"]


# ===========================================================================
# Cross-Workspace Token Isolation
# ===========================================================================

class TestCrossWorkspaceIsolation:
    """Ensure tokens from one workspace can't access another."""

    def test_join_other_workspace_with_wrong_token(self, client):
        """Token from workspace A cannot be used to join workspace B."""
        ws_a = _create_workspace(client, name="Workspace A", agent_name="agent-a")
        ws_b = _create_workspace(client, name="Workspace B", agent_name="agent-b")

        # Try to join workspace B with workspace A's token
        resp = client.post("/v1/join", json={
            "agent_name": "agent-intruder",
            "token": ws_a["token"],
            "network": ws_b["workspaceId"],
        })
        assert resp.status_code == 401

    def test_send_event_to_other_workspace_rejected(self, client):
        """Token from workspace A cannot send events to workspace B."""
        ws_a = _create_workspace(client, name="WS A", agent_name="agent-a")
        ws_b = _create_workspace(client, name="WS B", agent_name="agent-b")

        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user",
            "target": "channel/any",
            "payload": {"content": "cross-workspace"},
            "network": ws_b["workspaceId"],
        }, headers={"X-Workspace-Token": ws_a["token"]})
        assert resp.status_code == 401

    def test_token_resolve_returns_correct_workspace(self, client):
        """Token resolve maps to the correct workspace only."""
        ws_a = _create_workspace(client, name="WS A", agent_name="agent-a")
        ws_b = _create_workspace(client, name="WS B", agent_name="agent-b")

        resp_a = client.post("/v1/token/resolve", json={"token": ws_a["token"]})
        resp_b = client.post("/v1/token/resolve", json={"token": ws_b["token"]})

        assert resp_a.json()["data"]["workspace_id"] == ws_a["workspaceId"]
        assert resp_b.json()["data"]["workspace_id"] == ws_b["workspaceId"]
        assert resp_a.json()["data"]["workspace_id"] != resp_b.json()["data"]["workspace_id"]

    def test_bearer_auth_scoped_to_creator_workspace(self, client):
        """Bearer auth only works for workspaces where the user is creator."""
        ws_a = _create_workspace(client, name="WS A", agent_name="agent-a", creator_email="alice@example.com")
        ws_b = _create_workspace(client, name="WS B", agent_name="agent-b", creator_email="bob@example.com")

        # Alice can rotate her workspace token
        with _mock_firebase_verify("alice@example.com"):
            resp = client.post(
                f"/v1/workspaces/{ws_a['workspaceId']}/rotate-token",
                headers={"Authorization": "Bearer alice-token"},
            )
        assert resp.status_code == 200

        # Alice cannot rotate Bob's workspace token
        with _mock_firebase_verify("alice@example.com"):
            resp = client.post(
                f"/v1/workspaces/{ws_b['workspaceId']}/rotate-token",
                headers={"Authorization": "Bearer alice-token"},
            )
        assert resp.status_code == 401


# ===========================================================================
# Session Lifecycle (Join → Heartbeat → Leave → Rejoin)
# ===========================================================================

class TestSessionLifecycle:
    """Full agent session lifecycle through the network endpoints."""

    def test_full_lifecycle(self, client, workspace):
        """Agent goes through join → heartbeat → leave → rejoin cycle."""
        agent = "agent-lifecycle"
        token = workspace["token"]
        network = workspace["id"]

        # 1. Join
        resp = client.post("/v1/join", json={
            "agent_name": agent, "token": token, "network": network,
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "online"

        # 2. Verify visible in discover
        disc = client.get("/v1/discover", params={"network": network},
                          headers={"X-Workspace-Token": token})
        addresses = [a["address"] for a in disc.json()["data"]["agents"]]
        assert f"openagents:{agent}" in addresses

        # 3. Heartbeat
        resp = client.post("/v1/heartbeat", json={
            "agent_name": agent, "network": network,
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "online"

        # 4. Leave
        resp = client.post("/v1/leave", json={
            "agent_name": agent, "network": network,
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "offline"

        # 5. Rejoin
        resp = client.post("/v1/join", json={
            "agent_name": agent, "token": token, "network": network,
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "online"

    def test_multiple_agents_join(self, client, workspace):
        """Multiple agents can join the same workspace."""
        for i in range(5):
            resp = client.post("/v1/join", json={
                "agent_name": f"agent-{i}",
                "token": workspace["token"],
                "network": workspace["id"],
            })
            assert resp.status_code == 200

        # All agents visible in discover
        disc = client.get("/v1/discover", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        agents = disc.json()["data"]["agents"]
        # 5 new agents + 1 master (agent-alpha)
        assert len(agents) == 6

    def test_join_generates_event_in_store(self, client, workspace):
        """Join creates a network.agent.join event that can be polled."""
        client.post("/v1/join", json={
            "agent_name": "agent-evented",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "network.agent.join",
        }, headers={"X-Workspace-Token": workspace["token"]})
        events = resp.json()["data"]["events"]
        sources = [e["source"] for e in events]
        assert "openagents:agent-evented" in sources

    def test_leave_generates_event_in_store(self, client, workspace):
        """Leave creates a network.agent.leave event."""
        client.post("/v1/join", json={
            "agent_name": "agent-leaver",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        client.post("/v1/leave", json={
            "agent_name": "agent-leaver",
            "network": workspace["id"],
        })

        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "network.agent.leave",
        }, headers={"X-Workspace-Token": workspace["token"]})
        events = resp.json()["data"]["events"]
        sources = [e["source"] for e in events]
        assert "openagents:agent-leaver" in sources

    def test_heartbeat_generates_event(self, client, workspace):
        """Heartbeat creates a network.ping event."""
        client.post("/v1/join", json={
            "agent_name": "agent-pinger",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        client.post("/v1/heartbeat", json={
            "agent_name": "agent-pinger",
            "network": workspace["id"],
        })

        resp = client.get("/v1/events", params={
            "network": workspace["id"],
            "type": "network.ping",
        }, headers={"X-Workspace-Token": workspace["token"]})
        events = resp.json()["data"]["events"]
        sources = [e["source"] for e in events]
        assert "openagents:agent-pinger" in sources


# ===========================================================================
# Workspace Without Password (Open Access)
# ===========================================================================

class TestOpenWorkspace:
    """Workspaces without a password_hash allow unauthenticated access."""

    def test_open_workspace_allows_events_without_token(self, client, db):
        """Workspace with no password allows events without credentials."""
        from app.models import Workspace, Channel, ChannelMember
        import uuid

        # Create workspace directly in DB with no password
        ws = Workspace(
            slug="open-ws",
            name="Open Workspace",
            password_hash=None,
            settings={},
            status="active",
        )
        db.add(ws)
        db.flush()

        ch = Channel(
            workspace_id=ws.id,
            name="open-channel",
            title="Open Channel",
            created_by="anyone",
            status="active",
        )
        db.add(ch)
        db.commit()

        # Send event without any auth headers
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:anonymous",
            "target": "channel/open-channel",
            "payload": {"content": "no auth needed"},
            "network": str(ws.id),
        })
        assert resp.status_code == 200


# ===========================================================================
# Remove Agent Auth
# ===========================================================================

class TestRemoveAgentAuth:
    """POST /v1/remove — removing agents requires auth."""

    def test_remove_with_valid_token(self, client, workspace):
        """Can remove agent with valid workspace token."""
        # Join agent
        client.post("/v1/join", json={
            "agent_name": "agent-target",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        resp = client.post("/v1/remove", json={
            "agent_name": "agent-target",
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200

    def test_remove_without_credentials_rejected(self, client, workspace):
        """Cannot remove agent without credentials."""
        client.post("/v1/join", json={
            "agent_name": "agent-safe",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        resp = client.post("/v1/remove", json={
            "agent_name": "agent-safe",
            "network": workspace["id"],
        })
        assert resp.status_code == 401

    def test_remove_with_bearer_auth(self, client, workspace):
        """Can remove agent via Firebase bearer auth as workspace owner."""
        client.post("/v1/join", json={
            "agent_name": "agent-bye",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        with _mock_firebase_verify("test@example.com"):
            resp = client.post("/v1/remove", json={
                "agent_name": "agent-bye",
                "network": workspace["id"],
            }, headers={"Authorization": "Bearer owner-token"})
        assert resp.status_code == 200

    def test_remove_with_wrong_bearer_rejected(self, client, workspace):
        """Cannot remove agent with bearer auth from non-owner."""
        client.post("/v1/join", json={
            "agent_name": "agent-protected",
            "token": workspace["token"],
            "network": workspace["id"],
        })

        with _mock_firebase_verify("other@example.com"):
            resp = client.post("/v1/remove", json={
                "agent_name": "agent-protected",
                "network": workspace["id"],
            }, headers={"Authorization": "Bearer other-token"})
        assert resp.status_code == 401


# ===========================================================================
# Token Resolve Edge Cases
# ===========================================================================

class TestTokenResolveEdgeCases:
    """Edge cases for POST /v1/token/resolve."""

    def test_resolve_deleted_workspace_token(self, client, workspace):
        """Token for a deleted workspace returns 404."""
        # Delete the workspace (auth required)
        client.delete(
            f"/v1/workspaces/{workspace['id']}",
            headers={"X-Workspace-Token": workspace["token"]},
        )

        # Token should no longer resolve
        resp = client.post("/v1/token/resolve", json={"token": workspace["token"]})
        assert resp.status_code == 404

    def test_resolve_returns_workspace_metadata(self, client, workspace):
        """Token resolve returns workspace id, slug, and name."""
        resp = client.post("/v1/token/resolve", json={"token": workspace["token"]})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert "workspace_id" in data
        assert "slug" in data
        assert "name" in data
        assert data["name"] == "Test Workspace"

    def test_join_via_token_only_resolve(self, client, workspace):
        """Agent joins without specifying network — token resolves it."""
        resp = client.post("/v1/join", json={
            "agent_name": "agent-token-resolve",
            "token": workspace["token"],
        })
        assert resp.status_code == 200
        assert resp.json()["data"]["network_id"] == workspace["id"]


# ===========================================================================
# Auth Header Parsing
# ===========================================================================

class TestAuthHeaderParsing:
    """Edge cases for Authorization header parsing."""

    def test_bearer_prefix_case_insensitive(self, client, workspace):
        """'Bearer', 'bearer', 'BEARER' prefixes all work."""
        channel_name = workspace["channel"]["name"]
        for prefix in ["Bearer", "bearer", "BEARER"]:
            with _mock_firebase_verify("test@example.com"):
                resp = client.post("/v1/events", json={
                    "type": "workspace.message.posted",
                    "source": "human:user",
                    "target": f"channel/{channel_name}",
                    "payload": {"content": "case test"},
                    "network": workspace["id"],
                }, headers={"Authorization": f"{prefix} valid-token"})
            assert resp.status_code == 200, f"Failed for prefix: {prefix}"

    def test_non_bearer_auth_header_ignored(self, client, workspace):
        """Non-Bearer auth scheme is not treated as bearer auth."""
        channel_name = workspace["channel"]["name"]
        # Basic auth header should not trigger bearer path
        resp = client.post("/v1/events", json={
            "type": "workspace.message.posted",
            "source": "human:user",
            "target": f"channel/{channel_name}",
            "payload": {"content": "basic auth"},
            "network": workspace["id"],
        }, headers={"Authorization": "Basic dXNlcjpwYXNz"})
        # Should be rejected (no valid token path)
        assert resp.status_code == 401

    def test_empty_bearer_token_rejected(self, client, workspace):
        """Authorization header with empty bearer token is rejected."""
        channel_name = workspace["channel"]["name"]
        with _mock_firebase_verify(None):
            resp = client.post("/v1/events", json={
                "type": "workspace.message.posted",
                "source": "human:user",
                "target": f"channel/{channel_name}",
                "payload": {"content": "empty bearer"},
                "network": workspace["id"],
            }, headers={"Authorization": "Bearer "})
        assert resp.status_code == 401
