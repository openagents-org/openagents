# -*- coding: utf-8 -*-
"""
/v1/leave and /v1/heartbeat credential checks.

These endpoints historically self-supplied the workspace token to the event
pipeline, so anyone who knew a workspace slug and an agent name could mark
the agent offline. Clients have always sent X-Workspace-Token; the server now
verifies it — warn-and-accept by default, rejecting only when
ENFORCE_AGENT_LIFECYCLE_AUTH is on (planned to become the default one
release later).
"""

import pytest

from app.config import config


def _join(client, workspace, name="agent-life"):
    resp = client.post("/v1/join", json={
        "agent_name": name,
        "token": workspace["token"],
        "network": workspace["id"],
    })
    assert resp.status_code == 200
    return name


@pytest.fixture
def enforce_lifecycle_auth():
    old = config.ENFORCE_AGENT_LIFECYCLE_AUTH
    config.ENFORCE_AGENT_LIFECYCLE_AUTH = True
    try:
        yield
    finally:
        config.ENFORCE_AGENT_LIFECYCLE_AUTH = old


class TestLeaveAuth:
    def test_leave_with_valid_token(self, client, workspace):
        name = _join(client, workspace)
        resp = client.post(
            "/v1/leave",
            json={"agent_name": name, "network": workspace["id"]},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        assert resp.json()["data"]["status"] == "offline"

    def test_leave_without_token_warns_but_accepts(self, client, workspace, caplog):
        """Warn-and-accept phase: legacy callers keep working, loudly."""
        name = _join(client, workspace)
        with caplog.at_level("WARNING", logger="app.routers.network"):
            resp = client.post(
                "/v1/leave",
                json={"agent_name": name, "network": workspace["id"]},
            )
        assert resp.status_code == 200
        assert any("/v1/leave" in r.message for r in caplog.records)

    def test_leave_with_bad_token_rejected_when_enforced(
        self, client, workspace, enforce_lifecycle_auth
    ):
        name = _join(client, workspace)
        resp = client.post(
            "/v1/leave",
            json={"agent_name": name, "network": workspace["id"]},
            headers={"X-Workspace-Token": "definitely-wrong-token"},
        )
        assert resp.status_code == 401
        # And the agent was not marked offline by the rejected call.
        resp = client.post(
            "/v1/leave",
            json={"agent_name": name, "network": workspace["id"]},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200

    def test_leave_with_valid_token_still_works_when_enforced(
        self, client, workspace, enforce_lifecycle_auth
    ):
        name = _join(client, workspace)
        resp = client.post(
            "/v1/leave",
            json={"agent_name": name, "network": workspace["id"]},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200


class TestHeartbeatAuth:
    def test_heartbeat_with_valid_token(self, client, workspace):
        name = _join(client, workspace)
        resp = client.post(
            "/v1/heartbeat",
            json={"agent_name": name, "network": workspace["id"]},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200

    def test_heartbeat_without_token_warns_but_accepts(self, client, workspace, caplog):
        name = _join(client, workspace)
        with caplog.at_level("WARNING", logger="app.routers.network"):
            resp = client.post(
                "/v1/heartbeat",
                json={"agent_name": name, "network": workspace["id"]},
            )
        assert resp.status_code == 200
        assert any("/v1/heartbeat" in r.message for r in caplog.records)

    def test_heartbeat_with_bad_token_rejected_when_enforced(
        self, client, workspace, enforce_lifecycle_auth
    ):
        name = _join(client, workspace)
        resp = client.post(
            "/v1/heartbeat",
            json={"agent_name": name, "network": workspace["id"]},
            headers={"X-Workspace-Token": "definitely-wrong-token"},
        )
        assert resp.status_code == 401
