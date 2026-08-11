"""
Tests for the clarification phase gate in the Python adapter stack.

The backend decides who may be woken while a channel's requirement is still
being clarified; these cover the adapter half — the directive an agent is
given and the per-message PLAN downgrade that stops a consulted builder from
starting work. Mirrors packages/agent-connector/test/phase-gate.test.js.
"""
import asyncio

import pytest

from openagents.adapters.base import BaseAdapter
from openagents.adapters.workspace_prompt import build_phase_gate_directive


class _Adapter(BaseAdapter):
    """Concrete adapter that records the mode each message ran under."""

    def __init__(self, agent_name="rd"):
        super().__init__(
            workspace_id="ws-1",
            channel_name="session-1",
            token="t",
            agent_name=agent_name,
            endpoint="https://example.test",
        )
        self.seen_modes = []
        self.raise_on_handle = False

    async def _handle_message(self, msg: dict):
        if self.raise_on_handle:
            raise RuntimeError("boom")
        self.seen_modes.append(self._mode_for(msg.get("sessionId") or self.channel_name))


def _msg(metadata, content="build the sync module", channel="session-1"):
    return {
        "messageId": "m-1",
        "sessionId": channel,
        "senderType": "human",
        "senderName": "user",
        "content": content,
        "metadata": metadata,
    }


CLARIFYING = {"phase": "clarifying", "phase_owner": "pm", "target_modes": {"rd": "plan"}}


class TestPhaseGateDirective:
    def test_no_role_emits_nothing(self):
        assert build_phase_gate_directive(None) == ""
        assert build_phase_gate_directive("") == ""

    def test_plan_role_forbids_building(self):
        out = build_phase_gate_directive("plan", owner="pm")
        assert "PLAN mode" in out
        assert "Do NOT start the work" in out
        assert "pm" in out

    def test_owner_role_explains_how_to_advance(self):
        out = build_phase_gate_directive(
            "owner", owner="pm",
            endpoint="https://example.test/",
            workspace_id="ws-1",
            channel_name="session-1",
        )
        assert "workspace_set_phase" in out
        assert 'phase="building"' in out
        # A trailing slash on the endpoint must not double up in the URL.
        assert "https://example.test/v1/workspaces/ws-1/channels/session-1" in out

    def test_owner_role_without_endpoint_omits_rest_fallback(self):
        out = build_phase_gate_directive("owner", owner="pm")
        assert "workspace_set_phase" in out
        assert "PATCH" not in out

    def test_member_role_states_the_phase_only(self):
        out = build_phase_gate_directive("member", owner="pm")
        assert "still being clarified" in out
        assert "PLAN mode" not in out


class TestPhaseRole:
    def test_none_when_not_clarifying(self):
        a = _Adapter()
        assert a._phase_role(_msg({})) is None
        assert a._phase_role(_msg({"phase": "building", "phase_owner": "pm"})) is None

    def test_plan_for_the_gated_agent(self):
        assert _Adapter("rd")._phase_role(_msg(CLARIFYING)) == "plan"

    def test_owner_for_the_phase_owner(self):
        a = _Adapter("pm")
        assert a._phase_role(_msg({"phase": "clarifying", "phase_owner": "pm"})) == "owner"

    def test_another_agents_gate_is_not_read_as_own(self):
        assert _Adapter("qa")._phase_role(_msg(CLARIFYING)) == "member"


class TestApplyPhaseGate:
    def test_ungated_message_untouched(self):
        a = _Adapter()
        msg = _msg({})
        assert a._apply_phase_gate(msg) is msg

    def test_directive_is_appended_not_prepended(self):
        gated = _Adapter("rd")._apply_phase_gate(_msg(CLARIFYING))
        assert gated["content"].startswith("build the sync module")
        assert "Do NOT start the work" in gated["content"]

    def test_original_message_not_mutated(self):
        msg = _msg(CLARIFYING)
        _Adapter("rd")._apply_phase_gate(msg)
        assert msg["content"] == "build the sync module"


class TestModeOverride:
    def test_defaults_to_agent_mode(self):
        assert _Adapter()._mode_for("session-1") == "execute"

    def test_gated_message_runs_in_plan_then_restores(self):
        a = _Adapter("rd")
        asyncio.run(a._run_message("session-1", _msg(CLARIFYING)))
        asyncio.run(a._run_message("session-1", _msg({})))
        assert a.seen_modes == ["plan", "execute"]
        assert a._mode_for("session-1") == "execute"

    def test_override_cleared_when_handler_raises(self):
        a = _Adapter("rd")
        a.raise_on_handle = True
        with pytest.raises(RuntimeError):
            asyncio.run(a._run_message("session-1", _msg(CLARIFYING)))
        assert a._mode_for("session-1") == "execute"

    def test_one_channels_gate_does_not_leak_into_another(self):
        a = _Adapter("rd")
        asyncio.run(a._run_message("session-1", _msg(CLARIFYING)))
        # session-2 never carried a gate.
        assert a._mode_for("session-2") == "execute"


class TestClaudeCommandEnforcement:
    """The directive is advice; the CLI flags are enforcement. These assert on
    the argv the adapter would actually spawn — mode bookkeeping alone cannot
    tell a working gate apart from a no-op."""

    def _adapter(self, tmp_path, monkeypatch):
        from openagents.adapters.claude import ClaudeAdapter

        # Contain the adapter's home-directory writes (session store, MCP
        # config) inside the test's tmp dir.
        monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
        monkeypatch.setattr(
            "openagents.adapters.claude.shutil.which",
            lambda name: f"/usr/bin/{name}",
        )
        return ClaudeAdapter(
            workspace_id="ws-1",
            channel_name="session-1",
            token="tok",
            agent_name="rd",
            working_dir=str(tmp_path),
        )

    def test_gated_channel_gets_plan_permissions(self, tmp_path, monkeypatch):
        adapter = self._adapter(tmp_path, monkeypatch)
        adapter._mode_overrides["session-1"] = "plan"

        cmd = adapter._build_claude_cmd("do the thing", "session-1")

        assert "--permission-mode" in cmd
        assert cmd[cmd.index("--permission-mode") + 1] == "plan"
        assert "--dangerously-skip-permissions" not in cmd
        assert "Write" not in cmd
        assert "Edit" not in cmd
        assert not any(a.endswith("workspace_write_file") for a in cmd)

    def test_ungated_channel_keeps_write_tools(self, tmp_path, monkeypatch):
        adapter = self._adapter(tmp_path, monkeypatch)

        cmd = adapter._build_claude_cmd("do the thing", "session-1")

        assert "--dangerously-skip-permissions" in cmd
        assert "Write" in cmd
        assert "--permission-mode" not in cmd

    def test_override_is_scoped_to_the_gated_channel(self, tmp_path, monkeypatch):
        adapter = self._adapter(tmp_path, monkeypatch)
        adapter._mode_overrides["session-1"] = "plan"

        cmd = adapter._build_claude_cmd("do the thing", "session-2")

        assert "--dangerously-skip-permissions" in cmd
        assert "Write" in cmd

    def test_gated_channel_gets_plan_system_prompt(self, tmp_path, monkeypatch):
        adapter = self._adapter(tmp_path, monkeypatch)
        adapter._mode_overrides["session-1"] = "plan"

        cmd = adapter._build_claude_cmd("do the thing", "session-1")
        system_prompt = cmd[cmd.index("--append-system-prompt") + 1]

        assert "You are in PLAN mode" in system_prompt
        assert "Do not make edits" in system_prompt
