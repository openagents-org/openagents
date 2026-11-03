# -*- coding: utf-8 -*-
"""Acenta-hosted cloud agents: launch, join over the hosted connection, removal.

Acenta itself is faked at the HTTP-client boundary (hosting._request).
"""

import pytest

from app.config import config
from app.models import HostedAgent, Node, WorkspaceMember
from app.services import hosted_agents as hosting
from tests.test_visibility import _bearer, no_push, people  # noqa: F401


class FakeAcenta:
    def __init__(self):
        self.calls = []
        self.fail = None
        self.terminate_status = None
        self.state = "queued"
        self.launch_url = None
        self.status_error = None

    def __call__(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        if self.fail:
            raise hosting.ProviderError(self.fail, 409)
        if method == "POST" and path == "":
            body = kwargs["json"]
            self.launched = body
            return {"id": "box-1", "agent_name": "acenta-1a2b3c4d", "state": self.state, "launch_url": self.launch_url}
        if method == "GET" and path == "/box-1":
            if self.status_error:
                raise hosting.ProviderError("gone", self.status_error)
            return {"id": "box-1", "state": self.state, "launch_url": self.launch_url}
        if path.endswith("/terminate"):
            if self.terminate_status:
                raise hosting.ProviderError("down", self.terminate_status)
            return {"state": "terminating"}
        raise AssertionError((method, path))


@pytest.fixture
def acenta(monkeypatch, db):
    fake = FakeAcenta()
    monkeypatch.setattr(config, "ACENTA_API_URL", "https://endpoint.acenta.test")
    monkeypatch.setattr(config, "ACENTA_INTEGRATION_SECRET", "secret")
    monkeypatch.setattr(hosting, "_request", fake)
    # Run cleanup inline on the test session instead of a thread + real DB.
    monkeypatch.setattr(hosting, "session_factory", lambda: _Unclosable(db))
    monkeypatch.setattr(hosting, "schedule_termination", hosting.finish_termination)
    return fake


class _Unclosable:
    def __init__(self, db):
        self._db = db

    def __getattr__(self, name):
        return getattr(self._db, name)

    def close(self):
        pass


def _launch(client, workspace, by="mia", name="Research helper"):
    return client.post("/v1/hosted-agents", json={"network": workspace["id"], "display_name": name},
                       headers=_bearer(by, workspace))


def _hosted(db):
    db.expire_all()
    return db.query(HostedAgent).all()


def test_provider_listing_reflects_configuration(client, monkeypatch):
    monkeypatch.setattr(config, "ACENTA_API_URL", "")
    providers = client.get("/v1/hosted-agents/providers").json()["data"]["providers"]
    assert providers[0]["name"] == "acenta" and providers[0]["available"] is False


def test_launch_mints_dedicated_connection_and_placeholder(client, db, workspace, people, acenta):
    r = _launch(client, workspace)
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["agentName"] == "acenta-1a2b3c4d" and data["presence"] == "offline"

    hosted = _hosted(db)[0]
    node = db.get(Node, hosted.node_id)
    assert node.device_type == "hosted" and node.owner_email == "mia@acme.test"
    # Acenta gets the per-agent connection token, never the shared workspace token.
    sent = acenta.launched
    assert sent["workspace"]["token"] == node.token != workspace["token"]
    assert sent["user"] == {"subject": "mia@acme.test", "email": "mia@acme.test", "display_name": "Mia"}
    assert sent["request_key"] == hosted.id

    member = db.query(WorkspaceMember).filter_by(agent_name="acenta-1a2b3c4d").one()
    assert member.display_name == "Research helper" and member.node_id == node.id
    assert member.owner_email == "mia@acme.test" and member.agent_type == "opencode"


def test_hosted_runtime_joins_with_its_token_and_shows_online(client, db, workspace, people, acenta):
    _launch(client, workspace)
    token = _hosted(db)[0]
    node_token = db.get(Node, token.node_id).token
    r = client.post("/v1/join", json={"network": workspace["id"], "agent_name": "acenta-1a2b3c4d",
                                      "agent_type": "opencode", "token": node_token})
    assert r.status_code == 200, r.text
    listed = client.get(f"/v1/hosted-agents?network={workspace['id']}", headers=_bearer("mia", workspace))
    assert listed.json()["data"]["hosted_agents"][0]["presence"] == "online"
    # The hosted connection is not presented as one of the user's devices.
    nodes = client.get(f"/v1/nodes?network={workspace['id']}", headers=_bearer("mia", workspace))
    assert nodes.json()["data"] == []


def test_launch_requires_a_signed_in_member(client, db, workspace, people, acenta):
    r = client.post("/v1/hosted-agents", json={"network": workspace["id"], "display_name": "x"},
                    headers={"X-Workspace-Token": workspace["token"]})
    assert r.status_code == 401
    assert _launch(client, workspace, by="vic").status_code == 403
    assert acenta.calls == []


def test_launch_disabled_without_configuration(client, db, workspace, people, acenta, monkeypatch):
    monkeypatch.setattr(config, "ACENTA_INTEGRATION_SECRET", "")
    assert _launch(client, workspace).status_code == 409
    assert acenta.calls == []


def test_provider_failure_rolls_back_connection(client, db, workspace, people, acenta):
    acenta.fail = "Your preview has reached its agent limit."
    r = _launch(client, workspace)
    assert r.status_code == 400 and "agent limit" in r.json()["message"]
    assert _hosted(db) == [] and db.query(Node).count() == 0


def test_remove_revokes_token_and_terminates(client, db, workspace, people, acenta):
    _launch(client, workspace)
    node_token = db.get(Node, _hosted(db)[0].node_id).token
    assert client.delete(f"/v1/hosted-agents/acenta-1a2b3c4d?network={workspace['id']}",
                         headers=_bearer("adam", workspace)).status_code == 403
    r = client.delete(f"/v1/hosted-agents/acenta-1a2b3c4d?network={workspace['id']}", headers=_bearer("mia", workspace))
    assert r.status_code == 200, r.text
    assert acenta.calls[-1][1] == "/box-1/terminate"
    assert _hosted(db) == []
    rejoin = client.post("/v1/join", json={"network": workspace["id"], "agent_name": "acenta-1a2b3c4d",
                                           "agent_type": "opencode", "token": node_token})
    assert rejoin.status_code == 401


def test_generic_member_removal_also_terminates(client, db, workspace, people, acenta):
    _launch(client, workspace)
    r = client.delete(f"/v1/workspaces/{workspace['id']}/members/acenta-1a2b3c4d", headers=_bearer("mia", workspace))
    assert r.status_code == 200, r.text
    assert acenta.calls[-1][1] == "/box-1/terminate" and _hosted(db) == []


def test_failed_termination_is_retried_from_listing(client, db, workspace, people, acenta):
    _launch(client, workspace)
    acenta.terminate_status = 502
    client.delete(f"/v1/hosted-agents/acenta-1a2b3c4d?network={workspace['id']}", headers=_bearer("mia", workspace))
    assert [h.status for h in _hosted(db)] == ["terminating"]
    acenta.terminate_status = None
    listed = client.get(f"/v1/hosted-agents?network={workspace['id']}", headers=_bearer("mia", workspace))
    assert listed.json()["data"]["hosted_agents"] == [] and _hosted(db) == []


def test_paid_launch_sends_owner_to_acenta_then_activates(client, db, workspace, people, acenta):
    acenta.state, acenta.launch_url = "awaiting_payment", "https://acenta.test/launch/box-1"
    data = _launch(client, workspace).json()["data"]
    assert data["status"] == "setup" and data["setupUrl"] == "https://acenta.test/launch/box-1"
    # Acenta returns the owner to this workspace after checkout.
    assert acenta.launched["return_url"] == f"https://workspace.openagents.org/{workspace['slug']}"
    acenta.state, acenta.launch_url = "queued", None
    listed = client.get(f"/v1/hosted-agents?network={workspace['id']}", headers=_bearer("mia", workspace))
    row = listed.json()["data"]["hosted_agents"][0]
    assert row["status"] == "active" and row["setupUrl"] is None


def test_abandoned_checkout_is_cleaned_up(client, db, workspace, people, acenta):
    acenta.state, acenta.launch_url = "awaiting_payment", "https://acenta.test/launch/box-1"
    _launch(client, workspace)
    acenta.state = "terminated"
    listed = client.get(f"/v1/hosted-agents?network={workspace['id']}", headers=_bearer("mia", workspace))
    assert listed.json()["data"]["hosted_agents"] == [] and _hosted(db) == []
    assert db.query(Node).count() == 0
    member = db.query(WorkspaceMember).filter_by(agent_name="acenta-1a2b3c4d").one()
    assert member.status == "removed"
