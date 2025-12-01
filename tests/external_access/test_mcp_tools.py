"""
MCP Tools Integration Test.

This test verifies that the MCP transport correctly exposes tools from:
1. Workspace tools (@tool decorator in tools/*.py)
2. Event tools (x-agent-tool extension in events/*.yaml)
3. Network mods (get_tools() method)

It also tests tool filtering (exposed_tools/excluded_tools) and authentication.

Uses the official MCP Python package for client communication.

Note: The MCP client maintains an SSE (Server-Sent Events) connection for receiving
server messages. When pytest-asyncio tears down fixtures, this connection may be
cancelled abruptly, causing "ERROR" entries in test output. These are teardown
cleanup issues, not actual test failures. Tests that show "PASSED" are working correctly.
"""

import pytest
import asyncio
import random
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

# Official MCP package imports
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.types import TextContent

from openagents.core.network import AgentNetwork
from openagents.models.network_config import TransportConfigItem
from openagents.models.transport import TransportType


# Test configuration path
TEST_CONFIG_PATH = Path(__file__).parent.parent.parent / "examples" / "test_configs" / "mcp_tools_test"


@asynccontextmanager
async def create_mcp_client(url: str, auth_token: Optional[str] = None):
    """Create an MCP client session using the official MCP package.

    Args:
        url: Full URL to the MCP endpoint (e.g., "http://localhost:8880/mcp")
        auth_token: Optional bearer token for authentication

    Yields:
        ClientSession: Initialized MCP client session
    """
    import httpx

    headers = {}
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    # Track session for cleanup
    session_id = None
    http_client = httpx.AsyncClient()

    try:
        async with streamablehttp_client(url, headers=headers if headers else None) as (
            read_stream,
            write_stream,
            get_session_id,
        ):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                session_id = get_session_id()
                yield session
    except RuntimeError as e:
        # Suppress cancel scope errors from pytest-asyncio task switching during teardown
        if "cancel scope" not in str(e).lower():
            raise
    except ExceptionGroup as eg:
        # Suppress nested cancel scope errors in ExceptionGroups
        non_cancel_errors = []
        for exc in eg.exceptions:
            if isinstance(exc, RuntimeError) and "cancel scope" in str(exc).lower():
                continue
            non_cancel_errors.append(exc)
        if non_cancel_errors:
            raise ExceptionGroup(str(eg), non_cancel_errors)
    finally:
        # Explicitly terminate the session via DELETE request to clean up server-side
        if session_id:
            try:
                delete_headers = {"Mcp-Session-Id": session_id}
                if auth_token:
                    delete_headers["Authorization"] = f"Bearer {auth_token}"
                await http_client.delete(url, headers=delete_headers, timeout=2.0)
            except Exception:
                pass  # Best effort cleanup
        await http_client.aclose()


def get_tool_result_text(result) -> str:
    """Extract text content from a tool call result."""
    if result.content:
        for content in result.content:
            if isinstance(content, TextContent):
                return content.text
    return ""


@pytest.fixture(scope="function")
async def mcp_network():
    """Create and start a network with MCP transport for testing."""
    # Randomize ports to avoid conflicts
    http_port = random.randint(18000, 19000)
    mcp_port = http_port + 100

    # Load the network
    network = AgentNetwork.load(str(TEST_CONFIG_PATH / "network.yaml"))

    # Override ports for testing
    network.config.transports = [
        TransportConfigItem(type=TransportType.HTTP, config={"port": http_port}),
        TransportConfigItem(type=TransportType.MCP, config={"port": mcp_port, "endpoint": "/mcp"}),
    ]

    # Initialize network
    success = await network.initialize()
    assert success, "Network should initialize successfully"

    # Wait for MCP transport to be ready
    await asyncio.sleep(0.5)

    yield network, mcp_port

    # Cleanup - give extra time for connections to close
    await asyncio.sleep(0.1)
    try:
        await network.shutdown()
        await asyncio.sleep(0.2)
    except Exception as e:
        print(f"Error during network shutdown: {e}")


@pytest.fixture
async def mcp_session(mcp_network):
    """Create an MCP client session connected to the test network."""
    network, mcp_port = mcp_network
    mcp_url = f"http://localhost:{mcp_port}/mcp"

    async with create_mcp_client(mcp_url) as session:
        yield session, network


