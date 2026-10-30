"""
Tests for the `browser_enabled` directive in workspace prompt builders.

The whole point of the directive is to force agents away from
`mcp__browsermcp__*` (and other local-browser MCP servers) when the
workspace has the Browser Fabric viewer toggle on. These tests pin the
shape of that contract.
"""
import pytest

from openagents.adapters.workspace_prompt import (
    build_browser_directive,
    build_claude_system_prompt,
    build_openclaw_system_prompt,
    build_opencode_system_prompt,
)


class TestBrowserDirective:
    def test_disabled_returns_empty(self):
        """browser_enabled=False emits nothing — no opinion injected."""
        assert build_browser_directive(False) == ""

    def test_enabled_contains_mandatory_header(self):
        out = build_browser_directive(True)
        assert "Browser Use (MANDATORY)" in out

    def test_enabled_names_workspace_browser_tools(self):
        out = build_browser_directive(True)
        # The agent has to know which tools to call instead.
        for tool in (
            "workspace_browser_open",
            "workspace_browser_navigate",
            "workspace_browser_click",
            "workspace_browser_snapshot",
        ):
            assert tool in out, f"missing tool name: {tool}"

    def test_enabled_explicitly_forbids_browsermcp(self):
        """The original failure mode: agent picks `mcp__browsermcp__*`."""
        out = build_browser_directive(True)
        assert "mcp__browsermcp__*" in out
        assert "FORBIDDEN" in out

    def test_enabled_forbids_other_local_browser_mcps(self):
        out = build_browser_directive(True)
        # Other common locally-installed browser MCPs that would race for
        # the same prompt — the directive must rule them out too.
        for forbidden in ("mcp__playwright__", "mcp__puppeteer__", "WebFetch"):
            assert forbidden in out, f"missing prohibition: {forbidden}"

    def test_enabled_handles_extension_isnt_connected_error(self):
        """If a local tool errors with 'extension isn't connected', the
        agent must switch rather than ask the user to connect anything."""
        out = build_browser_directive(True)
        assert "extension isn't connected" in out
        # And it must NOT ask the user — that was the bug in the screenshot.
        assert "do NOT ask the user" in out


class TestClaudeSystemPrompt:
    def test_default_no_directive(self):
        """Default (browser_enabled=False) keeps the v0.2 prompt shape."""
        prompt = build_claude_system_prompt(
            agent_name="agent-1",
            workspace_id="ws-1",
            channel_name="session-1",
        )
        assert "Browser Use (MANDATORY)" not in prompt
        assert "mcp__browsermcp__" not in prompt

    def test_enabled_injects_directive(self):
        prompt = build_claude_system_prompt(
            agent_name="agent-1",
            workspace_id="ws-1",
            channel_name="session-1",
            browser_enabled=True,
        )
        assert "Browser Use (MANDATORY)" in prompt
        assert "mcp__browsermcp__*" in prompt
        assert "workspace_browser_navigate" in prompt


class TestOpenclawSystemPrompt:
    def test_default_no_directive(self):
        prompt = build_openclaw_system_prompt(
            agent_name="agent-1",
            workspace_id="ws-1",
            channel_name="session-1",
            endpoint="https://api.example.com",
            token="tok",
        )
        assert "Browser Use (MANDATORY)" not in prompt

    def test_enabled_injects_directive(self):
        prompt = build_openclaw_system_prompt(
            agent_name="agent-1",
            workspace_id="ws-1",
            channel_name="session-1",
            endpoint="https://api.example.com",
            token="tok",
            browser_enabled=True,
        )
        assert "Browser Use (MANDATORY)" in prompt
        assert "mcp__browsermcp__*" in prompt


class TestOpencodeSystemPrompt:
    def test_default_no_directive(self):
        prompt = build_opencode_system_prompt(
            agent_name="agent-1",
            workspace_id="ws-1",
            channel_name="session-1",
            endpoint="https://api.example.com",
            token="tok",
        )
        assert "Browser Use (MANDATORY)" not in prompt

    def test_enabled_injects_directive(self):
        prompt = build_opencode_system_prompt(
            agent_name="agent-1",
            workspace_id="ws-1",
            channel_name="session-1",
            endpoint="https://api.example.com",
            token="tok",
            browser_enabled=True,
        )
        assert "Browser Use (MANDATORY)" in prompt
        assert "mcp__browsermcp__*" in prompt


@pytest.mark.parametrize('builder_name', ['build_api_skills_prompt', 'build_openclaw_skill_md', 'build_opencode_skill_md'])
def test_browser_instructions_preserve_tabs_between_tasks(builder_name):
    from openagents.adapters import workspace_prompt
    prompt = getattr(workspace_prompt, builder_name)(
        endpoint='https://api.example.com', workspace_id='ws-1', token='tok',
        agent_name='agent-1', channel_name='thread-1',
    )
    assert 'All cloud tabs are saved and reusable' in prompt
    assert 'stable tab ID' in prompt
    assert 'Close only when the user requests it' in prompt
    assert 'Step 3 — close tab' not in prompt
    assert 'auto-closed' not in prompt
    assert 'always close yours' not in prompt


def test_mandatory_browser_directive_preserves_tabs():
    prompt = build_browser_directive(True)
    assert 'All cloud tabs are saved and reusable' in prompt
    assert 'as soon as you are done' not in prompt
