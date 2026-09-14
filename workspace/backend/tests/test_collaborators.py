# -*- coding: utf-8 -*-
"""
Tests for email-based workspace sharing (collaborators).

Covers:
  - CRUD: add, list, remove collaborators
  - Upsert: adding same email updates role
  - Owner rejection: can't add workspace owner as collaborator
  - Email normalization: emails are lowercased
  - Invalid role rejection
  - Auth required: endpoints reject unauthenticated requests
  - Auth via collaborator email: bearer token with collaborator email grants access
"""

import pytest
from unittest.mock import patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_workspace(client, name="Test WS", agent_name="agent-alpha", creator_email=None):
    body = {"name": name, "agent_name": agent_name}
    if creator_email:
        body["creator_email"] = creator_email
    resp = client.post("/v1/workspaces", json=body)
    assert resp.status_code == 200
    return resp.json()["data"]


def _mock_firebase(email):
    return patch("app.firebase_auth.verify_firebase_token", return_value=email)


# ===========================================================================
# Collaborator CRUD endpoints
# ===========================================================================

class TestCollaboratorEndpoints:

    def test_add_and_list(self, client, workspace):
        """Add a collaborator, then list — it should appear."""
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "alice@example.com", "role": "editor"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["email"] == "alice@example.com"
        assert data["role"] == "editor"

        # List
        resp = client.get(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["owner"] == "test@example.com"
        assert len(data["collaborators"]) == 1
        assert data["collaborators"][0]["email"] == "alice@example.com"

    def test_add_multiple(self, client, workspace):
        """Add multiple collaborators."""
        for email in ["alice@example.com", "bob@example.com", "carol@example.com"]:
            resp = client.post(
                f"/v1/workspaces/{workspace['id']}/collaborators",
                json={"email": email},
                headers={"X-Workspace-Token": workspace["token"]},
            )
            assert resp.status_code == 200

        resp = client.get(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            headers={"X-Workspace-Token": workspace["token"]},
        )
        emails = [c["email"] for c in resp.json()["data"]["collaborators"]]
        assert set(emails) == {"alice@example.com", "bob@example.com", "carol@example.com"}

    def test_upsert_updates_role(self, client, workspace):
        """Adding same email again updates the role."""
        headers = {"X-Workspace-Token": workspace["token"]}

        client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "alice@example.com", "role": "editor"},
            headers=headers,
        )

        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "alice@example.com", "role": "viewer"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["role"] == "viewer"

        # List should have exactly 1 entry
        resp = client.get(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            headers=headers,
        )
        assert len(resp.json()["data"]["collaborators"]) == 1

    def test_reject_owner_email(self, client, workspace):
        """Can't add the workspace owner as a collaborator."""
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "test@example.com"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.json()["code"] == 409  # CONFLICT

    def test_email_normalized(self, client, workspace):
        """Emails are normalized to lowercase."""
        headers = {"X-Workspace-Token": workspace["token"]}

        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "Alice@Example.COM"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["email"] == "alice@example.com"

    def test_invalid_email(self, client, workspace):
        """Reject emails without @."""
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "notanemail"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.json()["code"] == 400  # BAD_REQUEST

    def test_remove_collaborator(self, client, workspace):
        """Remove a collaborator."""
        headers = {"X-Workspace-Token": workspace["token"]}

        client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "alice@example.com"},
            headers=headers,
        )

        resp = client.delete(
            f"/v1/workspaces/{workspace['id']}/collaborators/alice@example.com",
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["removed"] is True

        # Verify gone
        resp = client.get(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            headers=headers,
        )
        assert len(resp.json()["data"]["collaborators"]) == 0

    def test_remove_nonexistent(self, client, workspace):
        """Removing a non-existent collaborator returns 404."""
        resp = client.delete(
            f"/v1/workspaces/{workspace['id']}/collaborators/nobody@example.com",
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.json()["code"] == 404

    def test_auth_required(self, client, workspace):
        """Endpoints reject unauthenticated requests."""
        resp = client.get(f"/v1/workspaces/{workspace['id']}/collaborators")
        assert resp.json()["code"] == 401

        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "x@y.com"},
        )
        assert resp.json()["code"] == 401


# ===========================================================================
# Auth via collaborator email
# ===========================================================================

