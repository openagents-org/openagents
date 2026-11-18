"""Tests for tool-result batching in the Bedrock bearer-token (Converse) path."""

import json
from unittest.mock import patch

import pytest

from openagents.lms.providers import BedrockProvider


class _FakeResponse:
    status = 200

    async def json(self):
        return {"output": {"message": {"content": [{"text": "ok"}]}}}

    async def text(self):
        return ""


class _FakeSession:
    def __init__(self, sink):
        self._sink = sink

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def post(self, url, json=None, headers=None):
        self._sink.append(json)
        resp = _FakeResponse()

        class _Ctx:
            async def __aenter__(_self):
                return resp

            async def __aexit__(_self, *exc):
                return False

        return _Ctx()


async def _send(messages):
    sent = []
    with patch.dict("os.environ", {"AWS_BEARER_TOKEN_BEDROCK": "tok"}):
        provider = BedrockProvider(model_name="anthropic.claude-3-5-sonnet-20241022-v2:0")
    with patch("aiohttp.ClientSession", lambda: _FakeSession(sent)):
        await provider._claude_bedrock_bearer(messages, None)
    return sent[0]["messages"]


def _assistant_with_calls(n):
    return {
        "role": "assistant",
        "content": "",
        "tool_calls": [
            {"id": f"t{i}", "name": "f", "arguments": json.dumps({"i": i})}
            for i in range(n)
        ],
    }


@pytest.mark.asyncio
async def test_parallel_tool_results_share_one_user_message():
    msgs = await _send(
        [
            {"role": "user", "content": "go"},
            _assistant_with_calls(2),
            {"role": "tool", "tool_call_id": "t0", "content": "r0"},
            {"role": "tool", "tool_call_id": "t1", "content": "r1"},
        ]
    )
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    ids = [b["toolResult"]["toolUseId"] for b in msgs[2]["content"]]
    assert ids == ["t0", "t1"]


@pytest.mark.asyncio
async def test_single_tool_result_unchanged():
    msgs = await _send(
        [
            {"role": "user", "content": "go"},
            _assistant_with_calls(1),
            {"role": "tool", "tool_call_id": "t0", "content": "r0"},
        ]
    )
    assert [m["role"] for m in msgs] == ["user", "assistant", "user"]
    assert len(msgs[2]["content"]) == 1
