"""
Platform workspace tools tests for OpenCode agent.

Tests that the MCP server exposes the shared workspace tools OpenCode uses.

Run:
    pytest tests/platform/workspace_tools/test_opencode.py -v
"""

import asyncio
import shutil

import pytest

from tests.platform.conftest import safe_print, agent_config


AGENT_TYPE = "opencode"
_cfg = agent_config(AGENT_TYPE)
BINARY_NAME = _cfg.get("binary", AGENT_TYPE)

CORE_TOOLS = {
    "workspace_get_history",
    "workspace_get_agents",
    "workspace_status",
}

FILE_TOOLS = {
    "workspace_write_file",
    "workspace_read_file",
    "workspace_list_files",
    "workspace_delete_file",
}


def _get_tools_from_server(server):
    from mcp import types as mcp_types

    handler = server.request_handlers[mcp_types.ListToolsRequest]
    req = mcp_types.ListToolsRequest(method="tools/list")
    result = asyncio.run(handler(req))
    return result.root.tools


@pytest.fixture()
def mcp_tools():
    from openagents.mcp_server import create_mcp_server

    server = create_mcp_server(
        workspace_id="test-workspace",
        channel_name="test-channel",
        token="test-token",
        agent_name="test-opencode",
    )

    tools = _get_tools_from_server(server)
    tool_names = {t.name for t in tools}
    return tool_names, tools


class TestOpenCodeWorkspaceTools:
    """Test workspace tool availability for OpenCode."""

    def test_agent_installed(self):
        assert shutil.which(BINARY_NAME) is not None

    def test_core_tools_available(self, mcp_tools):
        tool_names, _ = mcp_tools
        for tool in CORE_TOOLS:
            assert tool in tool_names, (
                f"Core tool '{tool}' not found. "
                f"Available: {sorted(tool_names)}"
            )

    def test_file_tools_available(self, mcp_tools):
        tool_names, _ = mcp_tools
        for tool in FILE_TOOLS:
            assert tool in tool_names, (
                f"File tool '{tool}' not found. "
                f"Available: {sorted(tool_names)}"
            )

    def test_tools_have_descriptions(self, mcp_tools):
        _, tools = mcp_tools
        for tool in tools:
            assert tool.description, f"Tool '{tool.name}' has no description"

    def test_total_tool_count(self, mcp_tools):
        tool_names, _ = mcp_tools
        assert len(tool_names) >= 15, (
            f"Only {len(tool_names)} tools registered, expected >= 15. "
            f"Tools: {sorted(tool_names)}"
        )


class TestOpenCodeWorkspaceToolsReport:
    """Collect environment info."""

    def test_report_environment(self, os_platform, openagents_version):
        safe_print(f"  platform: {os_platform}")
        safe_print(f"  openagents_version: {openagents_version}")
        safe_print(f"  agent_binary: {shutil.which(BINARY_NAME)}")