class TestCollaboratorAuth:

    def test_collaborator_bearer_grants_access(self, client, workspace):
        """A Firebase bearer token matching a collaborator email grants workspace access."""
        headers = {"X-Workspace-Token": workspace["token"]}

        # Add collaborator
        client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "collab@example.com"},
            headers=headers,
        )

        # Collab accesses workspace via bearer
        with _mock_firebase("collab@example.com"):
            resp = client.get(
                f"/v1/workspaces/{workspace['id']}/collaborators",
                headers={"Authorization": "Bearer fake-token"},
            )
            assert resp.status_code == 200
            assert resp.json()["code"] == 0

    def test_non_collaborator_bearer_rejected(self, client, workspace):
        """A bearer token for an email not in collaborators is rejected."""
        with _mock_firebase("stranger@example.com"):
            resp = client.get(
                f"/v1/workspaces/{workspace['id']}/collaborators",
                headers={"Authorization": "Bearer fake-token"},
            )
            assert resp.json()["code"] == 401

    def test_collaborator_can_send_event(self, client, workspace):
        """A collaborator can send events (messages) via the event pipeline."""
        headers = {"X-Workspace-Token": workspace["token"]}

        # Add collaborator
        client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "collab@example.com"},
            headers=headers,
        )

        # Collab sends a message via bearer
        with _mock_firebase("collab@example.com"):
            resp = client.post(
                "/v1/events",
                json={
                    "type": "workspace.message.posted",
                    "source": "human:collab",
                    "target": f"channel/{workspace['channel']}",
                    "network": workspace["id"],
                    "payload": {"content": "Hello from collaborator", "sender_type": "human"},
                },
                headers={"Authorization": "Bearer fake-token"},
            )
            assert resp.status_code == 200
            assert resp.json()["code"] == 0


# ===========================================================================
# Profile enrichment — the picture and name come from the account, not from
# whatever the collaborator row was created with.
# ===========================================================================

class TestCollaboratorProfiles:

    AVATAR = "data:image/png;base64,iVBORw0KGgo="

    def _account(self, db, email, display_name=None, avatar_url=None):
        from app.models import User
        user = User(email=email, display_name=display_name, avatar_url=avatar_url)
        db.add(user)
        db.commit()
        return user

    def test_list_carries_the_account_avatar(self, client, db, workspace):
        self._account(db, "alice@example.com", "Alice Liddell", self.AVATAR)
        headers = {"X-Workspace-Token": workspace["token"]}
        client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "alice@example.com"},
            headers=headers,
        )

        resp = client.get(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            headers=headers,
        )
        row = next(
            c for c in resp.json()["data"]["collaborators"]
            if c["email"] == "alice@example.com"
        )
        assert row["avatarUrl"] == self.AVATAR
        # The account's own name wins over the collaborator row's snapshot.
        assert row["displayName"] == "Alice Liddell"

    def test_collaborator_without_an_account_still_lists(self, client, workspace):
        """Invited but never signed in: a null picture, not a 500."""
        headers = {"X-Workspace-Token": workspace["token"]}
        client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "ghost@example.com"},
            headers=headers,
        )

        resp = client.get(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            headers=headers,
        )
        row = next(
            c for c in resp.json()["data"]["collaborators"]
            if c["email"] == "ghost@example.com"
        )
        assert row["avatarUrl"] is None

    def test_add_returns_the_same_enriched_shape(self, client, db, workspace):
        """The POST response feeds the list straight away — it must match."""
        self._account(db, "bob@example.com", "Bob", self.AVATAR)
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/collaborators",
            json={"email": "bob@example.com"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        data = resp.json()["data"]
        assert data["avatarUrl"] == self.AVATAR
        assert data["displayName"] == "Bob"

    def test_presence_ping_returns_the_avatar(self, client, db, workspace):
        """Self-registration on workspace open is where most rows come from."""
        self._account(db, "carol@example.com", "Carol", self.AVATAR)
        resp = client.post(
            f"/v1/workspaces/{workspace['id']}/presence",
            json={"senderEmail": "Carol@Example.com", "senderDisplayName": "C"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        data = resp.json()["data"]
        # Matched case-insensitively: the collaborator row is lowercased on
        # write, the account row is not guaranteed to be.
        assert data["avatarUrl"] == self.AVATAR