class TestMCPToolDiscovery:
    """Test MCP tool discovery from various sources."""

    @pytest.mark.asyncio
    async def test_discover_workspace_tools(self, mcp_session):
        """Test that workspace tools (@tool decorator) are discovered."""
        session, network = mcp_session

        result = await session.list_tools()
        tool_names = {t.name for t in result.tools}

        expected_workspace = {"add", "subtract", "multiply", "divide", "greet", "farewell", "get_current_time"}
        missing = expected_workspace - tool_names

        assert not missing, f"Missing workspace tools: {missing}"
        print(f"✅ Found all {len(expected_workspace)} workspace tools")

    @pytest.mark.asyncio
    async def test_discover_event_tools(self, mcp_session):
        """Test that event tools (x-agent-tool extension) are discovered."""
        session, network = mcp_session

        result = await session.list_tools()
        tool_names = {t.name for t in result.tools}

        expected_events = {"delegate_task", "report_status"}
        missing = expected_events - tool_names

        assert not missing, f"Missing event tools: {missing}"
        print(f"✅ Found all {len(expected_events)} event tools")

    @pytest.mark.asyncio
    async def test_discover_mod_tools(self, mcp_session):
        """Test that mod tools (get_tools() method) are discovered."""
        session, network = mcp_session

        result = await session.list_tools()
        tool_names = {t.name for t in result.tools}

        expected_mod_tools = {
            "list_project_templates",
            "start_project",
            "stop_project",
            "complete_project",
            "get_project",
            "send_project_message",
            "set_project_global_state",
            "get_project_global_state",
            "list_project_global_state",
            "delete_project_global_state",
            "set_project_agent_state",
            "get_project_agent_state",
            "list_project_agent_state",
            "delete_project_agent_state",
            "set_project_artifact",
            "get_project_artifact",
            "list_project_artifacts",
            "delete_project_artifact",
        }
        missing = expected_mod_tools - tool_names

        assert not missing, f"Missing project mod tools: {missing}"
        print(f"✅ Found all {len(expected_mod_tools)} project mod tools")

    @pytest.mark.asyncio
    async def test_total_tool_count(self, mcp_session):
        """Test that all 27 tools are discovered (7 workspace + 2 events + 18 mod)."""
        session, network = mcp_session

        result = await session.list_tools()
        assert len(result.tools) == 27, f"Expected 27 tools, got {len(result.tools)}"
        print(f"✅ Discovered all 27 tools")

    @pytest.mark.asyncio
    async def test_internal_operations_not_exposed(self, mcp_session):
        """Test that operations without x-agent-tool are NOT exposed."""
        session, network = mcp_session

        result = await session.list_tools()
        tool_names = {t.name for t in result.tools}

        # internalNotify operation doesn't have x-agent-tool, so should not be exposed
        assert "internalNotify" not in tool_names, "internalNotify should NOT be exposed"
        print("✅ Internal operations correctly hidden")


class TestMCPWorkspaceTools:
    """Test workspace tools execution via MCP."""

    @pytest.mark.asyncio
    async def test_add_tool(self, mcp_session):
        """Test the add workspace tool."""
        session, network = mcp_session

        result = await session.call_tool("add", {"a": 2, "b": 3})
        content = get_tool_result_text(result)

        assert "5" in content, f"add(2, 3) should return 5, got {content}"
        print(f"✅ add(2, 3) = {content}")

    @pytest.mark.asyncio
    async def test_subtract_tool(self, mcp_session):
        """Test the subtract workspace tool."""
        session, network = mcp_session

        result = await session.call_tool("subtract", {"a": 10, "b": 4})
        content = get_tool_result_text(result)

        assert "6" in content, f"subtract(10, 4) should return 6, got {content}"
        print(f"✅ subtract(10, 4) = {content}")

    @pytest.mark.asyncio
    async def test_multiply_tool(self, mcp_session):
        """Test the multiply workspace tool."""
        session, network = mcp_session

        result = await session.call_tool("multiply", {"a": 6, "b": 7})
        content = get_tool_result_text(result)

        assert "42" in content, f"multiply(6, 7) should return 42, got {content}"
        print(f"✅ multiply(6, 7) = {content}")

    @pytest.mark.asyncio
    async def test_divide_tool(self, mcp_session):
        """Test the divide workspace tool."""
        session, network = mcp_session

        result = await session.call_tool("divide", {"a": 15, "b": 3})
        content = get_tool_result_text(result)

        assert "5" in content, f"divide(15, 3) should return 5, got {content}"
        print(f"✅ divide(15, 3) = {content}")

    @pytest.mark.asyncio
    async def test_divide_by_zero_error(self, mcp_session):
        """Test that divide by zero returns an error."""
        session, network = mcp_session

        result = await session.call_tool("divide", {"a": 1, "b": 0})

        assert result.isError, "divide(1, 0) should return an error"
        print("✅ divide(1, 0) correctly returned error")

    @pytest.mark.asyncio
    async def test_greet_tool(self, mcp_session):
        """Test the greet workspace tool."""
        session, network = mcp_session

        result = await session.call_tool("greet", {"name": "World"})
        content = get_tool_result_text(result)

        assert "Hello, World!" in content, f"greet('World') should return 'Hello, World!', got {content}"
        print(f"✅ greet('World') = {content}")

    @pytest.mark.asyncio
    async def test_greet_with_custom_greeting(self, mcp_session):
        """Test the greet tool with custom greeting parameter."""
        session, network = mcp_session

        result = await session.call_tool("greet", {"name": "Claude", "greeting": "Hi"})
        content = get_tool_result_text(result)

        assert "Hi, Claude!" in content, f"greet('Claude', greeting='Hi') should return 'Hi, Claude!', got {content}"
        print(f"✅ greet('Claude', greeting='Hi') = {content}")

    @pytest.mark.asyncio
    async def test_farewell_tool(self, mcp_session):
        """Test the farewell workspace tool."""
        session, network = mcp_session

        result = await session.call_tool("farewell", {"name": "Alice"})
        content = get_tool_result_text(result)

        assert "Goodbye, Alice!" in content, f"farewell('Alice') should contain 'Goodbye, Alice!', got {content}"
        print(f"✅ farewell('Alice') = {content}")

    @pytest.mark.asyncio
    async def test_get_current_time_sync_tool(self, mcp_session):
        """Test the get_current_time sync workspace tool."""
        session, network = mcp_session

        result = await session.call_tool("get_current_time", {})
        content = get_tool_result_text(result)

        # Time format should contain colons like "12:34:56"
        assert ":" in content, f"get_current_time() should return time with colons, got {content}"
        print(f"✅ get_current_time() = {content}")


