"""MiniMax recommendations do not restrict saved models or other model families."""

import json
from pathlib import Path

import httpx
import pytest
from app.services import cloud_providers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,base,expected",
    [
        ("orcarouter", None, ["minimax/minimax-m3"]),
        ("openrouter", None, ["minimax/minimax-m3.1-flash:free", "minimax/minimax-m3"]),
    ],
)
async def test_live_picker_keeps_only_verified_current_text_models(monkeypatch, provider, base, expected):
    ids = [
        "minimax/minimax-01",
        "minimax/minimax-music3",
        "minimax/minimax-m2.7",
        "minimax/minimax-m2.1",
        "minimax/minimax-m3",
        "minimax/minimax-m3.1-flash:free",
        "minimax/minimax-m3.1-flash",
        "minimax/speech-02-hd",
        "minimax/image-01",
        "openai/gpt-4o",
    ]
    real_client = httpx.AsyncClient
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"data": [{"id": mid} for mid in ids]})

    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    result = await cloud_providers.list_models_live(provider, "test-key", base)
    models = [m["id"] for m in result]
    assert [m for m in models if m.startswith("minimax/minimax-m") and m != "minimax/minimax-music3"] == expected
    assert "minimax/minimax-01" not in models
    assert "minimax/minimax-music3" in models
    assert "minimax/speech-02-hd" in models
    assert "minimax/image-01" in models
    assert "openai/gpt-4o" in models
    assert requests[0].headers["authorization"] == "Bearer test-key"
    assert str(requests[0].url) == cloud_providers.PROVIDERS[provider].base_url + "/models"
    assert cloud_providers.validate_provider_model(provider, "minimax/minimax-m2.7").id == "minimax/minimax-m2.7"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,base",
    [
        ("custom", "https://relay.example/v1"),
        ("openrouter", "https://relay.example/v1"),
        ("openai", None),
    ],
)
async def test_custom_and_other_provider_catalogs_are_unchanged(monkeypatch, provider, base):
    ids = ["minimax/minimax-m2.7", "my-saved-model", "gpt-4o"]
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: real_client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"data": [{"id": mid} for mid in ids]})
            ),
            **kw,
        ),
    )
    models = await cloud_providers.list_models_live(provider, "test-key", base)
    assert [m["id"] for m in models] == sorted(ids)


@pytest.mark.asyncio
async def test_live_catalog_does_not_invent_unavailable_models(monkeypatch):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: real_client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(200, json={"data": [{"id": "openai/gpt-4o"}]})
            ),
            **kw,
        ),
    )
    models = await cloud_providers.list_models_live("openrouter", "test-key")
    assert [m["id"] for m in models] == ["openai/gpt-4o"]


def test_static_catalog_copies_and_builtin_fallback_agree():
    root = Path(__file__).resolve().parents[3]
    for path in [root / "cloud_providers/orcarouter.json", root / "workspace/backend/cloud_providers/orcarouter.json"]:
        models = json.loads(path.read_text())["models"]
        assert [m["id"] for m in models if m["id"].startswith("minimax/")] == ["minimax/minimax-m3"]
    for provider in [cloud_providers.PROVIDERS["orcarouter"], cloud_providers._BUILTIN_PROVIDERS["orcarouter"]]:
        assert [m.id for m in provider.models if m.id.startswith("minimax/")] == ["minimax/minimax-m3"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider,model",
    [
        ("orcarouter", "minimax/minimax-m3"),
        ("openrouter", "minimax/minimax-m3.1-flash:free"),
        ("openrouter", "minimax/minimax-m3"),
        ("orcarouter", "minimax/minimax-m2.7"),
    ],
)
async def test_gateway_sdk_keeps_exact_selected_or_saved_model(monkeypatch, provider, model):
    real_sdk = cloud_providers.AsyncOpenAI
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "id": "chat_test",
                "object": "chat.completion",
                "created": 1,
                "model": model,
                "choices": [
                    {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "Hello"}}
                ],
            },
        )

    monkeypatch.setattr(
        cloud_providers,
        "AsyncOpenAI",
        lambda **kw: real_sdk(http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)), **kw),
    )
    result = await cloud_providers.chat_completion("test-key", provider, model, [{"role": "user", "content": "Hello"}])
    assert result == "Hello"
    body = json.loads(requests[0].content)
    assert str(requests[0].url) == cloud_providers.PROVIDERS[provider].base_url + "/chat/completions"
    assert body == {"model": model, "messages": [{"role": "user", "content": "Hello"}]}
