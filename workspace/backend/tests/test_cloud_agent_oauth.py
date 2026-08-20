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
    import time
    state = f"test-state-{agent_name}"
    ca._oauth_states[state] = {
        "workspace_id": workspace["id"],
        "agent_name": agent_name,
        "model": "gemini-2.5-pro",
        "created_at": time.time(),
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
        }, headers={"X-Workspace-Token": workspace["token"]},
            follow_redirects=False)
        assert resp.status_code == 400
        assert not any(
            s.get("agent_name") == "safe\n- forged" for s in ca._oauth_states.values()
        )

    def test_start_rejects_query_token(self, client, workspace):
        """A workspace token in a query string would leak into access logs
        and browser history — only header auth is accepted."""
        resp = client.get("/v1/cloud-agents/google/auth", params={
            "network": workspace["id"],
            "agent_name": "gemini",
            "token": workspace["token"],
        }, follow_redirects=False)
        assert resp.status_code == 401

    def test_start_with_header_token_redirects(self, client, workspace):
        resp = client.get("/v1/cloud-agents/google/auth", params={
            "network": workspace["id"],
            "agent_name": "gemini",
        }, headers={"X-Workspace-Token": workspace["token"]},
            follow_redirects=False)
        assert resp.status_code == 307
        assert "accounts.google.com" in resp.headers["location"]

    def test_auth_url_endpoint_mints_url_without_storing_credentials(self, client, workspace):
        """The browser flow: POST with headers → navigate to the returned URL.
        The stored state must not carry any workspace credential."""
        anon = client.post("/v1/cloud-agents/google/auth-url", json={
            "network": workspace["id"],
        })
        assert anon.status_code == 401

        resp = client.post("/v1/cloud-agents/google/auth-url", json={
            "network": workspace["id"],
            "agent_name": "gemini",
            "model": "gemini-3.5-flash",
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert resp.status_code == 200
        assert "accounts.google.com" in resp.json()["data"]["url"]
        assert all("token" not in s for s in ca._oauth_states.values())

    def test_error_param_is_not_reflected(self, client):
        """The public error param must never be echoed into the HTML page."""
        resp = client.get("/v1/cloud-agents/google/callback", params={
            "error": "<script>window.__oauth_xss=1</script>",
        })
        assert "<script>window.__oauth_xss" not in resp.text


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

    def test_callback_refuses_removed_local_agent(self, client, workspace, fake_google):
        """A removed member of another type must not be resurrected as a
        Google agent (review round 5)."""
        client.post("/v1/join", json={
            "agent_name": "beta",
            "agent_type": "claude",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        # /v1/remove soft-deletes (status="removed") — the sticky-removal path.
        removed = client.post("/v1/remove", json={
            "agent_name": "beta",
            "network": workspace["id"],
        }, headers={"X-Workspace-Token": workspace["token"]})
        assert removed.status_code == 200

        state = _seed_state(workspace, agent_name="beta")
        resp = client.get("/v1/cloud-agents/google/callback",
                          params={"code": "c", "state": state})
        assert resp.status_code == 400
        assert "already exists" in resp.text

    def test_stale_config_does_not_bypass_member_guard(self, client, workspace, fake_google, db):
        """Ownership is checked on the member even when a config row already
        exists — a leftover config must not smuggle past the type guard."""
        client.post("/v1/join", json={
            "agent_name": "gamma",
            "agent_type": "claude",
            "token": workspace["token"],
            "network": workspace["id"],
        })
        from app.models import CloudAgentConfig
        db.add(CloudAgentConfig(
            workspace_id=workspace["id"],
            agent_name="gamma",
            provider="google",
            model="gemini-3.5-flash",
            category="chat",
            api_key="stale",
        ))
        db.commit()

        state = _seed_state(workspace, agent_name="gamma")
        resp = client.get("/v1/cloud-agents/google/callback",
                          params={"code": "c", "state": state})
        assert resp.status_code == 400
        assert "already exists" in resp.text