class TestMCPEventTools:
    """Test event tools execution via MCP."""

    @pytest.mark.asyncio
    async def test_delegate_task_event_tool(self, mcp_session):
        """Test the delegate_task event tool."""
        session, network = mcp_session

        result = await session.call_tool(
            "delegate_task",
            {
                "task_id": "TEST-001",
                "task_type": "analyze",
                "instructions": "Analyze the test data",
                "priority": "high",
            },
        )
        content = get_tool_result_text(result)

        assert not result.isError, f"delegate_task should not error: {content}"
        assert "success" in content.lower(), f"delegate_task should indicate success: {content}"
        print(f"✅ delegate_task emitted event successfully")

    @pytest.mark.asyncio
    async def test_report_status_event_tool(self, mcp_session):
        """Test the report_status event tool."""
        session, network = mcp_session

        result = await session.call_tool(
            "report_status",
            {
                "task_id": "TEST-001",
                "status": "completed",
                "progress": 100,
                "message": "Task completed successfully",
            },
        )
        content = get_tool_result_text(result)

        assert not result.isError, f"report_status should not error: {content}"
        assert "success" in content.lower(), f"report_status should indicate success: {content}"
        print(f"✅ report_status emitted event successfully")


class TestMCPModTools:
    """Test mod tools execution via MCP."""

    @pytest.mark.asyncio
    async def test_list_project_templates(self, mcp_session):
        """Test the list_project_templates mod tool."""
        session, network = mcp_session

        result = await session.call_tool("list_project_templates", {})
        content = get_tool_result_text(result)

        assert not result.isError, f"list_project_templates should not error: {content}"
        # The test config has a test_project template
        assert "test_project" in content.lower(), f"Should list test_project template: {content}"
        print(f"✅ list_project_templates returned templates")

    @pytest.mark.asyncio
    async def test_start_project(self, mcp_session):
        """Test the start_project mod tool."""
        session, network = mcp_session

        result = await session.call_tool(
            "start_project",
            {
                "template_id": "test_project",
                "goal": "Test goal for MCP integration test",
            },
        )
        content = get_tool_result_text(result)

        assert not result.isError, f"start_project should not error: {content}"
        print(f"✅ start_project created project successfully")


