"""Offline wire-boundary checks using the optional google-generativeai SDK.

Only the transport is replaced. Passing these tests establishes SDK serialization,
not server acceptance of empty text or arbitrary conversation role sequences.
"""

import asyncio
import socket
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from openagents.lms.providers import GeminiProvider


@pytest.fixture
def sdk_boundary(monkeypatch):
    genai = pytest.importorskip("google.generativeai")

    def no_network(*args, **kwargs):
        pytest.fail("SDK boundary tests must not open a network connection")

    monkeypatch.setattr(socket.socket, "connect", no_network)
    monkeypatch.setattr(socket, "create_connection", no_network)
    monkeypatch.setattr(socket, "getaddrinfo", no_network)
    # Model construction is local; no configure(), credentials, or API calls.
    model = genai.GenerativeModel("gemini-2.5-flash")
    transport = SimpleNamespace(
        generate_content=AsyncMock(
            return_value=genai.protos.GenerateContentResponse(
                candidates=[{"content": {"role": "model", "parts": [{"text": "ok"}]}}],
                usage_metadata={"prompt_token_count": 12, "candidates_token_count": 3, "total_token_count": 15},
            )
        )
    )
    model._async_client = transport
    def generative_model(*args, **kwargs):
        # Real model construction (incl. system_instruction), fake transport.
        built = genai.GenerativeModel(*args, **kwargs)
        built._async_client = transport
        return built

    provider = GeminiProvider.__new__(GeminiProvider)
    provider.model_name = "gemini-2.5-flash"
    provider.client = model
    provider._genai = SimpleNamespace(GenerativeModel=generative_model)
    return provider, transport, genai.protos


@pytest.mark.parametrize("system", [None, "Follow the user's language.", ""])
@pytest.mark.parametrize("assistant", ["Hello Ada.", "", None])
def test_history_survives_real_sdk_serialization(sdk_boundary, system, assistant):
    provider, transport, protos = sdk_boundary
    messages = [
        {"role": "user", "content": "My name is Ada."},
        {"role": "assistant", "content": assistant},
        {"role": "user", "content": "What is my name?"},
    ]
    expected = [("user", "My name is Ada.")]
    if assistant:
        expected.append(("model", assistant))
    expected.append(("user", "What is my name?"))
    if system is not None:
        messages.insert(0, {"role": "system", "content": system})
    original = deepcopy(messages)

    result = asyncio.run(provider.chat_completion(messages))

    transport.generate_content.assert_awaited_once()
    request = transport.generate_content.await_args.args[0]
    # Round-trip the actual protobuf, rather than just inspecting Python dicts.
    wire = protos.GenerateContentRequest.deserialize(protos.GenerateContentRequest.serialize(request))
    assert [(content.role, content.parts[0].text) for content in wire.contents] == expected
    assert all(len(content.parts) == 1 for content in wire.contents)
    # Every sent Part carries text (empty turns are skipped, not sent as missing Parts).
    assert all(protos.Part.pb(content.parts[0]).WhichOneof("data") == "text" for content in wire.contents)
    assert not wire.tools
    if system:
        assert [part.text for part in wire.system_instruction.parts] == [system]
    else:
        assert not wire.system_instruction.parts
    assert result == {
        "content": "ok",
        "tool_calls": [],
        "usage": {"input_tokens": 12, "output_tokens": 3, "total_tokens": 15},
    }
    assert messages == original


def test_real_sdk_rejects_empty_scalar_before_transport(sdk_boundary):
    provider, transport, _ = sdk_boundary
    with pytest.raises(TypeError, match="contents must not be empty"):
        asyncio.run(provider.client.generate_content_async(""))
    transport.generate_content.assert_not_awaited()


def test_single_user_prompt_through_real_sdk(sdk_boundary):
    provider, transport, protos = sdk_boundary
    assert asyncio.run(provider.chat_completion([{"role": "user", "content": "Hello"}]))["content"] == "ok"
    request = transport.generate_content.await_args.args[0]
    wire = protos.GenerateContentRequest.deserialize(protos.GenerateContentRequest.serialize(request))
    assert [(content.role, content.parts[0].text) for content in wire.contents] == [("user", "Hello")]
