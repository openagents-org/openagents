"""
Tests for MCP (Model Context Protocol) integration with AgentRunner.

This module tests the loading and configuration of MCP servers with agents,
including stdio, HTTP, and OpenMCP integration.
"""

import os
import pytest
import tempfile
import yaml
from pathlib import Path
from unittest.mock import AsyncMock, patch
from pydantic import ValidationError

from openagents.models.agent_config import AgentConfig
from openagents.models.mcp_config import MCPServerConfig
from openagents.utils.agent_loader import load_agent_from_yaml
from openagents.agents.worker_agent import WorkerAgent


class TestMCPServerConfig:
    """Test MCPServerConfig model validation and creation."""
    
    def test_stdio_mcp_server_config_valid(self):
        """Test creating valid stdio MCP server configuration."""
        config = MCPServerConfig(
            name="filesystem",
            type="stdio",
            command=["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
            env={"HOME": "/tmp"},
            timeout=30,
            retry_attempts=3
        )
        
        assert config.name == "filesystem"
        assert config.type == "stdio"
        assert config.command == ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
        assert config.env == {"HOME": "/tmp"}
        assert config.timeout == 30
        assert config.retry_attempts == 3
    
    def test_http_mcp_server_config_valid(self):
        """Test creating valid HTTP MCP server configuration (OpenMCP)."""
        config = MCPServerConfig(
            name="openmcp_browser",
            type="streamable_http",
            url="http://localhost:9000",
            api_key_env="OPENMCP_API_KEY",
            timeout=60,
            retry_attempts=3
        )
        
        assert config.name == "openmcp_browser"
        assert config.type == "streamable_http"
        assert config.url == "http://localhost:9000"
        assert config.api_key_env == "OPENMCP_API_KEY"
    
    def test_sse_mcp_server_config_valid(self):
        """Test creating valid SSE MCP server configuration."""
        config = MCPServerConfig(
            name="web_search",
            type="sse",
            url="https://api.example.com/mcp",
            api_key_env="WEB_SEARCH_API_KEY",
            timeout=45
        )
        
        assert config.name == "web_search"
        assert config.type == "sse"
        assert config.url == "https://api.example.com/mcp"
        assert config.api_key_env == "WEB_SEARCH_API_KEY"
    
    def test_invalid_mcp_server_type(self):
        """Test that invalid MCP server types are rejected."""
        with pytest.raises(ValidationError, match="MCP server type must be one of"):
            MCPServerConfig(
                name="invalid",
                type="invalid_type",
                command=["echo", "test"]
            )
    
    def test_stdio_missing_command(self):
        """Test that stdio MCP servers require command."""
        with pytest.raises(ValidationError, match="command is required for stdio MCP servers"):
            MCPServerConfig(
                name="filesystem",
                type="stdio",
                url=None,
                command=None
            )
    
    def test_http_missing_url(self):
        """Test that HTTP MCP servers require URL."""
        with pytest.raises(ValidationError, match="url is required for streamable_http MCP servers"):
            MCPServerConfig(
                name="openmcp",
                type="streamable_http",
                url=None
            )
    
    def test_sse_missing_url(self):
        """Test that SSE MCP servers require URL."""
        with pytest.raises(ValidationError, match="url is required for sse MCP servers"):
            MCPServerConfig(
                name="web_search",
                type="sse",
                url=None
            )


class TestAgentConfigWithMCP:
    """Test AgentConfig with MCP server integration."""
    
    def test_agent_config_with_mcp_servers(self):
        """Test AgentConfig with multiple MCP servers."""
        mcp_configs = [
            MCPServerConfig(
                name="filesystem",
                type="stdio",
                command=["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
            ),
            MCPServerConfig(
                name="openmcp_browser",
                type="streamable_http",
                url="http://localhost:9000",
                            )
        ]
        
        config = AgentConfig(
            instruction="Test agent with MCP support",
            model_name="gpt-4o-mini",
            provider="openai",
            mcps=mcp_configs
        )
        
        assert len(config.mcps) == 2
        assert config.mcps[0].name == "filesystem"
        assert config.mcps[0].type == "stdio"
        assert config.mcps[1].name == "openmcp_browser"
        assert config.mcps[1].type == "streamable_http"
    
    def test_agent_config_without_mcp_servers(self):
        """Test AgentConfig without MCP servers (default behavior)."""
        config = AgentConfig(
            instruction="Test agent without MCP",
            model_name="gpt-4o-mini",
            provider="openai"
        )
        
        assert len(config.mcps) == 0
        assert isinstance(config.mcps, list)


class TestMCPYAMLLoading:
    """Test loading MCP configurations from YAML files."""
    
    @pytest.fixture
    def temp_yaml_file(self):
        """Create temporary YAML file for testing."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yield f.name
        # Cleanup after test
        os.unlink(f.name)
    
    def test_load_yaml_with_stdio_mcp(self, temp_yaml_file):
        """Test loading YAML configuration with stdio MCP server."""
        yaml_content = {
            "agent_id": "test_agent",
            "type": "openagents.agents.worker_agent.WorkerAgent",
            "config": {
                "instruction": "Test agent with stdio MCP",
                "model_name": "gpt-4o-mini",
                "provider": "openai"
            },
            "mcps": [
                {
                    "name": "filesystem",
                    "type": "stdio",
                    "command": ["echo", "test"],
                    "timeout": 30
                }
            ],
            "mods": [
                {
                    "name": "openagents.mods.workspace.messaging",
                    "enabled": True
                }
            ]
        }
        
        with open(temp_yaml_file, 'w') as f:
            yaml.dump(yaml_content, f)
        
        agent, _ = load_agent_from_yaml(temp_yaml_file)
        
        assert agent.client.agent_id == "test_agent"
        assert len(agent.agent_config.mcps) == 1
        assert agent.agent_config.mcps[0].name == "filesystem"
        assert agent.agent_config.mcps[0].type == "stdio"
        assert agent.agent_config.mcps[0].command == ["echo", "test"]
    
    def test_load_yaml_with_http_mcp(self, temp_yaml_file):
        """Test loading YAML configuration with HTTP MCP server."""
        yaml_content = {
            "agent_id": "openmcp_agent",
            "type": "openagents.agents.worker_agent.WorkerAgent",
            "config": {
                "instruction": "Test agent with OpenMCP",
                "model_name": "gpt-4o-mini",
                "provider": "openai"
            },
            "mcps": [
                {
                    "name": "openmcp_browser",
                    "type": "streamable_http",
                    "url": "http://localhost:9000",
                                        "api_key_env": "OPENMCP_API_KEY",
                    "timeout": 60
                }
            ],
            "mods": [
                {
                    "name": "openagents.mods.workspace.messaging",
                    "enabled": True
                }
            ]
        }
        
        with open(temp_yaml_file, 'w') as f:
            yaml.dump(yaml_content, f)
        
        agent, _ = load_agent_from_yaml(temp_yaml_file)
        
        assert agent.client.agent_id == "openmcp_agent"
        assert len(agent.agent_config.mcps) == 1
        mcp = agent.agent_config.mcps[0]
        assert mcp.name == "openmcp_browser"
        assert mcp.type == "streamable_http"
        assert mcp.url == "http://localhost:9000"
        assert mcp.api_key_env == "OPENMCP_API_KEY"
    
    def test_load_yaml_with_multiple_mcps(self, temp_yaml_file):
        """Test loading YAML configuration with multiple MCP servers."""
        yaml_content = {
            "agent_id": "multi_mcp_agent",
            "type": "openagents.agents.worker_agent.WorkerAgent",
            "config": {
                "instruction": "Test agent with multiple MCPs",
                "model_name": "gpt-4o-mini",
                "provider": "openai"
            },
            "mcps": [
                {
                    "name": "filesystem",
                    "type": "stdio",
                    "command": ["echo", "filesystem"]
                },
                {
                    "name": "openmcp_browser",
                    "type": "streamable_http",
                    "url": "http://localhost:9000",
                    "service": "browseruse"
                },
                {
                    "name": "web_search",
                    "type": "sse",
                    "url": "https://api.example.com/search"
                }
            ],
            "mods": [
                {
                    "name": "openagents.mods.workspace.messaging",
                    "enabled": True
                }
            ]
        }
        
        with open(temp_yaml_file, 'w') as f:
            yaml.dump(yaml_content, f)
        
        agent, _ = load_agent_from_yaml(temp_yaml_file)
        
        assert len(agent.agent_config.mcps) == 3
        
        # Check filesystem MCP
        filesystem_mcp = next(mcp for mcp in agent.agent_config.mcps if mcp.name == "filesystem")
        assert filesystem_mcp.type == "stdio"
        assert filesystem_mcp.command == ["echo", "filesystem"]
        
        # Check OpenMCP browser
        browser_mcp = next(mcp for mcp in agent.agent_config.mcps if mcp.name == "openmcp_browser")
        assert browser_mcp.type == "streamable_http"
        assert browser_mcp.url == "http://localhost:9000"
        
        # Check web search
        search_mcp = next(mcp for mcp in agent.agent_config.mcps if mcp.name == "web_search")
        assert search_mcp.type == "sse"
        assert search_mcp.url == "https://api.example.com/search"
    
    def test_load_yaml_without_mcps(self, temp_yaml_file):
        """Test loading YAML configuration without MCP servers."""
        yaml_content = {
            "agent_id": "no_mcp_agent",
            "type": "openagents.agents.worker_agent.WorkerAgent",
            "config": {
                "instruction": "Test agent without MCP",
                "model_name": "gpt-4o-mini",
                "provider": "openai"
            },
            "mods": [
                {
                    "name": "openagents.mods.workspace.messaging",
                    "enabled": True
                }
            ]
        }
        
        with open(temp_yaml_file, 'w') as f:
            yaml.dump(yaml_content, f)
        
        agent, _ = load_agent_from_yaml(temp_yaml_file)
        
        assert agent.client.agent_id == "no_mcp_agent"
        assert len(agent.agent_config.mcps) == 0
    
    def test_invalid_mcp_config_in_yaml(self, temp_yaml_file):
        """Test that invalid MCP configuration in YAML raises error."""
        yaml_content = {
            "agent_id": "invalid_mcp_agent",
            "type": "openagents.agents.worker_agent.WorkerAgent",
            "config": {
                "instruction": "Test agent with invalid MCP",
                "model_name": "gpt-4o-mini",
                "provider": "openai"
            },
            "mcps": [
                {
                    "name": "invalid_mcp",
                    "type": "invalid_type"  # Invalid type
                }
            ]
        }
        
        with open(temp_yaml_file, 'w') as f:
            yaml.dump(yaml_content, f)
        
        with pytest.raises(ValueError, match="Invalid MCP configuration"):
            load_agent_from_yaml(temp_yaml_file)


class TestMCPAgentRunnerIntegration:
    """Test MCP integration with AgentRunner."""
    
    @pytest.mark.asyncio
    async def test_agent_runner_mcp_setup_stdio(self):
        """Test AgentRunner MCP setup with stdio MCP server."""
        mcp_config = MCPServerConfig(
            name="test_stdio",
            type="stdio",
            command=["echo", "test"],
            timeout=10
        )
        
        agent_config = AgentConfig(
            instruction="Test MCP agent",
            model_name="gpt-4o-mini",
            mcps=[mcp_config]
        )
        
        # Create a mock agent runner
        agent = WorkerAgent(
            agent_id="test_mcp_agent",
            agent_config=agent_config,
            mod_names=["openagents.mods.workspace.messaging"]
        )
        
        # Mock the MCP client functions to avoid actual connections
        with patch('openagents.utils.mcp_connector.stdio_client') as mock_stdio_client, \
             patch('openagents.utils.mcp_connector.ClientSession') as mock_session_class:
            
            # Create mock transport and session
            mock_transport = AsyncMock()
            mock_session = AsyncMock()
            mock_session.list_tools.return_value = [
                {"name": "test_tool", "description": "Test tool"}
            ]
            mock_session.call_tool.return_value = {"result": "test"}
            
            mock_stdio_client.return_value.__aenter__.return_value = mock_transport
            mock_session_class.return_value = mock_session
            
            # Setup agent (this should setup MCP clients)
            await agent.setup()
            
            # Verify MCP client was attempted to be created
            mock_stdio_client.assert_called_once()
            
            # Cleanup
            await agent.teardown()
    
    @pytest.mark.asyncio
    async def test_agent_runner_mcp_setup_streamable_http(self):
        """Test AgentRunner MCP setup with streamable HTTP MCP server."""
        mcp_config = MCPServerConfig(
            name="test_http",
            type="streamable_http",
            url="http://localhost:9000",
            timeout=30
        )
        
        agent_config = AgentConfig(
            instruction="Test HTTP MCP agent",
            model_name="gpt-4o-mini",
            mcps=[mcp_config]
        )
        
        agent = WorkerAgent(
            agent_id="test_http_mcp_agent",
            agent_config=agent_config,
            mod_names=["openagents.mods.workspace.messaging"]
        )
        
        # Mock the streamable HTTP client
        with patch('openagents.utils.mcp_connector.streamablehttp_client') as mock_http_client, \
             patch('openagents.utils.mcp_connector.ClientSession') as mock_session_class:
            
            # Create mock transport and session
            mock_transport = AsyncMock()
            mock_session = AsyncMock()
            mock_session.list_tools.return_value = [
                {"name": "web_tool", "description": "Web automation tool"}
            ]
            mock_session.call_tool.return_value = {"result": "success"}
            
            mock_http_client.return_value.__aenter__.return_value = mock_transport
            mock_session_class.return_value = mock_session
            
            # Setup agent
            await agent.setup()
            
            # Verify HTTP client was attempted to be created
            mock_http_client.assert_called_once()
            
            # Cleanup
            await agent.teardown()
    
    @pytest.mark.asyncio
    async def test_agent_runner_mcp_sse_setup(self):
        """Test AgentRunner MCP setup with SSE MCP server."""
        mcp_config = MCPServerConfig(
            name="test_sse",
            type="sse",
            url="http://localhost:8001/sse",
            timeout=30
        )
        
        agent_config = AgentConfig(
            instruction="Test SSE MCP agent",
            model_name="gpt-4o-mini",
            mcps=[mcp_config]
        )
        
        agent = WorkerAgent(
            agent_id="test_sse_agent",
            agent_config=agent_config,
            mod_names=["openagents.mods.workspace.messaging"]
        )
        
        # Mock the SSE client
        with patch('openagents.utils.mcp_connector.sse_client') as mock_sse_client, \
             patch('openagents.utils.mcp_connector.ClientSession') as mock_session_class:
            
            # Create mock transport and session
            mock_transport = AsyncMock()
            mock_session = AsyncMock()
            mock_session.list_tools.return_value = [
                {"name": "sse_tool", "description": "SSE tool"}
            ]
            
            mock_sse_client.return_value.__aenter__.return_value = mock_transport
            mock_session_class.return_value = mock_session
            
            # Setup agent
            await agent.setup()
            
            # Verify SSE client was attempted to be created
            mock_sse_client.assert_called_once()
            
            # Cleanup
            await agent.teardown()


class TestMCPExampleConfigurations:
    """Test the example MCP configurations provided."""
    
    def test_load_openmcp_example_config(self):
        """Test loading the OpenMCP example configuration."""
        config_path = "examples/openmcp_agent_config_example.yaml"
        
        if Path(config_path).exists():
            agent, _ = load_agent_from_yaml(config_path)
            
            assert agent.client.agent_id == "web_automation_assistant"
            assert len(agent.agent_config.mcps) == 1
            
            mcp = agent.agent_config.mcps[0]
            assert mcp.name == "openmcp_browser"
            assert mcp.type == "streamable_http"
            assert mcp.url == "http://localhost:9000/mcp"
                
    def test_load_worker_agent_example_config(self):
        """Test loading the worker agent example configuration with MCP."""
        config_path = "examples/worker_agent_config_example.yaml"
        
        if Path(config_path).exists():
            agent, _ = load_agent_from_yaml(config_path)
            
            assert agent.client.agent_id == "helpful_assistant"
            assert len(agent.agent_config.mcps) >= 1  # Should have MCP servers
            
            # Check that at least one MCP server is configured
            mcp_names = [mcp.name for mcp in agent.agent_config.mcps]
            assert len(mcp_names) > 0


if __name__ == "__main__":
    # Run tests with pytest
    pytest.main([__file__, "-v"])