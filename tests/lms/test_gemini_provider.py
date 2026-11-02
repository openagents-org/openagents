"""Unit tests for the Gemini provider."""

import asyncio
from unittest.mock import AsyncMock, MagicMock

from openagents.lms.providers import GeminiProvider


def _provider_with_fake_client():
    provider = GeminiProvider.__new__(GeminiProvider)
    provider.model_name = "gemini-test"
    response = MagicMock()
    response.text = "ok"
    response.usage_metadata = None
    provider.client = MagicMock()
    provider.client.generate_content_async = AsyncMock(return_value=response)
    return provider


class TestGeminiProviderHistory:
    def test_chat_completion_sends_full_conversation(self):
        provider = _provider_with_fake_client()
        messages = [
            {"role": "system", "content": "You are terse."},
            {"role": "user", "content": "My name is Ada."},
            {"role": "assistant", "content": "Hello Ada."},
            {"role": "user", "content": "What is my name?"},
        ]

        result = asyncio.run(provider.chat_completion(messages))

        assert result["content"] == "ok"
        provider.client.generate_content_async.assert_awaited_once()
        sent = provider.client.generate_content_async.await_args.args[0]
        assert sent == [
            {"role": "user", "parts": ["You are terse."]},
            {"role": "model", "parts": ["I understand."]},
            {"role": "user", "parts": ["My name is Ada."]},
            {"role": "model", "parts": ["Hello Ada."]},
            {"role": "user", "parts": ["What is my name?"]},
        ]

    def test_chat_completion_empty_messages(self):
        provider = _provider_with_fake_client()

        result = asyncio.run(provider.chat_completion([]))

        assert result == {"content": "", "tool_calls": []}
        provider.client.generate_content_async.assert_not_awaited()