class TestMCPToolFiltering:
    """Test MCP tool filtering with exposed_tools and excluded_tools."""

    @pytest.mark.asyncio
    async def test_whitelist_filtering(self, mcp_network):
        """Test that exposed_tools whitelist works correctly."""
        network, mcp_port = mcp_network
        mcp_url = f"http://localhost:{mcp_port}/mcp"

        # Save original settings - handle both dict and object access
        external_access = network.config.external_access
        is_dict = isinstance(external_access, dict)

        if is_dict:
            original_exposed = external_access.get("exposed_tools")
            original_excluded = external_access.get("excluded_tools")
        else:
            original_exposed = external_access.exposed_tools
            original_excluded = external_access.excluded_tools

        try:
            # Set whitelist
            if is_dict:
                external_access["exposed_tools"] = ["add", "greet"]
                external_access["excluded_tools"] = None
            else:
                external_access.exposed_tools = ["add", "greet"]
                external_access.excluded_tools = None

            async with create_mcp_client(mcp_url) as session:
                result = await session.list_tools()
                tool_names = {t.name for t in result.tools}

                assert tool_names == {"add", "greet"}, f"Whitelist should only expose add and greet, got {tool_names}"
                print(f"✅ Whitelist filtering working: {tool_names}")
        finally:
            # Restore original settings
            if is_dict:
                external_access["exposed_tools"] = original_exposed
                external_access["excluded_tools"] = original_excluded
            else:
                external_access.exposed_tools = original_exposed
                external_access.excluded_tools = original_excluded

    @pytest.mark.asyncio
    async def test_blacklist_filtering(self, mcp_network):
        """Test that excluded_tools blacklist works correctly."""
        network, mcp_port = mcp_network
        mcp_url = f"http://localhost:{mcp_port}/mcp"

        external_access = network.config.external_access
        is_dict = isinstance(external_access, dict)

        if is_dict:
            original_exposed = external_access.get("exposed_tools")
            original_excluded = external_access.get("excluded_tools")
        else:
            original_exposed = external_access.exposed_tools
            original_excluded = external_access.excluded_tools

        try:
            # Set blacklist
            if is_dict:
                external_access["exposed_tools"] = None
                external_access["excluded_tools"] = ["divide", "farewell"]
            else:
                external_access.exposed_tools = None
                external_access.excluded_tools = ["divide", "farewell"]

            async with create_mcp_client(mcp_url) as session:
                result = await session.list_tools()
                tool_names = {t.name for t in result.tools}

                assert "divide" not in tool_names, "divide should be excluded"
                assert "farewell" not in tool_names, "farewell should be excluded"
                assert "add" in tool_names, "add should still be present"
                print(f"✅ Blacklist filtering working: excluded divide and farewell")
        finally:
            if is_dict:
                external_access["exposed_tools"] = original_exposed
                external_access["excluded_tools"] = original_excluded
            else:
                external_access.exposed_tools = original_exposed
                external_access.excluded_tools = original_excluded

    @pytest.mark.asyncio
    async def test_combined_filtering(self, mcp_network):
        """Test combined whitelist + blacklist filtering."""
        network, mcp_port = mcp_network
        mcp_url = f"http://localhost:{mcp_port}/mcp"

        external_access = network.config.external_access
        is_dict = isinstance(external_access, dict)

        if is_dict:
            original_exposed = external_access.get("exposed_tools")
            original_excluded = external_access.get("excluded_tools")
        else:
            original_exposed = external_access.exposed_tools
            original_excluded = external_access.excluded_tools

        try:
            # Set both whitelist and blacklist
            if is_dict:
                external_access["exposed_tools"] = ["add", "subtract", "greet"]
                external_access["excluded_tools"] = ["subtract"]
            else:
                external_access.exposed_tools = ["add", "subtract", "greet"]
                external_access.excluded_tools = ["subtract"]

            async with create_mcp_client(mcp_url) as session:
                result = await session.list_tools()
                tool_names = {t.name for t in result.tools}

                # Whitelist first, then blacklist applied
                assert tool_names == {"add", "greet"}, f"Combined filter should result in add and greet, got {tool_names}"
                print(f"✅ Combined filtering working: {tool_names}")
        finally:
            if is_dict:
                external_access["exposed_tools"] = original_exposed
                external_access["excluded_tools"] = original_excluded
            else:
                external_access.exposed_tools = original_exposed
                external_access.excluded_tools = original_excluded


class TestMCPAuthentication:
    """Test MCP authentication when auth_token is configured."""

    @pytest.mark.asyncio
    async def test_no_auth_required_when_not_configured(self, mcp_network):
        """Test that access is allowed when no auth is configured."""
        network, mcp_port = mcp_network
        mcp_url = f"http://localhost:{mcp_port}/mcp"

        # No auth token configured in test network, should work without token
        async with create_mcp_client(mcp_url) as session:
            result = await session.list_tools()
            assert len(result.tools) > 0, "Should be able to list tools without auth"
            print("✅ Access allowed without auth (expected when not configured)")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])
