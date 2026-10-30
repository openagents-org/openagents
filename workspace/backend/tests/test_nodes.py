# -*- coding: utf-8 -*-
"""Tests for the connect-a-node flow: pairing codes + node register/heartbeat."""

from datetime import datetime, timedelta, timezone

from app.models import NodePairingCode, Workspace
import pytest
import app.access as access

@pytest.fixture(autouse=True)
def pairing_identity(monkeypatch):
    monkeypatch.setattr(access, 'verify_identity_claims', lambda token: {
        'provider': 'firebase', 'email': 'a@x.com', 'firebase_uid': 'a@x.com',
        'apple_sub': None, 'display_name': 'Owner'
    } if token == 'owner' else None)

def _owner():
    return {'Authorization': 'Bearer owner'}


def _make_workspace(client, name="WS"):
    r = client.post("/v1/workspaces", json={"name": name, "creator_email": "a@x.com"})
    assert r.status_code == 200
    return r.json()["data"]  # {workspaceId, slug, name, token, ...}


def _tok(token):
    return {"X-Workspace-Token": token}


class TestPairingCode:
    def test_create_with_identity(self, client):
        ws = _make_workspace(client)
        r = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_owner())
        assert r.status_code == 200
        data = r.json()["data"]
        assert "-" in data["code"] and data["expiresInSeconds"] == 1800

    def test_create_requires_privilege(self, client):
        ws = _make_workspace(client)
        # No token, no identity → not owner/admin → denied.
        r = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes")
        assert r.status_code in (401, 403)


class TestRedeem:
    def test_redeem_registers_node_and_returns_token(self, client):
        ws = _make_workspace(client)
        code = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_owner()).json()["data"]["code"]
        r = client.post("/v1/nodes/redeem", json={
            "code": code, "node_key": "dev-abc", "hostname": "mbp", "device_type": "laptop", "os": "darwin",
        })
        assert r.status_code == 200
        data = r.json()["data"]
        # New contract (pairing-first): redeem mints a PER-NODE token, not the
        # shared workspace credential. It must still be accepted everywhere —
        # covered by test_node_tokens.py's verify⇔resolve invariant.
        assert data["token"] and data["token"] != ws["token"]
        assert data["workspaceId"] == ws["workspaceId"]
        assert data["nodeId"]

    def test_redeem_is_single_use(self, client):
        ws = _make_workspace(client)
        code = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_owner()).json()["data"]["code"]
        assert client.post("/v1/nodes/redeem", json={"code": code, "node_key": "d1"}).status_code == 200
        r2 = client.post("/v1/nodes/redeem", json={"code": code, "node_key": "d1"})
        assert r2.status_code == 409

    def test_redeem_invalid_code(self, client):
        r = client.post("/v1/nodes/redeem", json={"code": "ZZZZ-ZZZZ", "node_key": "d1"})
        assert r.status_code == 404

    def test_redeem_expired_code(self, client, db):
        ws = _make_workspace(client)
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.add(NodePairingCode(code="EXPIRED1", workspace_id=ws["workspaceId"], expires_at=past))
        db.commit()
        r = client.post("/v1/nodes/redeem", json={"code": "EXPIRED1", "node_key": "d1"})
        assert r.status_code == 410

    def test_redeem_normalizes_and_upserts(self, client):
        ws = _make_workspace(client)
        code = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_owner()).json()["data"]["code"]
        node1 = client.post("/v1/nodes/redeem", json={"code": code, "node_key": "same"}).json()["data"]["nodeId"]
        # A second code for the same device key → same node row (upsert).
        code2 = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_owner()).json()["data"]["code"]
        node2 = client.post("/v1/nodes/redeem", json={"code": code2.lower(), "node_key": "same"}).json()["data"]["nodeId"]
        assert node1 == node2


