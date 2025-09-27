"""
Test cases for MCP tool integration with custom servers.

This module tests the integration between OpenAgents and custom MCP servers,
including configuration validation and FastMCP server creation.
"""

import pytest

from openagents.models.agent_config import AgentConfig
from openagents.models.mcp_config import MCPServerConfig


class TestMCPToolIntegration:
    """Test cases for MCP tool integration with custom servers."""

    def test_mcp_server_config_validation(self):
        """Test that MCP server configuration validates correctly."""
        # Test valid streamable_http configuration
        config = MCPServerConfig(
            name="calc_server",
            type="streamable_http",
            url="http://localhost:8000/mcp",
            timeout=30
        )
        
        assert config.name == "calc_server"
        assert config.type == "streamable_http"
        assert config.url == "http://localhost:8000/mcp"
        assert config.timeout == 30

    def test_agent_config_with_mcp_server(self):
        """Test that an agent can be configured with MCP servers."""
        calc_server_config = MCPServerConfig(
            name="calc_server",
            type="streamable_http",
            url="http://localhost:8000/mcp",
            timeout=30
        )
        
        agent_config = AgentConfig(
            instruction="Test agent with calculation MCP server",
            model_name="gpt-4o-mini",
            mcps=[calc_server_config]
        )
        
        assert len(agent_config.mcps) == 1
        assert agent_config.mcps[0].name == "calc_server"
        assert agent_config.mcps[0].type == "streamable_http"

    def test_multiple_mcp_servers_config(self):
        """Test configuration with multiple MCP servers."""
        calc_config = MCPServerConfig(
            name="calc_server",
            type="streamable_http", 
            url="http://localhost:8000/mcp"
        )
        
        search_config = MCPServerConfig(
            name="search_server",
            type="sse",
            url="http://localhost:8001/sse"
        )
        
        agent_config = AgentConfig(
            instruction="Multi-tool agent",
            model_name="gpt-4o-mini",
            mcps=[calc_config, search_config]
        )
        
        assert len(agent_config.mcps) == 2
        server_names = [mcp.name for mcp in agent_config.mcps]
        assert "calc_server" in server_names
        assert "search_server" in server_names

    def test_fastmcp_server_creation(self):
        """Test that we can create a FastMCP server programmatically (without running it)."""
        try:
            from mcp.server.fastmcp import FastMCP
        except ImportError:
            pytest.skip("FastMCP not available")
        
        # Create a FastMCP app (similar to the example)
        app = FastMCP(name="TestCalcServer")
        
        # Verify app was created
        assert app.name == "TestCalcServer"
        
        # Define a tool (without the decorator for testing)
        def calculate(a: float, b: float, op: str = "add") -> float:
            """Perform a simple calculation on two numbers."""
            if op == "add":
                return a + b
            elif op == "sub":
                return a - b
            elif op == "mul":
                return a * b
            elif op == "div":
                if b == 0:
                    raise ValueError("Division by zero is not allowed")
                return a / b
            else:
                raise ValueError(f"Unsupported operation: {op}")
        
        # Test the function directly
        assert calculate(10, 5, "add") == 15.0
        assert calculate(10, 5, "sub") == 5.0
        assert calculate(10, 5, "mul") == 50.0
        assert calculate(10, 5, "div") == 2.0
        
        # Test error conditions
        with pytest.raises(ValueError, match="Division by zero"):
            calculate(10, 0, "div")
        
        with pytest.raises(ValueError, match="Unsupported operation"):
            calculate(10, 5, "invalid")