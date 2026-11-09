"""Anthropic/Bedrock providers must convert OpenAI-style tool messages."""

from unittest.mock import AsyncMock, MagicMock

import pytest

from openagents.lms.providers import AnthropicProvider

HISTORY = [
    {"role": "system", "content": "sys"},
    {"role": "user", "content": "weather?"},
    {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {
                "id": "toolu_1",
                "type": "function",
                "function": {"name": "get_weather", "arguments": '{"city": "Paris"}'},
            }
        ],
    },
    {"role": "tool", "tool_call_id": "toolu_1", "content": "sunny"},
]


def test_converts_tool_messages():
    from openagents.lms.providers import _to_anthropic_messages

    system, msgs = _to_anthropic_messages(HISTORY)
    assert system == "sys"
    assert msgs[1] == {
        "role": "assistant",
        "content": [
            {
                "type": "tool_use",
                "id": "toolu_1",
                "name": "get_weather",
                "input": {"city": "Paris"},
            }
        ],
    }
    assert msgs[2] == {
        "role": "user",
        "content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": "sunny"}],
    }


def test_consecutive_tool_results_share_one_user_message():
    from openagents.lms.providers import _to_anthropic_messages

    history = HISTORY + [{"role": "tool", "tool_call_id": "toolu_2", "content": "x"}]
    _, msgs = _to_anthropic_messages(history)
    assert len(msgs[-1]["content"]) == 2


@pytest.mark.asyncio
async def test_anthropic_provider_sends_converted_messages():
    provider = AnthropicProvider(model_name="claude-x", api_key="k")
    response = MagicMock(content=[], usage=None)
    provider.client = MagicMock()
    provider.client.messages.create = AsyncMock(return_value=response)
    await provider.chat_completion(HISTORY)
    sent = provider.client.messages.create.call_args.kwargs["messages"]
    assert sent[1]["content"][0]["type"] == "tool_use"
    assert sent[2]["content"][0]["type"] == "tool_result"