class TestHeartbeatAndList:
    def test_heartbeat_and_list(self, client):
        ws = _make_workspace(client)
        code = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_owner()).json()["data"]["code"]
        connection = client.post("/v1/nodes/redeem", json={
            "code": code, "node_key": "d1", "hostname": "mbp", "device_type": "laptop",
        }).json()["data"]
        node_id, ws['device_token'] = connection['nodeId'], connection['token']

        # Redeeming is not reporting in: the device is offline until its daemon
        # sends a heartbeat, so setup cannot move on with nothing running.
        listed = client.get(f"/v1/nodes?network={ws['workspaceId']}", headers=_owner()).json()["data"]
        assert listed[0]["status"] == "offline" and listed[0]["lastHeartbeatAt"] is None

        hb = client.post("/v1/nodes/heartbeat", json={"node_id": node_id}, headers=_tok(ws["device_token"]))
        assert hb.status_code == 200 and hb.json()["data"]["status"] == "online"

        listed = client.get(f"/v1/nodes?network={ws['workspaceId']}", headers=_owner()).json()["data"]
        assert len(listed) == 1
        assert listed[0]["deviceType"] == "laptop" and listed[0]["status"] == "online"

    def test_delete_node(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        # Privilege required.
        assert client.delete(f"/v1/nodes/{node_id}").status_code in (401, 403)
        # Owner/admin (workspace token) can remove it.
        r = client.delete(f"/v1/nodes/{node_id}", headers=_tok(ws["device_token"]))
        assert r.status_code == 200 and r.json()["data"]["removed"] is True
        listed = client.get(f"/v1/nodes?network={ws['workspaceId']}", headers=_owner()).json()["data"]
        assert listed == []

    def test_heartbeat_wrong_token_rejected(self, client):
        ws = _make_workspace(client)
        code = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_owner()).json()["data"]["code"]
        node_id = client.post("/v1/nodes/redeem", json={"code": code, "node_key": "d1"}).json()["data"]["nodeId"]
        r = client.post("/v1/nodes/heartbeat", json={"node_id": node_id}, headers=_tok("wrong-token"))
        assert r.status_code == 401

    def test_heartbeat_reports_agent_roster(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        roster = [{"name": "coder", "type": "claude", "status": "running"}]
        client.post("/v1/nodes/heartbeat", json={"node_id": node_id, "agents": roster}, headers=_tok(ws["device_token"]))
        listed = client.get(f"/v1/nodes?network={ws['workspaceId']}", headers=_owner()).json()["data"]
        assert listed[0]["agents"] == roster


def _connect_node(client, ws, node_key="d1"):
    code = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_owner()).json()["data"]["code"]
    connection = client.post("/v1/nodes/redeem", json={"code": code, "node_key": node_key}).json()["data"]
    ws['device_token'] = connection['token']
    return connection['nodeId']


class TestNodeCommands:
    def test_enqueue_requires_privilege(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "create_agent", "args": {"name": "x", "type": "claude"}})
        assert r.status_code in (401, 403)

    def test_enqueue_rejects_unknown_action(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "rm_rf", "args": {"name": "x"}}, headers=_tok(ws["device_token"]))
        assert r.status_code == 400

    def test_enqueue_requires_name_and_type(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        assert client.post(f"/v1/nodes/{node_id}/commands", json={"action": "create_agent", "args": {"type": "claude"}}, headers=_tok(ws["device_token"])).status_code == 400
        assert client.post(f"/v1/nodes/{node_id}/commands", json={"action": "create_agent", "args": {"name": "x"}}, headers=_tok(ws["device_token"])).status_code == 400

    def test_command_delivered_on_heartbeat_then_result(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        # Enqueue with an API key in the args.
        enq = client.post(
            f"/v1/nodes/{node_id}/commands",
            json={"action": "create_agent", "args": {"name": "coder", "type": "claude", "apiKey": "sk-secret"}},
            headers=_tok(ws["device_token"]),
        ).json()["data"]
        cmd_id = enq["commandId"]
        assert enq["status"] == "pending"

        # Daemon heartbeats → receives the command with raw args (incl. the key).
        hb = client.post("/v1/nodes/heartbeat", json={"node_id": node_id}, headers=_tok(ws["device_token"])).json()["data"]
        assert len(hb["commands"]) == 1
        delivered = hb["commands"][0]
        assert delivered["commandId"] == cmd_id
        assert delivered["args"]["apiKey"] == "sk-secret"

        # Same command is not delivered twice.
        hb2 = client.post("/v1/nodes/heartbeat", json={"node_id": node_id}, headers=_tok(ws["device_token"])).json()["data"]
        assert hb2["commands"] == []

        # Daemon posts the result.
        res = client.post(f"/v1/nodes/commands/{cmd_id}/result", json={"ok": True, "message": "created"}, headers=_tok(ws["device_token"]))
        assert res.status_code == 200 and res.json()["data"]["status"] == "done"

        # History no longer exposes the API key.
        hist = client.get(f"/v1/nodes/{node_id}/commands", headers=_tok(ws["device_token"])).json()["data"]
        assert hist[0]["status"] == "done"
        assert "args" not in hist[0]

    def test_result_wrong_token_rejected(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        cmd_id = client.post(
            f"/v1/nodes/{node_id}/commands",
            json={"action": "stop_agent", "args": {"name": "coder"}},
            headers=_tok(ws["device_token"]),
        ).json()["data"]["commandId"]
        r = client.post(f"/v1/nodes/commands/{cmd_id}/result", json={"ok": True}, headers=_tok("wrong"))
        assert r.status_code == 401

    def test_detect_runtimes_needs_no_agent_name(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "detect_runtimes", "args": {}}, headers=_tok(ws["device_token"]))
        assert r.status_code == 200 and r.json()["data"]["action"] == "detect_runtimes"

    def test_probe_agent_accepts_type_or_name_but_not_neither(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        hdr = _tok(ws["device_token"])
        # Neither type nor name → rejected.
        assert client.post(f"/v1/nodes/{node_id}/commands", json={"action": "probe_agent", "args": {}}, headers=hdr).status_code == 400
        # A bare type is enough (smoke-test a runtime with no agent yet).
        r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "probe_agent", "args": {"type": "claude"}}, headers=hdr)
        assert r.status_code == 200 and r.json()["data"]["action"] == "probe_agent"
        # An agent name alone also works (the daemon resolves its type).
        r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "probe_agent", "args": {"name": "coder"}}, headers=hdr)
        assert r.status_code == 200

    def test_list_models_needs_an_agent_name(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        hdr = _tok(ws["device_token"])
        assert client.post(f"/v1/nodes/{node_id}/commands", json={"action": "list_models", "args": {}}, headers=hdr).status_code == 400
        r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "list_models", "args": {"name": "coder"}}, headers=hdr)
        assert r.status_code == 200 and r.json()["data"]["action"] == "list_models"


