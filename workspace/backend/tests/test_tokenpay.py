"""TokenPay key validation, live models, and workspace credential routing."""

import asyncio
from types import SimpleNamespace

import httpx
import pytest

from app.services import cloud_providers, model_probe, tokenpay

KEY = "sk-tokenpay-test-secret"
CATALOG = {"data": [
    {"id": "dual", "name": "Dual protocol", "supported_protocols": ["openai:chat-completions", "anthropic:messages"]},
    {"id": "chat", "name": "Chat model", "supported_protocols": ["openai:chat-completions"]},
    {"id": "claude", "supported_protocols": ["anthropic:messages"]},
    {"id": "video", "supported_protocols": ["seedance:generations"]},
    {"id": "embedding", "supported_protocols": ["openai:embeddings"]},
    {"id": "responses-only", "supported_protocols": ["openai:responses"]},
    {"name": "Missing id"}, None,
]}


def _transport(monkeypatch, auth_status=200, catalog_status=200):
    seen = []

    def respond(request):
        seen.append(request)
        if str(request.url) == tokenpay.BALANCE_URL:
            return httpx.Response(auth_status, json={"balance": {"balance": 0}})
        assert str(request.url) == f"{tokenpay.BASE_URL}/models"
        return httpx.Response(catalog_status, json=CATALOG)

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=httpx.MockTransport(respond), **kwargs))
    return seen


def test_catalog_preserves_labels_and_protocols_without_non_agent_models(monkeypatch):
    seen = _transport(monkeypatch)
    models = asyncio.run(cloud_providers.list_models_live("tokenpay", KEY))
    assert [m["id"] for m in models] == ["chat", "claude", "dual"]
    assert models[2]["label"] == "Dual protocol"
    assert models[2]["supportedProtocols"] == ["openai:chat-completions", "anthropic:messages"]
    assert seen[0].headers["Authorization"] == f"Bearer {KEY}"
    assert "Authorization" not in seen[1].headers
    assert all(r.method == "GET" for r in seen)


@pytest.mark.parametrize("status", [401, 403])
def test_public_catalog_does_not_make_a_rejected_key_look_valid(monkeypatch, status):
    seen = _transport(monkeypatch, auth_status=status)
    result = asyncio.run(model_probe.probe("tokenpay", KEY, None, None))
    assert result["keyOk"] is False and result["models"] == []
    assert len(seen) == 1
    assert KEY not in str(result)


def test_catalog_failure_reports_unknown_validation_and_no_stale_models(monkeypatch):
    _transport(monkeypatch, catalog_status=503)
    result = asyncio.run(model_probe.probe("tokenpay", KEY, None, None))
    assert result["keyOk"] is None and result["models"] == []
    assert result["error"]
    assert KEY not in str(result)


@pytest.mark.parametrize("protocol, ids", [(None, ["chat", "dual"]), ("anthropic", ["claude", "dual"])])
def test_probe_returns_models_for_the_agent_protocol(monkeypatch, protocol, ids):
    _transport(monkeypatch)
    result = asyncio.run(model_probe.probe("tokenpay", KEY, None, None, protocol))
    assert result["keyOk"] is True
    assert [m["id"] for m in result["models"]] == ids
    assert "balance" not in result


def test_anthropic_model_check_uses_messages_protocol(monkeypatch):
    seen = {}

    async def completion(**kwargs):
        seen.update(kwargs)
        return "ok"

    monkeypatch.setattr(model_probe, "chat_completion", completion)
    result = asyncio.run(model_probe.probe("tokenpay", KEY, None, "claude", "anthropic"))
    assert result["ok"] is True
    assert seen["provider"] == "custom-anthropic"
    assert seen["base_url"] == tokenpay.ANTHROPIC_BASE_URL
    assert seen["api_key"] == KEY


def _save(client, workspace):
    response = client.post("/v1/model-access", json={
        "network": workspace["id"], "provider": "tokenpay", "api_key": KEY,
    }, headers={"X-Workspace-Token": workspace["token"]})
    assert response.status_code == 200, response.text
    assert KEY not in response.text
    entry = response.json()["data"]
    assert entry["provider"] == "tokenpay" and entry["label"] == "TokenDance"
    return entry["id"]


def test_saved_key_is_masked_and_lists_live_models_server_side(client, workspace, monkeypatch):
    _transport(monkeypatch)
    access_id = _save(client, workspace)
    response = client.post(f"/v1/model-access/{access_id}/probe", json={
        "network": workspace["id"], "protocol": "anthropic",
    }, headers={"X-Workspace-Token": workspace["token"]})
    assert response.status_code == 200
    assert [m["id"] for m in response.json()["data"]["models"]] == ["claude", "dual"]
    assert KEY not in response.text
    listed = client.get(f"/v1/model-access?network={workspace['id']}", headers={"X-Workspace-Token": workspace["token"]})
    assert KEY not in listed.text


@pytest.mark.parametrize("agent_type, base_url", [("claude", tokenpay.ANTHROPIC_BASE_URL), ("codex", tokenpay.BASE_URL)])
def test_saved_access_delivers_protocol_specific_endpoint_to_node(client, workspace, agent_type, base_url):
    access_id = _save(client, workspace)
    headers = {"X-Workspace-Token": workspace["token"]}
    code = client.post(f"/v1/workspaces/{workspace['id']}/pairing-codes", headers=headers).json()["data"]["code"]
    node_id = client.post("/v1/nodes/redeem", json={"code": code, "node_key": "tokenpay-node"}).json()["data"]["nodeId"]
    response = client.post(f"/v1/nodes/{node_id}/commands", headers=headers, json={
        "action": "create_agent", "args": {"name": "wallet-agent", "type": agent_type, "modelAccessId": access_id, "model": "dual"},
    })
    assert response.status_code == 200, response.text
    assert KEY not in response.text
    heartbeat = client.post("/v1/nodes/heartbeat", headers=headers, json={"node_id": node_id})
    args = heartbeat.json()["data"]["commands"][0]["args"]
    assert args["apiKey"] == KEY and args["baseUrl"] == base_url
    assert "modelAccessId" not in args


def test_cloud_provider_calls_use_configured_endpoint_and_selected_model(monkeypatch):
    seen = {}

    class Client:
        def __init__(self, **kwargs):
            seen.update(kwargs)
            self.chat = SimpleNamespace(completions=self)

        async def create(self, **kwargs):
            seen["request"] = kwargs
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))])

        async def close(self):
            pass

    monkeypatch.setattr(cloud_providers, "AsyncOpenAI", Client)
    assert asyncio.run(cloud_providers.chat_completion(KEY, "tokenpay", "chat", [{"role": "user", "content": "hi"}])) == "ok"
    assert seen["base_url"] == tokenpay.BASE_URL
    assert seen["api_key"] == KEY
    assert seen["request"]["model"] == "chat"


def test_catalog_lists_tokendance_first_with_picker_copy():
    """TokenDance (provider id `tokenpay`) leads the catalog, and every
    provider carries the optional picker fields (None when absent)."""
    from app.services.cloud_providers import providers_catalog

    catalog = providers_catalog()
    names = [p["name"] for p in catalog if p["name"] != "openagents"]
    assert names[0] == "tokenpay"
    tokendance = next(p for p in catalog if p["name"] == "tokenpay")
    assert tokendance["label"] == "TokenDance"
    assert tokendance["key_url"] == "https://tokendance.space/keys"
    assert tokendance["description"] and tokendance["description_zh"]
    assert all({"description", "description_zh", "key_url"} <= set(p) for p in catalog)
