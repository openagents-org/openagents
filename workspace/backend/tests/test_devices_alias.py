# -*- coding: utf-8 -*-
"""Private connection endpoint aliases.

* /v1/devices/... is a strict alias of /v1/nodes/... (same handlers) and every
  node-shaped response carries `device_id` next to the legacy `nodeId`.
* Listing, control, history and disconnect are private to the connection owner.
* Each code records a signed-in member; token-only pairing codes are rejected.
"""

import app.access as access
import pytest
from app.models import User, WorkspaceMembership


def _claims(email, name=None):
    return {"provider": "firebase", "email": email, "firebase_uid": email,
            "apple_sub": None, "display_name": name or email.split("@")[0]}


@pytest.fixture(autouse=True)
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
        data, token = _pair(client, workspace, _bearer("adam", workspace))
        assert data["device_id"] == data["nodeId"]
        assert token and token != workspace["token"]

    def test_heartbeat_alias_and_list_alias_match_nodes(self, client, workspace):
        data, token = _pair(client, workspace, _bearer("adam", workspace))
        hb = client.post("/v1/devices/heartbeat", json={"node_id": data["device_id"], "os": "darwin"},
                         headers={"X-Workspace-Token": token})
        assert hb.status_code == 200
        assert hb.json()["data"]["device_id"] == data["device_id"]

        a = client.get(f"/v1/devices?network={workspace['id']}", headers=_bearer("adam", workspace))
        b = client.get(f"/v1/nodes?network={workspace['id']}", headers=_bearer("adam", workspace))
        assert a.status_code == b.status_code == 200
        assert a.json()["data"] == b.json()["data"]
        item = a.json()["data"][0]
        assert item["device_id"] == item["nodeId"] == data["device_id"]
        assert item["os"] == "darwin"

    def test_commands_and_result_aliases(self, client, workspace):
        data, token = _pair(client, workspace, _bearer("adam", workspace))
        r = _cmd(client, data["device_id"], {"X-Workspace-Token": token})
        assert r.status_code == 200, r.text
        cmd_id = r.json()["data"]["commandId"]
        listed = client.get(f"/v1/devices/{data['device_id']}/commands", headers=_bearer("adam", workspace))
        assert [c["commandId"] for c in listed.json()["data"]] == [cmd_id]
        done = client.post(f"/v1/devices/commands/{cmd_id}/result", json={"ok": True, "message": "fine"},
                           headers={"X-Workspace-Token": token})
        assert done.status_code == 200 and done.json()["data"]["status"] == "done"

    def test_delete_alias_returns_device_id(self, client, workspace):
        data, _ = _pair(client, workspace, _bearer("adam", workspace))
        r = client.delete(f"/v1/devices/{data['device_id']}", headers=_bearer("adam", workspace))
        assert r.status_code == 200
        assert r.json()["data"] == {"nodeId": data["device_id"], "device_id": data["device_id"], "removed": True}
        assert client.get(f"/v1/nodes?network={workspace['id']}", headers=_bearer("adam", workspace)).json()["data"] == []

    def test_push_device_registration_still_owned_by_devices_router(self, client, workspace):
        # routers/devices.py owns the literal /v1/devices/register path; the
        # alias router's /{node_id} must not shadow it.
        r = client.delete("/v1/devices/register", headers=_bearer("adam", workspace))
        assert r.status_code != 404 or "Device not found" not in r.text
        # Validation belongs to the literal push-registration route, not the
        # dynamic /devices/{id} connection route.
        assert r.status_code == 422
        created = client.post('/v1/devices/register', headers=_bearer('adam', workspace), json={})
        assert created.status_code == 422
