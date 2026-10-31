"""Exercise MiniMax selection through the real SDK HTTP serialization boundary."""

import json

import httpx
import pytest

from openagents.agents.runner import AgentRunner
from openagents.config.llm_configs import MODEL_CONFIGS
from openagents.models.agent_config import AgentConfig
from openagents.models.tool import AgentTool


class Runner(AgentRunner):
    async def react(self, context):
        pass


@pytest.mark.asyncio
@pytest.mark.parametrize("model", ["MiniMax-M3.1-Flash", "MiniMax-M3", "MiniMax-M2.7"])
@pytest.mark.parametrize(
    "base",
    [
        "https://api.minimax.io/v1",
        "https://api.minimaxi.com/v1",
        "https://api.minimax.io/anthropic",
        "https://api.minimaxi.com/anthropic",
    ],
)
async def test_auto_selection_serializes_real_sdk_request(monkeypatch, model, base):
    monkeypatch.setenv("DEFAULT_LLM_PROVIDER", "minimax")
    monkeypatch.setenv("DEFAULT_LLM_MODEL_NAME", model)
    monkeypatch.setenv("DEFAULT_LLM_API_KEY", "test-key")
    monkeypatch.setenv("DEFAULT_LLM_BASE_URL", base)
    config = AgentConfig(instruction="Be helpful.", model_name="auto")
    assert config.get_supported_models("minimax") == ["MiniMax-M3.1-Flash", "MiniMax-M3"]
    provider = Runner(agent_id="test", agent_config=config).get_llm()
    requests = []
    anthropic = base.endswith("/anthropic")

    def respond(request):
        requests.append(request)
        if anthropic:
            payload = {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": [{"type": "text", "text": "Hello"}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {"input_tokens": 4, "output_tokens": 2},
            }
        else:
            payload = {
                "id": "chat_test",
                "object": "chat.completion",
                "created": 1,
                "model": model,
                "choices": [
                    {"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": "Hello"}}
                ],
                "usage": {"prompt_tokens": 4, "completion_tokens": 2, "total_tokens": 6},
            }
        return httpx.Response(200, json=payload)

    # Keep the real AsyncOpenAI/AsyncAnthropic SDK; replace only its HTTP transport.
    await provider.client._client.aclose()
    provider.client._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    tool = AgentTool(
        name="lookup",
        description="Look up a value",
        input_schema={"type": "object", "properties": {}},
        func=lambda: None,
    )
    image = (
        {"type": "image", "source": {"type": "url", "url": "https://example.com/image.png"}}
        if anthropic
        else {"type": "image_url", "image_url": {"url": "https://example.com/image.png"}}
    )
    # Legacy IDs remain pass-through compatibility cases, not new capabilities.
    content = "Hello" if model == "MiniMax-M2.7" else [{"type": "text", "text": "Hello"}, image]
    try:
        result = await provider.chat_completion(
            [{"role": "system", "content": "Be helpful."}, {"role": "user", "content": content}],
            provider.format_tools([tool]),
        )
    finally:
        await provider.client.close()
    assert result["content"] == "Hello"
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == base + ("/v1/messages" if anthropic else "/chat/completions")
    body = json.loads(request.content)
    assert body["model"] == model
    assert body["messages"][-1] == {"role": "user", "content": content}
    if not anthropic:
        assert body["temperature"] == 1.0
    assert not {"thinking", "reasoning_effort", "output_config", "extra_body"} & body.keys()
    if anthropic:
        assert request.headers["x-api-key"] == "test-key"
        assert body["max_tokens"] == 4096
        assert body["tools"][0]["name"] == "lookup"
        assert body["system"] == "Be helpful."
    else:
        assert request.headers["authorization"] == "Bearer test-key"
        assert body["tools"][0]["function"]["name"] == "lookup"
        assert body["tool_choice"] == "auto"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "provider_name,model",
    [
        ("custom", "my-saved-model"),
        ("minimax", "MiniMax-M2.7-highspeed"),
        ("openai", "gpt-4o"),
    ],
)
async def test_saved_models_and_custom_base_are_preserved(provider_name, model):
    config = AgentConfig(
        instruction="Be helpful.",
        provider=provider_name,
        model_name=model,
        api_key="test-key",
        api_base="https://relay.example/v1",
    )
    provider = Runner(agent_id="test", agent_config=config).get_llm()
    assert provider.model_name == model
    assert str(provider.client.base_url) == "https://relay.example/v1/"
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

    await provider.client._client.aclose()
    provider.client._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    try:
        result = await provider.chat_completion([{"role": "user", "content": "Hello"}])
    finally:
        await provider.client.close()
    assert result["content"] == "Hello"
    assert str(requests[0].url) == "https://relay.example/v1/chat/completions"
    assert json.loads(requests[0].content)["model"] == model
    assert MODEL_CONFIGS["openai"]["models"][0] == "gpt-5.2"
