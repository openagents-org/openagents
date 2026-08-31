"""Unit tests for the Kimi adapter, its stream helpers, and registry wiring.

No real Kimi Code CLI is installed and no model credits are used: a fake ``kimi``
executable plus monkeypatching cover binary discovery, product classification,
the JSONL stream parser, the env-provider mapping, CLI-vs-direct routing, session
resume, and an end-to-end stream-json run. Mirrors
packages/agent-connector/test/kimi.test.js.

Run:
    pytest tests/agents/test_kimi_adapter.py -v
"""

import asyncio
import functools
import json
import stat

import pytest

import openagents.registry.loader as loader
from openagents.adapters import kimi as kimi_mod
from openagents.adapters.kimi import KimiAdapter, find_kimi_binary
from openagents.adapters.kimi_stream import (
    DEFAULT_KIMI_MODEL,
    KimiStreamParser,
    build_kimi_args,
    build_kimi_env,
    classify_kimi_error,
    classify_kimi_version,
    extract_stderr_error,
    interpret_kimi_message,
    redact_args,
    tool_preview,
)


def _aiorun(coro_fn):
    """Run an async test body via asyncio.run so the suite doesn't depend on a
    pytest async plugin being installed (pytest still injects fixtures via the
    preserved signature)."""

    @functools.wraps(coro_fn)
    def wrapper(*args, **kwargs):
        return asyncio.run(coro_fn(*args, **kwargs))

    return wrapper


def _kimi_data():
    return next(d for d in loader.load_registry_yamls() if d.get("name") == "kimi")


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class TestRegistry:
    def test_kimi_is_builtin_and_points_at_this_adapter(self):
        data = _kimi_data()
        assert data.get("builtin") is True
        assert data["adapter"]["module"] == "openagents.adapters.kimi"
        assert data["adapter"]["class"] == "KimiAdapter"

    def test_registry_describes_the_cli_product(self):
        data = _kimi_data()
        # The entry must advertise the CLI this adapter actually drives, not the
        # API-only agent kimi used to be.
        assert data["label"] == "Kimi Code CLI"
        assert "cli" in data["tags"]
        assert "@moonshot-ai/kimi-code" in data["install"]["macos"]
        assert data["check_ready"]["login_command"] == "kimi login"

    def test_api_key_is_optional_now_that_kimi_login_exists(self):
        fields = {f["name"]: f for f in _kimi_data()["env_config"]}
        assert fields["KIMI_API_KEY"]["required"] is False
        assert fields["KIMI_API_KEY"].get("password") is True

    def test_plugin_creates_this_adapter(self):
        plugin = loader._make_plugin_from_yaml(_kimi_data())
        adapter = plugin.create_adapter("ws", "chan", "tok", "agent", "http://x")
        assert isinstance(adapter, KimiAdapter)


# ---------------------------------------------------------------------------
# Binary discovery
# ---------------------------------------------------------------------------


