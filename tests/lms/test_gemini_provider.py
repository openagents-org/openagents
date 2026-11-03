"""Offline regression tests for the Gemini provider's conversation boundary."""

import asyncio
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from openagents.lms.providers import GeminiProvider


@pytest.fixture
def provider():
    # Import and execute the real method, without configuring credentials or a model.
    provider = GeminiProvider.__new__(GeminiProvider)
    provider.client = SimpleNamespace(generate_content_async=AsyncMock(return_value=SimpleNamespace(text="ok")))
    return provider


@pytest.mark.parametrize("system", [None, "Follow the user's preferred language."])
def test_sends_ordered_full_conversation(provider, system):
    messages = [
        {"role": "user", "content": "My name is Ada."},
        {"role": "assistant", "content": "Hello Ada."},
        {"role": "user", "content": "Remember that I prefer Chinese."},
        {"role": "assistant", "content": "Understood."},
        {"role": "user", "content": "What is my name?"},
    ]
    expected = [
        {"role": "user", "parts": ["My name is Ada."]},
        {"role": "model", "parts": ["Hello Ada."]},
        {"role": "user", "parts": ["Remember that I prefer Chinese."]},
        {"role": "model", "parts": ["Understood."]},
        {"role": "user", "parts": ["What is my name?"]},
    ]
    if system is not None:
        messages.insert(0, {"role": "system", "content": system})
        expected = [
            {"role": "user", "parts": [system]},
            {"role": "model", "parts": ["I understand."]},
        ] + expected
    original = deepcopy(messages)

    assert asyncio.run(provider.chat_completion(messages)) == {"content": "ok", "tool_calls": []}
    provider.client.generate_content_async.assert_awaited_once_with(expected)
    assert messages == original


def test_preserves_empty_assistant_turn(provider):
    messages = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": None},
        {"role": "user", "content": "Try again"},
    ]
    asyncio.run(provider.chat_completion(messages))
    provider.client.generate_content_async.assert_awaited_once_with(
        [
            {"role": "user", "parts": ["Hello"]},
            {"role": "model", "parts": [""]},
            {"role": "user", "parts": ["Try again"]},
        ]
    )


def test_empty_messages_do_not_call_client(provider):
    assert asyncio.run(provider.chat_completion([])) == {"content": "", "tool_calls": []}
    provider.client.generate_content_async.assert_not_awaited()


@pytest.mark.parametrize("text", ["ok", ""])
@pytest.mark.parametrize(
    "usage_fields, expected_usage",
    [
        ({}, None),
        ({"usage_metadata": None}, None),
        (
            {"usage_metadata": SimpleNamespace(prompt_token_count=12, candidates_token_count=3, total_token_count=15)},
            {"input_tokens": 12, "output_tokens": 3, "total_tokens": 15},
        ),
        (
            {"usage_metadata": SimpleNamespace(prompt_token_count=0, candidates_token_count=0, total_token_count=0)},
            {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0},
        ),
        (
            {"usage_metadata": SimpleNamespace(prompt_token_count=12)},
            {"input_tokens": 12, "output_tokens": None, "total_tokens": None},
        ),
    ],
)
def test_response_and_usage_contract(provider, text, usage_fields, expected_usage):
    provider.client.generate_content_async.return_value = SimpleNamespace(text=text, **usage_fields)
    result = asyncio.run(provider.chat_completion([{"role": "user", "content": "Hi"}]))
    expected = {"content": text, "tool_calls": []}
    if expected_usage is not None:
        expected["usage"] = expected_usage
    assert result == expected
    provider.client.generate_content_async.assert_awaited_once()


def test_client_errors_propagate(provider):
    provider.client.generate_content_async.side_effect = RuntimeError("client failed")
    with pytest.raises(RuntimeError, match="client failed"):
        asyncio.run(provider.chat_completion([{"role": "user", "content": "Hi"}]))


def test_tools_remain_unsupported(provider):
    assert provider.format_tools([object()]) == []
    result = asyncio.run(provider.chat_completion([{"role": "user", "content": "Hi"}], tools=[{"name": "example"}]))
    assert result["tool_calls"] == []
    assert provider.client.generate_content_async.await_args.kwargs == {}
