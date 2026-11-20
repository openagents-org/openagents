"""ClaudeAdapter must surface CLI failures to the user instead of only logging.

A fake subprocess stands in for the ``claude`` CLI, so no binary or credits
are needed.

Run:
    pytest tests/agents/test_claude_adapter_errors.py -v
"""

import asyncio
import json

import openagents.adapters.claude as claude_mod
from openagents.adapters.claude import ClaudeAdapter


class _FakeStream:
    def __init__(self, data: bytes):
        self._lines = data.splitlines(keepends=True)
        self._raw = data

    async def readline(self):
        return self._lines.pop(0) if self._lines else b""

    async def read(self):
        return self._raw


class _FakeProcess:
    def __init__(self, stdout_events, stderr=b"", returncode=0):
        out = b"".join(json.dumps(e).encode() + b"\n" for e in stdout_events)
        self.stdout = _FakeStream(out)
        self.stderr = _FakeStream(stderr)
        self.returncode = returncode

    async def wait(self):
        return self.returncode


def _run(monkeypatch, tmp_path, process):
    monkeypatch.setattr(claude_mod.Path, "home", lambda: tmp_path)
    adapter = ClaudeAdapter("ws", "main", "tok", "agent")
    adapter._titled_sessions.add("main")
    sent = []

    async def fake_exec(*args, **kwargs):
        return process

    async def fake_browser():
        return False

    async def capture(channel, text, *a, **k):
        sent.append(text)

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    monkeypatch.setattr(adapter, "_build_claude_cmd", lambda *a, **k: ["claude"])
    monkeypatch.setattr(adapter, "get_browser_enabled", fake_browser)
    for name in ("_send_status", "_send_response", "_send_error"):
        monkeypatch.setattr(adapter, name, capture)

    async def go():
        await adapter._handle_message({"content": "hi", "sessionId": "main"})

    asyncio.run(go())
    return sent


def test_result_is_error_is_reported(monkeypatch, tmp_path):
    proc = _FakeProcess(
        [{"type": "result", "is_error": True, "result": "Invalid API key sk-abcdef123456"}],
        returncode=1,
    )
    sent = _run(monkeypatch, tmp_path, proc)
    final = sent[-1]
    assert "Invalid API key" in final
    assert "sk-abcdef123456" not in final
    assert "No response generated" not in final


def test_stderr_is_reported_when_no_output(monkeypatch, tmp_path):
    proc = _FakeProcess([], stderr=b"claude: command crashed", returncode=2)
    sent = _run(monkeypatch, tmp_path, proc)
    assert "command crashed" in sent[-1]
    assert "No response generated" not in sent[-1]


def test_exit_code_reported_when_nothing_else(monkeypatch, tmp_path):
    sent = _run(monkeypatch, tmp_path, _FakeProcess([], returncode=3))
    assert "3" in sent[-1]
    assert "No response generated" not in sent[-1]