class TestNodeRuntimes:
    def test_heartbeat_reports_runtimes(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        runtimes = [
            {"type": "claude", "installed": True, "ready": True, "version": "1.2.3", "reason": "ready"},
            {"type": "codex", "installed": False, "ready": False, "reason": "not_installed"},
        ]
        client.post("/v1/nodes/heartbeat", json={"node_id": node_id, "runtimes": runtimes}, headers=_tok(ws["device_token"]))
        listed = client.get(f"/v1/nodes?network={ws['workspaceId']}", headers=_owner()).json()["data"]
        assert listed[0]["runtimes"] == runtimes

    def test_heartbeat_reports_fs(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        fs = {"home": "D:\\Users\\alice", "dirs": ["projects", "work"], "roots": ["C:\\", "D:\\"]}
        client.post("/v1/nodes/heartbeat", json={"node_id": node_id, "fs": fs}, headers=_tok(ws["device_token"]))
        listed = client.get(f"/v1/nodes?network={ws['workspaceId']}", headers=_owner()).json()["data"]
        assert listed[0]["fs"] == fs

    def test_list_dir_command_no_agent_name(self, client):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        r = client.post(f"/v1/nodes/{node_id}/commands", json={"action": "list_dir", "args": {"path": "/home"}}, headers=_tok(ws["device_token"]))
        assert r.status_code == 200 and r.json()["data"]["action"] == "list_dir"
        # Daemon reports back folder data.
        cmd_id = r.json()["data"]["commandId"]
        res = client.post(f"/v1/nodes/commands/{cmd_id}/result", json={"ok": True, "data": {"path": "/home", "parent": "/", "dirs": ["ubuntu"]}}, headers=_tok(ws["device_token"]))
        assert res.status_code == 200
        hist = client.get(f"/v1/nodes/{node_id}/commands", headers=_tok(ws["device_token"])).json()["data"]
        assert hist[0]["result"]["data"]["dirs"] == ["ubuntu"]


def _soft_delete(db, workspace_id):
    ws = db.query(Workspace).filter(Workspace.id == workspace_id).one()
    ws.status = "deleted"
    db.commit()


class TestDeletedWorkspaceRefusesNodes:
    """A soft-deleted workspace's token (shared or per-node) must not keep a
    daemon heartbeating or reporting results into it."""

    def test_heartbeat_refused_after_delete(self, client, db):
        ws = _make_workspace(client)
        code = client.post(f"/v1/workspaces/{ws['workspaceId']}/pairing-codes", headers=_tok(ws["token"])).json()["data"]["code"]
        redeemed = client.post("/v1/nodes/redeem", json={"code": code, "node_key": "d1"}).json()["data"]
        node_id = redeemed["nodeId"]
        assert client.post("/v1/nodes/heartbeat", json={"node_id": node_id}, headers=_tok(ws["token"])).status_code == 200

        _soft_delete(db, ws["workspaceId"])

        r = client.post("/v1/nodes/heartbeat", json={"node_id": node_id}, headers=_tok(ws["token"]))
        assert r.status_code == 404
        # The node's own token is refused too.
        r = client.post("/v1/nodes/heartbeat", json={"node_id": node_id}, headers=_tok(redeemed["token"]))
        assert r.status_code == 404

    def test_command_result_refused_after_delete(self, client, db):
        ws = _make_workspace(client)
        node_id = _connect_node(client, ws)
        cmd_id = client.post(
            f"/v1/nodes/{node_id}/commands",
            json={"action": "stop_agent", "args": {"name": "coder"}},
            headers=_tok(ws["token"]),
        ).json()["data"]["commandId"]

        _soft_delete(db, ws["workspaceId"])

        r = client.post(f"/v1/nodes/commands/{cmd_id}/result", json={"ok": True}, headers=_tok(ws["token"]))
        assert r.status_code == 404
