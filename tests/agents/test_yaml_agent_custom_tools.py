"""
Test cases for YAML agent custom tool loading and usage.

This module tests the OpenAgents extension that allows agents to load
custom tools directly from YAML configuration files.
"""

import os
import sys
import asyncio
import pytest
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

# Add src to Python path
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "src"))

from openagents.utils.agent_loader import load_agent_from_yaml
from openagents.models.agent_config import AgentConfig
from openagents.models.tool_config import AgentToolConfig
from openagents.models.event_context import EventContext
from openagents.models.event import Event
from openagents.models.event_thread import EventThread


class TestYAMLAgentCustomTools:
    """Test cases for YAML agent custom tool functionality."""

    @pytest.fixture
    def test_agent_yaml_path(self):
        """Path to test agent YAML configuration."""
        return "examples/test_agents/test_agent_with_tools.yaml"

    @pytest.fixture
    def original_cwd(self):
        """Store and restore original working directory."""
        original = os.getcwd()
        yield original
        os.chdir(original)

    def setup_test_environment(self):
        """Setup test environment with proper path handling."""
        original_cwd = os.getcwd()
        test_agents_dir = Path("examples/test_agents").resolve()
        os.chdir(test_agents_dir)
        
        # Add test_agents directory to sys.path temporarily
        if str(test_agents_dir) not in sys.path:
            sys.path.insert(0, str(test_agents_dir))
            path_added = True
        else:
            path_added = False
            
        return original_cwd, test_agents_dir, path_added
    
    def cleanup_test_environment(self, original_cwd, test_agents_dir, path_added):
        """Cleanup test environment."""
        os.chdir(original_cwd)
        if path_added:
            sys.path.remove(str(test_agents_dir))

    def test_tool_config_creation(self):
        """Test creating AgentToolConfig and loading functions."""
        original_cwd, test_agents_dir, path_added = self.setup_test_environment()
        
        try:
            # Create tool config
            tool_config = AgentToolConfig(
                name="add_numbers",
                description="Add two numbers together",
                implementation="test_tools.add_numbers"
            )
            
            # Test function loading
            func = tool_config.load_function()
            assert callable(func)
            
            # Test function execution
            result = func(2, 3)
            assert result == 5
            
            # Test AgentTool creation
            agent_tool = tool_config.create_agent_tool()
            assert agent_tool.name == "add_numbers"
            assert agent_tool.description == "Add two numbers together"
            assert callable(agent_tool.func)
            
            # Verify auto-generated schema
            schema = agent_tool.input_schema
            assert schema["type"] == "object"
            assert "a" in schema["properties"]
            assert "b" in schema["properties"]
            assert schema["properties"]["a"]["type"] == "integer"
            assert schema["properties"]["b"]["type"] == "integer"
            assert set(schema["required"]) == {"a", "b"}
            
        finally:
            self.cleanup_test_environment(original_cwd, test_agents_dir, path_added)

    def test_agent_config_with_custom_tools(self):
        """Test creating AgentConfig with custom tools."""
        # Change to examples/test_agents directory for imports
        original_cwd = os.getcwd()
        os.chdir("examples/test_agents")
        
        try:
            # Create tool configs
            add_tool = AgentToolConfig(
                name="add_numbers",
                description="Add two numbers together",
                implementation="test_tools.add_numbers"
            )
            
            greet_tool = AgentToolConfig(
                name="greet_user",
                description="Greet a user with a custom greeting",
                implementation="test_tools.greet_user"
            )
            
            # Create AgentConfig with tools
            agent_config = AgentConfig(
                instruction="You are a helpful test assistant.",
                model_name="gpt-4o-mini",
                provider="openai",
                tools=[add_tool, greet_tool]
            )
            
            assert len(agent_config.tools) == 2
            assert agent_config.tools[0].name == "add_numbers"
            assert agent_config.tools[1].name == "greet_user"
            
        finally:
            os.chdir(original_cwd)

    def test_load_yaml_agent_with_tools(self, test_agent_yaml_path, original_cwd):
        """Test loading agent from YAML with custom tools."""
        if not Path(test_agent_yaml_path).exists():
            pytest.skip(f"Test agent YAML not found: {test_agent_yaml_path}")
        
        # Change to examples/test_agents directory for tool imports
        os.chdir("examples/test_agents")
        
        try:
            # Load agent from YAML
            agent, connection = load_agent_from_yaml("test_agent_with_tools.yaml")
            
            # Verify agent was created
            assert agent is not None
            assert agent.agent_id == "test-agent-with-tools"
            
            # Verify agent config has tools
            assert agent._agent_config is not None
            assert len(agent._agent_config.tools) == 3
            
            # Verify tools are loaded in agent
            assert len(agent._tools) >= 3  # Custom tools + mod tools
            
            # Check that custom tools are present
            tool_names = [tool.name for tool in agent._tools]
            assert "add_numbers" in tool_names
            assert "greet_user" in tool_names
            assert "process_text" in tool_names
            
            # Verify tool functionality
            add_tool = next(tool for tool in agent._tools if tool.name == "add_numbers")
            assert add_tool.func(5, 7) == 12
            
            greet_tool = next(tool for tool in agent._tools if tool.name == "greet_user")
            assert greet_tool.func("Alice") == "Hello, Alice!"
            
        finally:
            os.chdir(original_cwd)

    def test_tool_schema_generation(self):
        """Test automatic schema generation from function signatures."""
        original_cwd = os.getcwd()
        os.chdir("examples/test_agents")
        
        try:
            # Test tool with optional parameter
            tool_config = AgentToolConfig(
                name="greet_user",
                description="Greet a user",
                implementation="test_tools.greet_user"
            )
            
            agent_tool = tool_config.create_agent_tool()
            schema = agent_tool.input_schema
            
            # Verify schema structure
            assert schema["type"] == "object"
            assert "name" in schema["properties"]
            assert "greeting" in schema["properties"]
            assert schema["properties"]["name"]["type"] == "string"
            assert schema["properties"]["greeting"]["type"] == "string"
            
            # Verify required parameters (only 'name' is required, 'greeting' has default)
            assert schema["required"] == ["name"]
            
        finally:
            os.chdir(original_cwd)

    def test_tool_openai_format_conversion(self):
        """Test conversion of tools to OpenAI function format."""
        original_cwd = os.getcwd()
        os.chdir("examples/test_agents")
        
        try:
            tool_config = AgentToolConfig(
                name="add_numbers",
                description="Add two numbers together",
                implementation="test_tools.add_numbers"
            )
            
            agent_tool = tool_config.create_agent_tool()
            openai_format = agent_tool.to_openai_function()
            
            # Verify OpenAI function format
            assert openai_format["name"] == "add_numbers"
            assert openai_format["description"] == "Add two numbers together"
            assert "parameters" in openai_format
            assert openai_format["parameters"]["type"] == "object"
            assert "a" in openai_format["parameters"]["properties"]
            assert "b" in openai_format["parameters"]["properties"]
            
        finally:
            os.chdir(original_cwd)

    @pytest.mark.asyncio
    async def test_agent_tool_execution(self, original_cwd):
        """Test that agent tools can be executed asynchronously."""
        os.chdir("examples/test_agents")
        
        try:
            tool_config = AgentToolConfig(
                name="process_text",
                description="Process text with operations",
                implementation="test_tools.process_text"
            )
            
            agent_tool = tool_config.create_agent_tool()
            
            # Test async execution
            result = await agent_tool.execute(text="hello", operation="upper")
            assert result == "HELLO"
            
            result = await agent_tool.execute(text="world", operation="reverse")
            assert result == "dlrow"
            
        finally:
            os.chdir(original_cwd)

    def test_tool_error_handling(self):
        """Test error handling in tool loading and execution."""
        original_cwd = os.getcwd()
        os.chdir("examples/test_agents")
        
        try:
            # Test invalid implementation path
            with pytest.raises(ImportError):
                tool_config = AgentToolConfig(
                    name="invalid_tool",
                    description="Invalid tool",
                    implementation="nonexistent.module.function"
                )
                tool_config.load_function()
            
            # Test invalid function name
            with pytest.raises(AttributeError):
                tool_config = AgentToolConfig(
                    name="invalid_function",
                    description="Invalid function",
                    implementation="test_tools.nonexistent_function"
                )
                tool_config.load_function()
                
        finally:
            os.chdir(original_cwd)

    def test_custom_input_schema_override(self):
        """Test providing custom input schema instead of auto-generation."""
        original_cwd = os.getcwd()
        os.chdir("examples/test_agents")
        
        try:
            custom_schema = {
                "type": "object",
                "properties": {
                    "x": {"type": "number", "description": "First number"},
                    "y": {"type": "number", "description": "Second number"}
                },
                "required": ["x", "y"]
            }
            
            tool_config = AgentToolConfig(
                name="add_numbers",
                description="Add two numbers",
                implementation="test_tools.add_numbers",
                input_schema=custom_schema
            )
            
            agent_tool = tool_config.create_agent_tool()
            
            # Verify custom schema is used instead of auto-generated
            assert agent_tool.input_schema == custom_schema
            assert "x" in agent_tool.input_schema["properties"]
            assert "y" in agent_tool.input_schema["properties"]
            
        finally:
            os.chdir(original_cwd)

    @pytest.mark.integration
    def test_agent_tools_in_orchestration(self, original_cwd):
        """Integration test: verify tools are available in agent orchestration."""
        os.chdir("examples/test_agents")
        
        try:
            # Load agent
            agent, _ = load_agent_from_yaml("test_agent_with_tools.yaml")
            
            # Verify tools are loaded
            custom_tool_names = [
                tool.name for tool in agent._tools 
                if tool.name in ["add_numbers", "greet_user", "process_text"]
            ]
            assert len(custom_tool_names) == 3
            
            # Verify tools can be formatted for LLM providers
            from openagents.lms.providers import OpenAIProvider
            
            # Create mock provider to test tool formatting
            provider = OpenAIProvider(model_name="gpt-4o-mini", api_key="test")
            formatted_tools = provider.format_tools(agent._tools)
            
            # Verify custom tools are in formatted tools
            formatted_tool_names = [tool["name"] for tool in formatted_tools]
            assert "add_numbers" in formatted_tool_names
            assert "greet_user" in formatted_tool_names
            assert "process_text" in formatted_tool_names
            
        finally:
            os.chdir(original_cwd)


if __name__ == "__main__":
    # Allow running this test directly
    pytest.main([__file__])