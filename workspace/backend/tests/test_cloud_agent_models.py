# -*- coding: utf-8 -*-
"""Cloud agent model listing and credential probe endpoint tests."""

import httpx

from app.services import model_probe


def _add(client, workspace, **extra):
    body = {
        "network": workspace["id"],
        "agent_name": "relay-bot",
        "provider": "custom",
        "model": "some-model",
        "api_key": "sk-relay-secret-1",
        "base_url": "https://relay.example.com/v1",
        **extra,
    }
    r = client.post("/v1/cloud-agents", json=body, headers={"X-Workspace-Token": workspace["token"]})
    assert r.status_code == 200, r.text


def _models(client, workspace, name="relay-bot", token=None):
    return client.post(
        f"/v1/cloud-agents/{name}/models",
        json={"network": workspace["id"]},
        headers={"X-Workspace-Token": token or workspace["token"]},
    )


def test_lists_the_relay_models_with_the_stored_key(client, workspace, monkeypatch):
    seen = {}

    async def fake_live(provider, api_key, base_url=None):
        seen.update(provider=provider, api_key=api_key, base_url=base_url)
        return [{"id": "deepseek-chat", "label": "deepseek-chat", "category": "chat"}]

    monkeypatch.setattr(model_probe, "list_models_live", fake_live)
    _add(client, workspace)
    r = _models(client, workspace)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["source"] == "live"
    assert [m["id"] for m in data["models"]] == ["deepseek-chat"]
    assert seen == {"provider": "custom", "api_key": "sk-relay-secret-1", "base_url": "https://relay.example.com/v1"}
    assert "sk-relay-secret-1" not in r.text


def test_reports_a_rejected_key(client, workspace, monkeypatch):
    async def rejected(provider, api_key, base_url=None):
        request = httpx.Request("GET", "https://relay.example.com/v1/models")
        raise httpx.HTTPStatusError("401", request=request, response=httpx.Response(401, request=request))

    monkeypatch.setattr(model_probe, "list_models_live", rejected)
    _add(client, workspace)
    data = _models(client, workspace).json()["data"]
    assert data["keyOk"] is False and data["models"] == []


def test_unknown_agent_and_bad_token(client, workspace):
    assert _models(client, workspace, name="nobody").status_code == 404
    _add(client, workspace)
    assert _models(client, workspace, token="wrong").status_code == 401


def test_model_probe_accepts_custom_anthropic(client, workspace, monkeypatch):
    """Verify Key forwards Anthropic-compatible credentials to the probe service."""
    seen = {}

    async def fake_probe(provider, api_key, base_url, model, protocol):
        """Capture the provider details passed through the probe route."""
        seen.update(provider=provider, base_url=base_url)
        return {"models": [], "source": "live", "keyOk": True}

    monkeypatch.setattr(model_probe, "probe", fake_probe)
    response = client.post(
        "/v1/model-probe",
        json={
            "network": workspace["id"],
            "provider": "custom-anthropic",
            "api_key": "test-secret",
            "base_url": "https://relay.example/v1",
        },
        headers={"X-Workspace-Token": workspace["token"]},
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["keyOk"] is True
    assert seen == {
        "provider": "custom-anthropic",
        "base_url": "https://relay.example/v1",
    }
