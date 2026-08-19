# -*- coding: utf-8 -*-
"""Google OAuth callback regression tests (token exchange mocked).

The callback used to raise UnboundLocalError on every run: a function-scoped
`from app.models import Workspace` made the name local to the whole function,
so the earlier workspace lookup read it before assignment (review round 3).
These tests pin the happy path and the display-name namespace guard.
"""

import pytest

from app.routers import cloud_agents as ca


class _FakeResponse:
    def raise_for_status(self):
        pass

    def json(self):
        return {"access_token": "fake-at", "refresh_token": "fake-rt"}


class _FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, *args, **kwargs):
        return _FakeResponse()


@pytest.fixture
def fake_google(monkeypatch):
    import httpx
    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)


def _seed_state(workspace, agent_name="gemini-oauth"):
    state = f"test-state-{agent_name}"
    ca._oauth_states[state] = {
        "workspace_id": workspace["id"],
        "token": workspace["token"],
        "agent_name": agent_name,
        "model": "gemini-2.5-pro",
    }
    return state


def _discover_names(client, workspace):
    disc = client.get("/v1/discover", params={"network": workspace["id"]},
                      headers={"X-Workspace-Token": workspace["token"]})
    return [a["address"] for a in disc.json()["data"]["agents"]]


class TestGoogleOAuthCallback:
    def test_callback_creates_member(self, client, workspace, fake_google):
        state = _seed_state(workspace)
        resp = client.get("/v1/cloud-agents/google/callback",
                          params={"code": "c", "state": state})
        assert resp.status_code == 200
        assert "Connected" in resp.text
        assert "openagents:gemini-oauth" in _discover_names(client, workspace)

    def test_callback_respects_alias_guard(self, client, workspace, fake_google):
        client.post("/v1/join", json={
            "agent_name": "agent-alpha",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        r = client.patch(
            f"/v1/workspaces/{workspace['id']}/members/agent-alpha",
            json={"display_name": "Gemini-OAuth"},
            headers={"X-Workspace-Token": workspace["token"]},
        )
        assert r.status_code == 200

        state = _seed_state(workspace, agent_name="gemini-oauth")
        resp = client.get("/v1/cloud-agents/google/callback",
                          params={"code": "c", "state": state})
        assert resp.status_code == 400  # error page, not a silent duplicate
        assert "conflicts" in resp.text
        assert "openagents:gemini-oauth" not in _discover_names(client, workspace)


class TestGoogleOAuthStart:
    @pytest.fixture(autouse=True)
    def oauth_configured(self, monkeypatch):
        from app.config import config as app_config
        monkeypatch.setattr(app_config, "GOOGLE_OAUTH_CLIENT_ID", "fake-client-id")
        monkeypatch.setattr(app_config, "GOOGLE_OAUTH_REDIRECT_URI", "http://localhost/cb")

    def test_start_requires_credentials(self, client, workspace):
        """A state must never be issued to an anonymous caller — it used to
        fall back to the workspace's own token (review round 4)."""
        resp = client.get("/v1/cloud-agents/google/auth",
                          params={"network": workspace["id"]},
                          follow_redirects=False)
        assert resp.status_code == 401

    def test_start_validates_agent_name_before_issuing_state(self, client, workspace):
        resp = client.get("/v1/cloud-agents/google/auth", params={
            "network": workspace["id"],
            "agent_name": "safe\n- forged",
            "token": workspace["token"],
        }, follow_redirects=False)
        assert resp.status_code == 400
        assert not any(
            s.get("agent_name") == "safe\n- forged" for s in ca._oauth_states.values()
        )

    def test_start_with_query_token_redirects(self, client, workspace):
        """href navigation can't set headers — ?token= must authenticate."""
        resp = client.get("/v1/cloud-agents/google/auth", params={
            "network": workspace["id"],
            "agent_name": "gemini",
            "token": workspace["token"],
        }, follow_redirects=False)
        assert resp.status_code == 307
        assert "accounts.google.com" in resp.headers["location"]


class TestCallbackMemberTypeGuard:
    def test_callback_refuses_existing_local_agent(self, client, workspace, fake_google):
        """A local daemon agent must not silently gain a cloud config — both
        runtimes would answer for the same name (review round 4)."""
        client.post("/v1/join", json={
            "agent_name": "alpha",
            "agent_type": "claude",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        state = _seed_state(workspace, agent_name="alpha")
        resp = client.get("/v1/cloud-agents/google/callback",
                          params={"code": "c", "state": state})
        assert resp.status_code == 400
        assert "already exists" in resp.text

        cfgs = client.get("/v1/cloud-agents", params={"network": workspace["id"]},
                          headers={"X-Workspace-Token": workspace["token"]})
        names = [c["agentName"] for c in cfgs.json()["data"]["cloud_agents"]]
        assert "alpha" not in names
