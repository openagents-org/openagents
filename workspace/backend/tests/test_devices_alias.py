# -*- coding: utf-8 -*-
"""Permission model v1.1 — devices (formerly nodes).

* /v1/devices/... is a strict alias of /v1/nodes/... (same handlers) and every
  node-shaped response carries `device_id` next to the legacy `nodeId`.
* Control (POST commands) is owner-only: the human who paired the device or the
  device's own token. Admins may only unpair (DELETE). Any member may read.
* The owner is derived from the redeemed pairing code's creator, so devices
  paired with a token-minted code (no human) keep the legacy owner/admin rule.
"""

import app.access as access
import pytest
from app.models import User, WorkspaceMembership


def _claims(email, name=None):
    return {"provider": "firebase", "email": email, "firebase_uid": email,
            "apple_sub": None, "display_name": name or email.split("@")[0]}


@pytest.fixture
def people(db, workspace, monkeypatch):
    """adam + bob are admins, mia a member; bearer token == first name."""
    mapping = {}
    for name, role in {"adam": "admin", "bob": "admin", "mia": "member"}.items():
        email = f"{name}@acme.test"
        user = User(email=email, display_name=name.capitalize())
        db.add(user)
        db.flush()
        db.add(WorkspaceMembership(workspace_id=workspace["id"], user_id=user.id, role=role))
        mapping[name] = _claims(email, name.capitalize())
    db.commit()
    monkeypatch.setattr(access, "verify_identity_claims", lambda tok: mapping.get(tok))
    return mapping


def _tok(ws):
    return {"X-Workspace-Token": ws["token"]}


def _bearer(name, ws=None):
    """The web client sends identity AND the shared workspace token."""
    h = {"Authorization": f"Bearer {name}"}
    if ws:
        h.update(_tok(ws))
    return h


