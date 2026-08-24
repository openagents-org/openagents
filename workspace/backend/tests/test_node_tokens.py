# -*- coding: utf-8 -*-
"""
Per-node machine tokens (B1/B2 of the pairing-first plan).

The load-bearing invariant: ANY token verify_workspace_access accepts as a
machine credential must be resolvable by POST /v1/token/resolve — the two
share one lookup (app.access.resolve_machine_token), so `agn connect` can
never again be told "invalid token" by one endpoint while another endpoint
happily heartbeats with the same token.
"""

import pytest

from app.access import resolve_machine_token, verify_workspace_access
from app.models import Node, Workspace, WorkspaceMember


def _mint_code(client, workspace):
    resp = client.post(
        f"/v1/workspaces/{workspace['id']}/pairing-codes",
        headers={"X-Workspace-Token": workspace["token"]},
        json={},
    )
    assert resp.status_code == 200
    return resp.json()["data"]["code"]


def _redeem(client, workspace, node_key="nk-test-1", name="test-box"):
    code = _mint_code(client, workspace)
    resp = client.post("/v1/nodes/redeem", json={
        "code": code,
        "node_key": node_key,
        "name": name,
        "hostname": "test-box.local",
        "os": "darwin",
    })
    assert resp.status_code == 200
    return resp.json()["data"]


class TestRedeemMintsPerNodeToken:
    def test_redeem_returns_a_dedicated_token(self, client, workspace):
        data = _redeem(client, workspace)
        assert data["token"]
        assert data["token"] != workspace["token"], (
            "redeem must mint a per-node token, not hand out the shared "
            "workspace token"
        )

    def test_re_pair_reuses_the_same_token(self, client, workspace):
        """Running agents never blip: re-pairing the same device returns the
        existing credential unchanged."""
        first = _redeem(client, workspace, node_key="nk-reuse")
        second = _redeem(client, workspace, node_key="nk-reuse")
        assert second["nodeId"] == first["nodeId"]
        assert second["token"] == first["token"]


class TestVerifyResolveInvariant:
    def test_workspace_token_verifies_and_resolves(self, client, workspace, db):
        ws = db.get(Workspace, workspace["id"])
        assert verify_workspace_access(ws, workspace["token"], None, db=db)
        resolved, node = resolve_machine_token(db, workspace["token"])
        assert resolved is not None and str(resolved.id) == workspace["id"]
        assert node is None

    def test_node_token_verifies_and_resolves(self, client, workspace, db):
        data = _redeem(client, workspace)
        ws = db.get(Workspace, workspace["id"])
        assert verify_workspace_access(ws, data["token"], None, db=db)
        resolved, node = resolve_machine_token(db, data["token"])
        assert resolved is not None and str(resolved.id) == workspace["id"]
        assert node is not None and str(node.id) == data["nodeId"]

    def test_resolve_endpoint_accepts_node_tokens(self, client, workspace):
        data = _redeem(client, workspace)
        resp = client.post("/v1/token/resolve", json={"token": data["token"]})
        assert resp.status_code == 200
        assert resp.json()["data"]["workspace_id"] == workspace["id"]

    def test_node_token_is_scoped_to_its_workspace(self, client, workspace, db):
        data = _redeem(client, workspace)
        other = client.post("/v1/workspaces", json={
            "name": "Other WS",
            "agent_name": "agent-beta",
            "creator_email": "other@example.com",
        }).json()["data"]
        other_ws = db.get(Workspace, other["workspaceId"])
        assert not verify_workspace_access(other_ws, data["token"], None, db=db)


class TestNodeTokenLifecycle:
    def test_join_with_node_token_stamps_node_id(self, client, workspace, db):
        data = _redeem(client, workspace)
        resp = client.post("/v1/join", json={
            "agent_name": "node-agent",
            "token": data["token"],
            "network": workspace["id"],
        })
        assert resp.status_code == 200
        member = db.query(WorkspaceMember).filter_by(
            workspace_id=workspace["id"], agent_name="node-agent",
        ).one()
        assert str(member.node_id) == data["nodeId"]

    def test_join_with_workspace_token_has_no_node_id(self, client, workspace, db):
        resp = client.post("/v1/join", json={
            "agent_name": "manual-agent",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        assert resp.status_code == 200
        member = db.query(WorkspaceMember).filter_by(
            workspace_id=workspace["id"], agent_name="manual-agent",
        ).one()
        assert member.node_id is None

    def test_heartbeat_accepts_node_token(self, client, workspace):
        data = _redeem(client, workspace)
        resp = client.post(
            "/v1/nodes/heartbeat",
            headers={"X-Workspace-Token": data["token"]},
            json={"node_id": data["nodeId"], "hostname": "test-box.local"},
        )
        assert resp.status_code == 200

    def test_delete_node_revokes_its_token(self, client, workspace, db):
        """Real revocation: once the node row is gone, the token stops
        verifying AND stops resolving."""
        data = _redeem(client, workspace)
        resp = client.delete(
            f"/v1/nodes/{data['nodeId']}",
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert resp.status_code == 200
        db.expire_all()
        ws = db.get(Workspace, workspace["id"])
        assert not verify_workspace_access(ws, data["token"], None, db=db)
        resolved, _ = resolve_machine_token(db, data["token"])
        assert resolved is None
        resp = client.post("/v1/token/resolve", json={"token": data["token"]})
        assert resp.status_code == 404
