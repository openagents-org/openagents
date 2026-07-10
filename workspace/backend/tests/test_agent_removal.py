# -*- coding: utf-8 -*-
"""
Tests for sticky agent removal (issue #347).

Background: /v1/remove used to hard-delete the WorkspaceMember, but a still-running
agent daemon would re-POST /v1/join on reconnect and _handle_agent_join blindly
upserted the row back to status="online" — so a removed agent reappeared in
/v1/discover. Removal must be sticky: a removed agent cannot resurrect itself by
re-joining or heartbeating, and must not show in discovery. Re-adding a cloud
agent through POST /v1/cloud-agents reactivates it.

Offline members are a separate, intentional concept (mobile clients rely on
membership, not online status) and must keep appearing in discovery — these
tests pin that the "removed" filter does not over-filter offline members.
"""

from app.models import WorkspaceMember


def _join(client, workspace, agent_name):
    return client.post(
        "/v1/join",
        json={
            "agent_name": agent_name,
            "token": workspace["token"],
            "network": workspace["id"],
        },
    )


def _remove(client, workspace, agent_name):
    return client.post(
        "/v1/remove",
        json={
            "agent_name": agent_name,
            "network": workspace["id"],
        },
        headers={"X-Workspace-Token": workspace["token"]},
    )


def _heartbeat(client, workspace, agent_name, session_id=None):
    payload = {"agent_name": agent_name, "network": workspace["id"]}
    if session_id:
        payload["session_id"] = session_id
    return client.post("/v1/heartbeat", json=payload)


def _discover_agents(client, workspace):
    resp = client.get(
        "/v1/discover", params={"network": workspace["id"]}, headers={"X-Workspace-Token": workspace["token"]}
    )
    assert resp.status_code == 200
    return [a["address"] for a in resp.json()["data"]["agents"]]


class TestStickyAgentRemoval:
    """Removal must not be reversible by the removed agent's own daemon."""

    def test_removed_agent_excluded_from_discover(self, client, workspace):
        _join(client, workspace, "agent-beta")
        assert "openagents:agent-beta" in _discover_agents(client, workspace)

        resp = _remove(client, workspace, "agent-beta")
        assert resp.status_code == 200

        names = _discover_agents(client, workspace)
        assert "openagents:agent-beta" not in names
        # Other agents are unaffected.
        assert "openagents:agent-alpha" in names

    def test_removed_agent_cannot_rejoin(self, client, workspace):
        _join(client, workspace, "agent-beta")
        _remove(client, workspace, "agent-beta")

        # The daemon reconnects and tries to re-join — must be refused, and the
        # membership must NOT come back.
        resp = _join(client, workspace, "agent-beta")
        assert resp.status_code >= 400, "re-join after removal must be refused"

        names = _discover_agents(client, workspace)
        assert "openagents:agent-beta" not in names, "re-join must not resurrect a removed agent"

    def test_heartbeat_does_not_resurrect_removed_agent(self, client, workspace):
        join_resp = _join(client, workspace, "agent-beta")
        session_id = join_resp.json()["data"].get("session_id")
        _remove(client, workspace, "agent-beta")

        # A still-running daemon keeps heartbeating — that must not flip the
        # removed member back to online.
        _heartbeat(client, workspace, "agent-beta", session_id)

        names = _discover_agents(client, workspace)
        assert "openagents:agent-beta" not in names

    def test_removed_member_row_marked_removed_not_deleted(self, client, workspace, db):
        """Removal is a soft-delete (status='removed'), so a re-add can reactivate."""
        _join(client, workspace, "agent-beta")
        _remove(client, workspace, "agent-beta")

        member = (
            db.query(WorkspaceMember)
            .filter_by(
                workspace_id=workspace["id"],
                agent_name="agent-beta",
            )
            .one_or_none()
        )
        assert member is not None, "removed member row is retained (soft-delete)"
        assert member.status == "removed"

    def test_offline_member_still_listed_in_discover(self, client, workspace, db):
        """A stale (offline) member is NOT removed — mobile clients rely on
        membership, not online status. The 'removed' filter must not catch it."""
        from datetime import datetime, timedelta, timezone

        from app.config import config

        _join(client, workspace, "agent-beta")
        member = (
            db.query(WorkspaceMember)
            .filter_by(
                workspace_id=workspace["id"],
                agent_name="agent-beta",
            )
            .one()
        )
        member.last_heartbeat = datetime.now(timezone.utc) - timedelta(
            seconds=config.AGENT_TIMEOUT_SECONDS + 60,
        )
        db.commit()

        assert "openagents:agent-beta" in _discover_agents(client, workspace)


class TestReaddCloudAgent:
    """A cloud agent removed via /v1/remove can be re-added (reactivated)."""

    def _add_cloud_agent(self, client, workspace, name="cloud-bot"):
        return client.post(
            "/v1/cloud-agents",
            json={
                "network": workspace["id"],
                "agent_name": name,
                "provider": "openai",
                "model": "gpt-4o-mini",
                "api_key": "sk-test-435",
            },
            headers={"X-Workspace-Token": workspace["token"]},
        )

    def test_readd_reactivates_removed_cloud_agent(self, client, workspace):
        add_resp = self._add_cloud_agent(client, workspace)
        assert add_resp.status_code == 200, add_resp.text
        assert "openagents:cloud-bot" in _discover_agents(client, workspace)

        _remove(client, workspace, "cloud-bot")
        assert "openagents:cloud-bot" not in _discover_agents(client, workspace)

        # Re-adding must reactivate (not 400 "already exists").
        readd_resp = self._add_cloud_agent(client, workspace)
        assert readd_resp.status_code == 200, readd_resp.text
        assert "openagents:cloud-bot" in _discover_agents(client, workspace)