def _mint(client, ws, headers):
    r = client.post(f"/v1/workspaces/{ws['id']}/pairing-codes", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["data"]["code"]


def _pair(client, ws, headers, node_key="dev-1", prefix="/v1/devices"):
    """Mint a code as `headers` and redeem it → (device dict, device token)."""
    code = _mint(client, ws, headers)
    r = client.post(f"{prefix}/redeem", json={"code": code, "node_key": node_key, "hostname": "mbp"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    return data, data["token"]


def _cmd(client, device_id, headers, prefix="/v1/devices"):
    return client.post(f"{prefix}/{device_id}/commands", json={"action": "detect_runtimes"}, headers=headers)


# ---------------------------------------------------------------------------
# Aliases
# ---------------------------------------------------------------------------

class TestAliases:
    def test_redeem_alias_returns_device_id(self, client, workspace):
        data, token = _pair(client, workspace, _tok(workspace))
        assert data["device_id"] == data["nodeId"]
        assert token and token != workspace["token"]

    def test_heartbeat_alias_and_list_alias_match_nodes(self, client, workspace):
        data, token = _pair(client, workspace, _tok(workspace))
        hb = client.post("/v1/devices/heartbeat", json={"node_id": data["device_id"], "os": "darwin"},
                         headers={"X-Workspace-Token": token})
        assert hb.status_code == 200
        assert hb.json()["data"]["device_id"] == data["device_id"]

        a = client.get(f"/v1/devices?network={workspace['id']}", headers=_tok(workspace))
        b = client.get(f"/v1/nodes?network={workspace['id']}", headers=_tok(workspace))
        assert a.status_code == b.status_code == 200
        assert a.json()["data"] == b.json()["data"]
        item = a.json()["data"][0]
        assert item["device_id"] == item["nodeId"] == data["device_id"]
        assert item["os"] == "darwin"

    def test_commands_and_result_aliases(self, client, workspace):
        data, token = _pair(client, workspace, _tok(workspace))
        r = _cmd(client, data["device_id"], {"X-Workspace-Token": token})
        assert r.status_code == 200, r.text
        cmd_id = r.json()["data"]["commandId"]
        listed = client.get(f"/v1/devices/{data['device_id']}/commands", headers=_tok(workspace))
        assert [c["commandId"] for c in listed.json()["data"]] == [cmd_id]
        done = client.post(f"/v1/devices/commands/{cmd_id}/result", json={"ok": True, "message": "fine"},
                           headers={"X-Workspace-Token": token})
        assert done.status_code == 200 and done.json()["data"]["status"] == "done"

    def test_delete_alias_returns_device_id(self, client, workspace):
        data, _ = _pair(client, workspace, _tok(workspace))
        r = client.delete(f"/v1/devices/{data['device_id']}", headers=_tok(workspace))
        assert r.status_code == 200
        assert r.json()["data"] == {"nodeId": data["device_id"], "device_id": data["device_id"], "removed": True}
        assert client.get(f"/v1/nodes?network={workspace['id']}", headers=_tok(workspace)).json()["data"] == []

    def test_push_device_registration_still_owned_by_devices_router(self, client, workspace):
        # routers/devices.py owns the literal /v1/devices/register path; the
        # alias router's /{node_id} must not shadow it.
        r = client.delete("/v1/devices/register", headers=_tok(workspace))
        assert r.status_code != 404 or "Device not found" not in r.text
        from app.main import app
        owners = {(tuple(sorted(rt.methods)), rt.path): rt.endpoint.__module__ for rt in app.routes if hasattr(rt, "methods")}
        assert owners[(("POST",), "/v1/devices/register")].endswith("routers.devices")
        assert owners[(("DELETE",), "/v1/devices/register")].endswith("routers.devices")
        assert owners[(("DELETE",), "/v1/devices/{node_id}")].endswith("routers.nodes")


# ---------------------------------------------------------------------------
# Owner-only control
# ---------------------------------------------------------------------------

class TestOwnerOnlyControl:
    def test_owner_is_the_human_who_paired(self, client, workspace, people):
        data, _ = _pair(client, workspace, _bearer("adam", workspace))
        item = client.get(f"/v1/devices?network={workspace['id']}", headers=_bearer("mia", workspace)).json()["data"][0]
        assert item["ownerEmail"] == "adam@acme.test"

    def test_commands_matrix(self, client, workspace, people):
        data, device_token = _pair(client, workspace, _bearer("adam", workspace))
        did = data["device_id"]
        # owner → 200
        assert _cmd(client, did, _bearer("adam", workspace)).status_code == 200
        # the device's own token → 200
        assert _cmd(client, did, {"X-Workspace-Token": device_token}).status_code == 200
        # another admin → 403 (admins only unpair)
        r = _cmd(client, did, _bearer("bob", workspace))
        assert r.status_code == 403
        assert "adam@acme.test" in r.json()["message"]
        # a member → 403, even with the shared token the web client also sends
        assert _cmd(client, did, _bearer("mia", workspace)).status_code == 403
        # another device's token → 403
        other, other_token = _pair(client, workspace, _bearer("bob", workspace), node_key="dev-2")
        assert _cmd(client, did, {"X-Workspace-Token": other_token}).status_code == 403
        # nobody → 403
        assert _cmd(client, did, {}).status_code == 403
        # the /v1/nodes spelling enforces the same rule
        assert _cmd(client, did, _bearer("mia", workspace), prefix="/v1/nodes").status_code == 403
        assert _cmd(client, did, _bearer("adam", workspace), prefix="/v1/nodes").status_code == 200

    def test_repair_by_another_person_transfers_ownership(self, client, workspace, people):
        data, _ = _pair(client, workspace, _bearer("adam", workspace), node_key="shared-box")
        again, _ = _pair(client, workspace, _bearer("bob", workspace), node_key="shared-box")
        assert again["device_id"] == data["device_id"]
        assert _cmd(client, data["device_id"], _bearer("bob", workspace)).status_code == 200
        assert _cmd(client, data["device_id"], _bearer("adam", workspace)).status_code == 403
        # ...but a token-minted re-pair (no human) does not strip the owner.
        _pair(client, workspace, _tok(workspace), node_key="shared-box")
        assert _cmd(client, data["device_id"], _bearer("bob", workspace)).status_code == 200

    def test_legacy_device_without_human_pairer_keeps_admin_rule(self, client, workspace, people):
        data, _ = _pair(client, workspace, _tok(workspace))  # created_by NULL
        item = client.get(f"/v1/devices?network={workspace['id']}", headers=_tok(workspace)).json()["data"][0]
        assert item["ownerEmail"] is None
        assert _cmd(client, data["device_id"], _bearer("bob", workspace)).status_code == 200
        assert _cmd(client, data["device_id"], _bearer("mia", workspace)).status_code == 403
        assert _cmd(client, data["device_id"], _tok(workspace)).status_code == 200

    def test_any_member_can_read_status(self, client, workspace, people):
        data, _ = _pair(client, workspace, _bearer("adam", workspace))
        assert client.get(f"/v1/devices?network={workspace['id']}", headers=_bearer("mia")).status_code == 200
        assert client.get(f"/v1/devices/{data['device_id']}/commands", headers=_bearer("mia")).status_code == 200

    def test_unpair_owner_or_admin(self, client, workspace, people):
        data, _ = _pair(client, workspace, _bearer("adam", workspace))
        did = data["device_id"]
        # member → 403 even with the shared token
        r = client.delete(f"/v1/devices/{did}", headers=_bearer("mia", workspace))
        assert r.status_code == 403 and "connected this device" in r.json()["message"]
        # another admin → 200 (the one admin control over someone else's device)
        assert client.delete(f"/v1/devices/{did}", headers=_bearer("bob", workspace)).status_code == 200
        # owner → 200
        data2, _ = _pair(client, workspace, _bearer("adam", workspace), node_key="dev-2")
        assert client.delete(f"/v1/nodes/{data2['device_id']}", headers=_bearer("adam")).status_code == 200
        # device/shared token alone → still allowed (machine rule unchanged)
        data3, tok3 = _pair(client, workspace, _bearer("adam", workspace), node_key="dev-3")
        assert client.delete(f"/v1/devices/{data3['device_id']}", headers={"X-Workspace-Token": tok3}).status_code == 200