@pytest.fixture
def isolated_home(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("USERPROFILE", str(home))
    empty_bin = tmp_path / "empty-bin"
    empty_bin.mkdir()
    monkeypatch.setenv("PATH", str(empty_bin))
    return home


def _make_executable(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/sh\nexit 0\n")
    path.chmod(path.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    return path


class TestBinaryDiscovery:
    def test_none_when_nothing_installed(self, isolated_home):
        assert find_kimi_binary() is None

    def test_launcher_runtime_prefix_wins_over_path(self, isolated_home, monkeypatch, tmp_path):
        managed = _make_executable(
            isolated_home / ".openagents" / "runtimes" / "kimi" / "node_modules" / ".bin" / "kimi"
        )
        on_path = _make_executable(tmp_path / "path-bin" / "kimi")
        monkeypatch.setenv("PATH", str(on_path.parent))
        # A launcher-managed install must win: it is the one the launcher
        # installs, updates and knows the version of.
        assert find_kimi_binary() == str(managed)

    def test_finds_the_packages_own_mjs_entry(self, isolated_home):
        pkg_bin = (
            isolated_home / ".openagents" / "runtimes" / "kimi" / "node_modules"
            / "@moonshot-ai" / "kimi-code" / "dist" / "main.mjs"
        )
        pkg_bin.parent.mkdir(parents=True, exist_ok=True)
        pkg_bin.write_text("// entry\n")
        assert find_kimi_binary() == str(pkg_bin)

    def test_finds_the_postinstall_native_build(self, isolated_home):
        native = _make_executable(isolated_home / ".kimi-code" / "bin" / "kimi")
        assert find_kimi_binary() == str(native)

    def test_finds_kimi_on_path(self, isolated_home, monkeypatch, tmp_path):
        bindir = tmp_path / "bin"
        found = _make_executable(bindir / "kimi")
        monkeypatch.setenv("PATH", str(bindir))
        assert find_kimi_binary() == str(found)


# ---------------------------------------------------------------------------
# Stream helpers (pure)
# ---------------------------------------------------------------------------


class TestVersionClassification:
    def test_kimi_code_vs_legacy_python_cli(self):
        # Two Moonshot products install a `kimi` binary; only 0.x is the one
        # this adapter can drive.
        assert classify_kimi_version("kimi 0.39.1") == ("0.39.1", "kimi-code")
        assert classify_kimi_version("0.40.0-beta.2") == ("0.40.0-beta.2", "kimi-code")
        assert classify_kimi_version("kimi-cli 1.44.0") == ("1.44.0", "legacy")

    def test_unparseable_output_stays_undetermined(self):
        # Lenient on purpose: an unreadable --version must not block a working
        # install.
        assert classify_kimi_version("no version here") == (None, None)
        assert classify_kimi_version(None) == (None, None)


class TestStreamParser:
    def test_parses_jsonl_across_chunk_boundaries(self):
        parser = KimiStreamParser()
        assert parser.push('{"role":"assistant","content":"hel') == []
        msgs = parser.push('lo"}\n{"role":"meta","type":"system.version","version":"0.39.1"}\n')
        assert [m.get("content") or m.get("version") for m in msgs] == ["hello", "0.39.1"]

    def test_flush_returns_the_unterminated_tail(self):
        parser = KimiStreamParser()
        parser.push('{"role":"assistant","content":"tail"}')
        assert parser.push("") == []
        assert parser.flush() == [{"role": "assistant", "content": "tail"}]

    def test_skips_non_json_diagnostics_without_dying(self):
        parser = KimiStreamParser()
        msgs = parser.push(
            'warming up\n{"role":"assistant","content":"ok"}\nnot json at all\n'
        )
        assert msgs == [{"role": "assistant", "content": "ok"}]

    def test_accepts_bytes(self):
        parser = KimiStreamParser()
        assert parser.push(b'{"role":"assistant","content":"b"}\n')[0]["content"] == "b"


class TestMessageInterpretation:
    def test_assistant_text_and_tool_calls(self):
        events = interpret_kimi_message(
            {
                "role": "assistant",
                "content": "working on it",
                "tool_calls": [
                    {
                        "type": "function",
                        "id": "1",
                        "function": {"name": "Bash", "arguments": '{"command":"ls -la"}'},
                    }
                ],
            }
        )
        assert events[0] == {"kind": "text", "text": "working on it"}
        assert events[1] == {"kind": "tool_start", "name": "Bash", "preview": "ls -la"}

    def test_content_blocks_are_flattened(self):
        events = interpret_kimi_message(
            {"role": "assistant", "content": [{"text": "a"}, {"text": "b"}]}
        )
        assert events == [{"kind": "text", "text": "ab"}]

    def test_whitespace_only_filler_produces_no_text_event(self):
        events = interpret_kimi_message(
            {
                "role": "assistant",
                "content": "   \n ",
                "tool_calls": [{"function": {"name": "Read", "arguments": "{}"}}],
            }
        )
        assert [e["kind"] for e in events] == ["tool_start"]

    def test_session_and_retry_meta(self):
        assert interpret_kimi_message(
            {"role": "meta", "type": "session.resume_hint", "session_id": "sess-1"}
        ) == [{"kind": "session", "session_id": "sess-1"}]

        retry = interpret_kimi_message(
            {
                "role": "meta",
                "type": "turn.step.retrying",
                "failed_attempt": 1,
                "max_attempts": 3,
                "error_message": "upstream 502",
            }
        )
        assert retry == [
            {"kind": "retrying", "attempt": 1, "max_attempts": 3, "message": "upstream 502"}
        ]

    def test_unknown_roles_and_meta_types_are_ignored(self):
        assert interpret_kimi_message({"role": "user", "content": "echo"}) == []
        assert interpret_kimi_message({"role": "meta", "type": "something.new"}) == []
        assert interpret_kimi_message("not a dict") == []

    def test_tool_result_carries_its_id(self):
        assert interpret_kimi_message(
            {"role": "tool", "tool_call_id": "abc", "content": "done"}
        ) == [{"kind": "tool_result", "id": "abc", "text": "done"}]

    def test_tool_preview_redacts_and_truncates(self):
        assert "«redacted»" in tool_preview('{"command":"export K=sk-abcdefghijklmnop"}')
        long = tool_preview(json.dumps({"command": "x" * 200}))
        assert long.endswith("…") and len(long) == 81
        assert tool_preview("not json") == ""
        assert tool_preview(None) == ""


class TestArgsAndEnv:
    def test_print_mode_args_with_resume_only_when_resuming(self):
        assert build_kimi_args("do it") == [
            "-p", "do it", "--output-format", "stream-json",
        ]
        assert build_kimi_args("do it", "sess-1") == [
            "-S", "sess-1", "-p", "do it", "--output-format", "stream-json",
        ]

    def test_args_never_carry_permission_or_plan_flags(self):
        # Print mode auto-approves tools and the CLI REJECTS combining -p with
        # --yolo/--auto/--plan (verified v0.39.1).
        args = build_kimi_args("do it", "sess-1")
        assert not {"--yolo", "--auto", "--plan"} & set(args)

    def test_logged_argv_elides_the_prompt(self):
        assert redact_args(["kimi", "-p", "secret business", "--output-format"]) == [
            "kimi", "-p", "«prompt»", "--output-format",
        ]

    def test_maps_launcher_fields_onto_the_env_provider_contract(self):
        env, via = build_kimi_env(
            {
                "KIMI_API_KEY": "sk-test",
                "KIMI_BASE_URL": "https://relay.example.com/v1/",
                "KIMI_MODEL": "kimi-k2.7-code",
            }
        )
        assert via is True
        assert env["KIMI_MODEL_API_KEY"] == "sk-test"
        assert env["KIMI_MODEL_NAME"] == "kimi-k2.7-code"
        # Trailing slash stripped — the CLI concatenates paths onto this.
        assert env["KIMI_MODEL_BASE_URL"] == "https://relay.example.com/v1"
        assert env["KIMI_MODEL_PROVIDER_TYPE"] == "kimi"
        # Gateways reject the CLI's default (the model's full context size).
        assert env["KIMI_MODEL_MAX_COMPLETION_TOKENS"] == "32768"

    def test_accepts_the_moonshot_alias_and_default_model(self):
        env, via = build_kimi_env({"MOONSHOT_API_KEY": "sk-alias"})
        assert via is True
        assert env["KIMI_MODEL_API_KEY"] == "sk-alias"
        assert env["KIMI_MODEL_NAME"] == DEFAULT_KIMI_MODEL

    def test_never_overrides_explicit_kimi_model_variables(self):
        env, _ = build_kimi_env(
            {
                "KIMI_API_KEY": "sk-test",
                "KIMI_MODEL_NAME": "custom",
                "KIMI_MODEL_PROVIDER_TYPE": "openai",
                "KIMI_MODEL_MAX_COMPLETION_TOKENS": "999",
            }
        )
        assert env["KIMI_MODEL_NAME"] == "custom"
        assert env["KIMI_MODEL_PROVIDER_TYPE"] == "openai"
        assert env["KIMI_MODEL_MAX_COMPLETION_TOKENS"] == "999"

    def test_no_key_passes_env_through_for_the_kimi_login_path(self):
        env, via = build_kimi_env({"PATH": "/usr/bin", "KIMI_MODEL": "kimi-k3"})
        assert via is False
        # Untouched: the CLI's own `kimi login` credentials must apply.
        assert env == {"PATH": "/usr/bin", "KIMI_MODEL": "kimi-k3"}


class TestErrorClassification:
    def test_extracts_and_strips_the_cli_wrapper(self):
        assert extract_stderr_error(
            "noise\nerror: failed to run prompt: auth_error 401\n"
        ) == "auth_error 401"
        assert extract_stderr_error("") == ""

    def test_auth_config_rate_and_context_failures(self):
        assert classify_kimi_error(code=1, stderr_text="error: auth_error 401").kind == "auth"
        assert classify_kimi_error(
            code=1, stderr_text="error: KIMI_MODEL_API_KEY is missing"
        ).kind == "config"
        assert classify_kimi_error(code=1, stderr_text="error: 429 rate limit").kind == "rate_limit"
        assert classify_kimi_error(
            code=1, stderr_text="error: maximum context exceeded"
        ).kind == "context"

    def test_transient_exit_code_is_retryable(self):
        assert classify_kimi_error(code=75, stderr_text="").kind == "transient"

    def test_generic_failure_names_the_exit_or_signal(self):
        assert "exited with code 3" in classify_kimi_error(code=3).user_message
        assert "signal SIGKILL" in classify_kimi_error(code=None, signal="SIGKILL").user_message

    def test_falls_back_to_the_last_provider_retry_error(self):
        # Nothing on stderr, but the stream reported a retry — use that.
        result = classify_kimi_error(code=1, stderr_text="", retry_message="upstream 401 unauthorized")
        assert result.kind == "auth"

    def test_auth_message_offers_both_sign_in_paths(self):
        msg = classify_kimi_error(code=1, stderr_text="error: auth_error 401").user_message
        assert "KIMI_API_KEY" in msg and "kimi login" in msg


# ---------------------------------------------------------------------------
# Adapter: direct-API configuration (the pre-CLI behaviour, still supported)
# ---------------------------------------------------------------------------


@pytest.fixture
def clean_env(monkeypatch):
    for key in (
        "KIMI_API_KEY", "MOONSHOT_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY",
        "KIMI_BASE_URL", "LLM_BASE_URL", "OPENAI_BASE_URL", "KIMI_MODEL", "LLM_MODEL",
    ):
        monkeypatch.delenv(key, raising=False)


def _adapter(tmp_path, **kwargs):
    proj = tmp_path / "project"
    proj.mkdir(exist_ok=True)
    return KimiAdapter("ws1", "general", "tok", "agentA", "http://x",
                       working_dir=str(proj), **kwargs)


class TestDirectApiConfig:
    def test_moonshot_defaults_with_only_a_key(self, tmp_path, clean_env, monkeypatch):
        monkeypatch.setenv("KIMI_API_KEY", "sk-test")
        a = _adapter(tmp_path)
        assert a._direct_mode is True
        assert a._direct_base_url == "https://api.moonshot.ai/v1"
        assert a._direct_model == DEFAULT_KIMI_MODEL

    def test_moonshot_api_key_alias(self, tmp_path, clean_env, monkeypatch):
        monkeypatch.setenv("MOONSHOT_API_KEY", "sk-alias")
        assert _adapter(tmp_path)._direct_api_key == "sk-alias"

    def test_base_url_and_model_overrides(self, tmp_path, clean_env, monkeypatch):
        monkeypatch.setenv("KIMI_API_KEY", "sk-test")
        monkeypatch.setenv("KIMI_BASE_URL", "https://relay.example.com/v1/")
        monkeypatch.setenv("KIMI_MODEL", "kimi-k3")
        a = _adapter(tmp_path)
        assert a._direct_base_url == "https://relay.example.com/v1"
        assert a._direct_model == "kimi-k3"

    def test_no_key_means_no_direct_mode(self, tmp_path, clean_env):
        assert _adapter(tmp_path)._direct_mode is False


# ---------------------------------------------------------------------------
# Adapter: CLI vs direct routing
# ---------------------------------------------------------------------------


class TestCliRouting:
    @_aiorun
    async def test_asks_to_install_when_neither_cli_nor_key_exists(
        self, tmp_path, clean_env, monkeypatch
    ):
        monkeypatch.setattr(kimi_mod, "find_kimi_binary", lambda: None)
        a = _adapter(tmp_path)
        errors = []
        a._send_error = lambda ch, text: _record(errors, text)
        await a._handle_message({"content": "hello", "sessionId": "thread"})
        assert len(errors) == 1
        assert "@moonshot-ai/kimi-code" in errors[0]

    @_aiorun
    async def test_rejects_the_legacy_python_cli_with_no_fallback(
        self, tmp_path, clean_env, monkeypatch
    ):
        monkeypatch.setattr(kimi_mod, "find_kimi_binary", lambda: "/fake/kimi")
        a = _adapter(tmp_path)
        a._check_version = lambda _bin: classify_kimi_version("kimi-cli 1.44.0")
        errors = []
        a._send_error = lambda ch, text: _record(errors, text)
        await a._handle_message({"content": "hello", "sessionId": "thread"})
        assert len(errors) == 1
        assert "legacy Python kimi-cli (1.44.0)" in errors[0]
        assert "@moonshot-ai/kimi-code" in errors[0]

    @_aiorun
    async def test_falls_back_to_direct_api_when_cli_is_missing_but_key_is_set(
        self, tmp_path, clean_env, monkeypatch
    ):
        monkeypatch.setenv("KIMI_API_KEY", "sk-test")
        monkeypatch.setattr(kimi_mod, "find_kimi_binary", lambda: None)
        a = _adapter(tmp_path)
        seen = []

        async def fake_direct(msg):
            seen.append(msg["content"])

        # Reaching the inherited direct path IS the assertion.
        monkeypatch.setattr(
            kimi_mod.LlmDirectAdapter, "_handle_message",
            lambda _self, msg: fake_direct(msg),
        )
        await a._handle_message({"content": "hello", "sessionId": "thread"})
        assert seen == ["hello"]

    @_aiorun
    async def test_legacy_cli_also_falls_back_when_a_key_exists(
        self, tmp_path, clean_env, monkeypatch
    ):
        monkeypatch.setenv("KIMI_API_KEY", "sk-test")
        monkeypatch.setattr(kimi_mod, "find_kimi_binary", lambda: "/fake/kimi")
        a = _adapter(tmp_path)
        a._check_version = lambda _bin: classify_kimi_version("kimi-cli 1.44.0")
        seen = []

        async def fake_direct(msg):
            seen.append(msg["content"])

        monkeypatch.setattr(
            kimi_mod.LlmDirectAdapter, "_handle_message",
            lambda _self, msg: fake_direct(msg),
        )
        await a._handle_message({"content": "hello", "sessionId": "thread"})
        assert seen == ["hello"]


def _record(bucket, text):
    bucket.append(text)

    async def _noop():
        return None

    return _noop()


# ---------------------------------------------------------------------------
# Adapter: sessions
# ---------------------------------------------------------------------------


class TestSessions:
    def test_resumes_only_within_the_same_working_dir(self, tmp_path, clean_env, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        a = _adapter(tmp_path)
        a._channel_sessions["thread"] = {"session_id": "s1", "working_dir": "/proj/a"}
        assert a._resumable_session("thread", "/proj/a") == "s1"
        # A session carries the project it started in — crossing projects would
        # hand the model a history that does not describe the files it sees.
        assert a._resumable_session("thread", "/proj/b") is None
        assert a._resumable_session("other", "/proj/a") is None

    def test_sessions_round_trip_through_disk(self, tmp_path, clean_env, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        a = _adapter(tmp_path)
        a._channel_sessions["thread"] = {"session_id": "s1", "working_dir": "/proj/a"}
        a._save_sessions()

        b = _adapter(tmp_path)
        assert b._resumable_session("thread", "/proj/a") == "s1"

    def test_sessions_are_per_agent(self, tmp_path, clean_env, monkeypatch):
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        a = _adapter(tmp_path)
        a._channel_sessions["thread"] = {"session_id": "s1", "working_dir": "/proj/a"}
        a._save_sessions()

        other = KimiAdapter("ws1", "general", "tok", "agentB", "http://x",
                            working_dir=str(tmp_path / "project"))
        assert other._resumable_session("thread", "/proj/a") is None


# ---------------------------------------------------------------------------
# Adapter: an end-to-end run against a fake CLI
# ---------------------------------------------------------------------------


FAKE_CLI = """#!/bin/sh
cat <<'EOF'
{"role":"meta","type":"system.version","version":"0.39.1"}
{"role":"assistant","content":"looking","tool_calls":[{"function":{"name":"Read","arguments":"{\\"path\\":\\"a.txt\\"}"}}]}
{"role":"tool","tool_call_id":"1","content":"file body"}
{"role":"assistant","content":"all done"}
{"role":"meta","type":"session.resume_hint","session_id":"sess-42"}
EOF
exit 0
"""

FAILING_CLI = """#!/bin/sh
echo 'error: failed to run prompt: auth_error 401 unauthorized' >&2
exit 1
"""


def _install_fake_cli(tmp_path, body, monkeypatch):
    binary = tmp_path / "fake-kimi"
    binary.write_text(body)
    binary.chmod(binary.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setattr(kimi_mod, "find_kimi_binary", lambda: str(binary))
    return binary


class TestEndToEndRun:
    @_aiorun
    async def test_streams_a_turn_and_captures_the_session(
        self, tmp_path, clean_env, monkeypatch
    ):
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        _install_fake_cli(tmp_path, FAKE_CLI, monkeypatch)
        a = _adapter(tmp_path)
        a._check_version = lambda _bin: classify_kimi_version("kimi 0.39.1")

        statuses, responses, errors = [], [], []
        a._send_status = lambda ch, text: _record(statuses, text)
        a._send_response = lambda ch, text: _record(responses, text)
        a._send_error = lambda ch, text: _record(errors, text)
        a._auto_title_channel = lambda ch, text: _record([], text)

        await a._handle_message({"content": "hello", "sessionId": "thread"})

        assert errors == []
        # The LAST assistant text is the reply; earlier prose is interim status.
        assert responses == ["all done"]
        assert "Read: a.txt" in statuses
        assert "looking" in statuses
        # The session id arrives inline and must persist for the next turn.
        assert a._resumable_session("thread", str(tmp_path / "project")) == "sess-42"

    @_aiorun
    async def test_reports_a_classified_error_instead_of_raw_stderr(
        self, tmp_path, clean_env, monkeypatch
    ):
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        _install_fake_cli(tmp_path, FAILING_CLI, monkeypatch)
        a = _adapter(tmp_path)
        a._check_version = lambda _bin: classify_kimi_version("kimi 0.39.1")

        responses, errors = [], []
        a._send_status = lambda ch, text: _record([], text)
        a._send_response = lambda ch, text: _record(responses, text)
        a._send_error = lambda ch, text: _record(errors, text)
        a._auto_title_channel = lambda ch, text: _record([], text)

        await a._handle_message({"content": "hello", "sessionId": "thread"})

        assert responses == []
        assert len(errors) == 1
        assert "authentication failed" in errors[0]
        assert "kimi login" in errors[0]

    @_aiorun
    async def test_refuses_a_working_dir_that_does_not_exist(
        self, tmp_path, clean_env, monkeypatch
    ):
        monkeypatch.setenv("HOME", str(tmp_path / "home"))
        _install_fake_cli(tmp_path, FAKE_CLI, monkeypatch)
        a = KimiAdapter("ws1", "general", "tok", "agentA", "http://x",
                        working_dir=str(tmp_path / "nope"))
        a._check_version = lambda _bin: classify_kimi_version("kimi 0.39.1")
        errors = []
        a._send_error = lambda ch, text: _record(errors, text)

        await a._handle_message({"content": "hello", "sessionId": "thread"})

        assert len(errors) == 1
        assert "Working directory does not exist" in errors[0]
