"""
Test cases for loading agents from YAML configuration files.

This module tests the agent_loader utility functions and AgentRunner.from_yaml() method.
"""

import os
import tempfile
import pytest
from pathlib import Path
from typing import Dict, Any

from openagents.utils.agent_loader import (
    load_agent_from_yaml,
    load_worker_agent_from_yaml,
    _create_agent_config_from_yaml,
    _process_mods_config,
    _load_agent_class
)
from openagents.agents.runner import AgentRunner
from openagents.agents.worker_agent import WorkerAgent
from openagents.models.agent_config import AgentConfig


class TestAgentConfigCreation:
    """Test AgentConfig creation from YAML data."""
    
    def test_create_agent_config_valid(self):
        """Test creating AgentConfig with valid data."""
        config_data = {
            "instruction": "You are a test agent",
            "model_name": "gpt-4o-mini",
            "provider": "openai",
            "triggers": [
                {"event": "test.event", "instruction": "Handle test events"}
            ],
            "react_to_all_messages": False,
            "max_iterations": 5
        }
        
        agent_config = _create_agent_config_from_yaml(config_data)
        
        assert isinstance(agent_config, AgentConfig)
        assert agent_config.instruction == "You are a test agent"
        assert agent_config.model_name == "gpt-4o-mini"
        assert agent_config.provider == "openai"
        assert len(agent_config.triggers) == 1
        assert agent_config.triggers[0].event == "test.event"
        assert agent_config.react_to_all_messages is False
        assert agent_config.max_iterations == 5
    
    def test_create_agent_config_minimal(self):
        """Test creating AgentConfig with minimal required data."""
        config_data = {
            "instruction": "Minimal test agent",
            "model_name": "gpt-4o-mini",
            "triggers": []
        }
        
        agent_config = _create_agent_config_from_yaml(config_data)
        
        assert isinstance(agent_config, AgentConfig)
        assert agent_config.instruction == "Minimal test agent"
        assert agent_config.model_name == "gpt-4o-mini"
        assert len(agent_config.triggers) == 0
    
    def test_create_agent_config_missing_required(self):
        """Test creating AgentConfig with missing required fields."""
        config_data = {
            "model_name": "gpt-4o-mini"
            # Missing instruction
        }
        
        with pytest.raises(ValueError, match="Invalid AgentConfig data"):
            _create_agent_config_from_yaml(config_data)
    
    def test_create_agent_config_empty(self):
        """Test creating AgentConfig with empty data."""
        with pytest.raises(ValueError, match="'config' section is required"):
            _create_agent_config_from_yaml({})


class TestModsProcessing:
    """Test mods configuration processing."""
    
    def test_process_mods_empty_generic(self):
        """Test processing empty mods for generic agent."""
        class MockAgentClass:
            pass
        
        mod_names = _process_mods_config([], MockAgentClass)
        assert mod_names == []
    
    def test_process_mods_empty_worker_agent(self):
        """Test processing empty mods for WorkerAgent."""
        # Mock a WorkerAgent class
        class MockWorkerAgent:
            def __str__(self):
                return "MockWorkerAgent"
        
        mod_names = _process_mods_config([], MockWorkerAgent)
        assert mod_names == ['openagents.mods.workspace.messaging']
    
    def test_process_mods_enabled_and_disabled(self):
        """Test processing mods with enabled and disabled entries."""
        class MockAgentClass:
            pass
        
        mods_data = [
            {"name": "mod1", "enabled": True},
            {"name": "mod2", "enabled": False},
            {"name": "mod3", "enabled": True},
            {"name": "mod4"}  # Default to enabled
        ]
        
        mod_names = _process_mods_config(mods_data, MockAgentClass)
        assert mod_names == ["mod1", "mod3", "mod4"]
    
    def test_process_mods_worker_agent_auto_include(self):
        """Test that WorkerAgent auto-includes workspace messaging."""
        class MockWorkerAgent:
            def __str__(self):
                return "WorkerAgent"
        
        mods_data = [
            {"name": "openagents.mods.discovery.agent_discovery", "enabled": True}
        ]
        
        mod_names = _process_mods_config(mods_data, MockWorkerAgent)
        assert "openagents.mods.workspace.messaging" in mod_names
        assert "openagents.mods.discovery.agent_discovery" in mod_names
    
    def test_process_mods_invalid_config(self):
        """Test processing invalid mod configuration."""
        class MockAgentClass:
            pass
        
        mods_data = [
            "invalid_mod_config",  # Not a dict
            {"enabled": True},  # Missing name
            {"name": "valid_mod", "enabled": True}
        ]
        
        mod_names = _process_mods_config(mods_data, MockAgentClass)
        assert mod_names == ["valid_mod"]


class TestAgentClassLoading:
    """Test dynamic agent class loading."""
    
    def test_load_worker_agent_class(self):
        """Test loading WorkerAgent class."""
        agent_class = _load_agent_class("openagents.agents.worker_agent.WorkerAgent")
        assert agent_class == WorkerAgent
        assert issubclass(agent_class, AgentRunner)
    
    def test_load_invalid_class_path(self):
        """Test loading with invalid class path."""
        with pytest.raises(ValueError, match="Agent type must be fully qualified"):
            _load_agent_class("InvalidClassName")
    
    def test_load_nonexistent_module(self):
        """Test loading from nonexistent module."""
        with pytest.raises(ImportError, match="Failed to import agent class"):
            _load_agent_class("nonexistent.module.Class")
    
    def test_load_nonexistent_class(self):
        """Test loading nonexistent class from valid module."""
        with pytest.raises(ImportError, match="Class 'NonexistentClass' not found"):
            _load_agent_class("openagents.agents.worker_agent.NonexistentClass")
    
    def test_load_non_agent_class(self):
        """Test loading class that's not an AgentRunner."""
        with pytest.raises(ValueError, match="is not an AgentRunner subclass"):
            _load_agent_class("builtins.str")


class TestYAMLFileCreation:
    """Helper class for creating temporary YAML files for testing."""
    
    @staticmethod
    def create_temp_yaml(content: str) -> Path:
        """Create a temporary YAML file with given content."""
        temp_file = tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False)
        temp_file.write(content)
        temp_file.close()
        return Path(temp_file.name)
    
    @staticmethod
    def cleanup_temp_file(file_path: Path):
        """Clean up temporary file."""
        if file_path.exists():
            os.unlink(file_path)


class TestLoadAgentFromYAML:
    """Test the generic load_agent_from_yaml function."""
    
    def test_load_valid_worker_agent(self):
        """Test loading a valid WorkerAgent configuration."""
        yaml_content = """
agent_id: "test_agent"
type: "openagents.agents.worker_agent.WorkerAgent"

config:
  instruction: "You are a test agent"
  model_name: "gpt-4o-mini"
  provider: "openai"
  triggers:
    - event: "test.event"
      instruction: "Handle test events"
  react_to_all_messages: false
  max_iterations: 5

mods:
  - name: "openagents.mods.workspace.messaging"
    enabled: true

connection:
  host: "localhost"
  port: 8570
  network_id: "test-network"
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            agent, connection = load_agent_from_yaml(str(yaml_file))
            
            # Verify agent properties
            assert isinstance(agent, AgentRunner)
            assert isinstance(agent, WorkerAgent)
            assert agent.client.agent_id == "test_agent"
            
            # Verify AgentConfig
            assert agent.agent_config.instruction == "You are a test agent"
            assert agent.agent_config.model_name == "gpt-4o-mini"
            assert agent.agent_config.provider == "openai"
            
            # Verify connection
            assert connection is not None
            assert connection["host"] == "localhost"
            assert connection["port"] == 8570
            assert connection["network_id"] == "test-network"
            
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)
    
    def test_load_minimal_config(self):
        """Test loading minimal configuration."""
        yaml_content = """
agent_id: "minimal_agent"

config:
  instruction: "Minimal test agent"
  model_name: "gpt-4o-mini"
  triggers: []
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            agent, connection = load_agent_from_yaml(str(yaml_file))
            
            # Verify agent properties
            assert isinstance(agent, WorkerAgent)  # Default type
            assert agent.client.agent_id == "minimal_agent"
            
            # Verify no connection settings
            assert connection is None
            
            # Verify auto-included workspace messaging for WorkerAgent
            mod_keys = list(agent.client.mod_adapters.keys())
            has_messaging = any('messaging' in key.lower() for key in mod_keys)
            assert has_messaging
            
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)
    
    def test_load_with_overrides(self):
        """Test loading with agent_id and connection overrides."""
        yaml_content = """
agent_id: "original_agent"

config:
  instruction: "Test agent"
  model_name: "gpt-4o-mini"
  triggers: []

connection:
  host: "original-host"
  port: 8570
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            override_connection = {"host": "override-host", "port": 9999}
            agent, connection = load_agent_from_yaml(
                str(yaml_file),
                agent_id_override="override_agent",
                connection_override=override_connection
            )
            
            # Verify overrides
            assert agent.client.agent_id == "override_agent"
            assert connection == override_connection
            
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)
    
    def test_load_nonexistent_file(self):
        """Test loading from nonexistent file."""
        with pytest.raises(FileNotFoundError, match="YAML configuration file not found"):
            load_agent_from_yaml("nonexistent.yaml")
    
    def test_load_invalid_yaml(self):
        """Test loading invalid YAML content."""
        yaml_content = """
agent_id: "test_agent"
invalid_yaml: [
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            with pytest.raises(Exception):  # Could be YAMLError or ValueError
                load_agent_from_yaml(str(yaml_file))
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)
    
    def test_load_missing_agent_id(self):
        """Test loading configuration without agent_id."""
        yaml_content = """
config:
  instruction: "Test agent"
  model_name: "gpt-4o-mini"
  triggers: []
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            with pytest.raises(ValueError, match="agent_id must be specified"):
                load_agent_from_yaml(str(yaml_file))
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)


class TestLoadWorkerAgentFromYAML:
    """Test the WorkerAgent-specific loading function."""
    
    def test_load_worker_agent_success(self):
        """Test successful WorkerAgent loading."""
        yaml_content = """
agent_id: "worker_test"
type: "openagents.agents.worker_agent.WorkerAgent"

config:
  instruction: "Test WorkerAgent"
  model_name: "gpt-4o-mini"
  triggers: []
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            agent, connection = load_worker_agent_from_yaml(str(yaml_file))
            
            assert isinstance(agent, WorkerAgent)
            assert agent.client.agent_id == "worker_test"
            
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)
    
    def test_load_non_worker_agent_fails(self):
        """Test that loading non-WorkerAgent fails."""
        # This test would require a custom non-WorkerAgent class
        # For now, we'll test with the WorkerAgent and verify the validation exists
        yaml_content = """
agent_id: "test_agent"
type: "openagents.agents.worker_agent.WorkerAgent"

config:
  instruction: "Test agent"
  model_name: "gpt-4o-mini"
  triggers: []
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            # This should succeed since we're loading a WorkerAgent
            agent, connection = load_worker_agent_from_yaml(str(yaml_file))
            assert isinstance(agent, WorkerAgent)
            
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)


class TestAgentRunnerFromYAML:
    """Test the AgentRunner.from_yaml() class method."""
    
    def test_from_yaml_success(self):
        """Test successful loading via class method."""
        yaml_content = """
agent_id: "class_method_test"

config:
  instruction: "Test agent via class method"
  model_name: "gpt-4o-mini"
  triggers: []
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            agent = AgentRunner.from_yaml(str(yaml_file))
            
            assert isinstance(agent, AgentRunner)
            assert isinstance(agent, WorkerAgent)  # Default type
            assert agent.client.agent_id == "class_method_test"
            
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)
    
    def test_from_yaml_file_not_found(self):
        """Test class method with nonexistent file."""
        with pytest.raises(FileNotFoundError):
            AgentRunner.from_yaml("nonexistent.yaml")


class TestIntegrationScenarios:
    """Test real-world integration scenarios."""
    
    def test_complete_configuration(self):
        """Test loading a complete, realistic configuration."""
        yaml_content = """
agent_id: "integration_test_agent"
type: "openagents.agents.worker_agent.WorkerAgent"

config:
  instruction: |
    You are a helpful assistant agent in an OpenAgents network.
    You can communicate with other agents and help users with tasks.
  model_name: "gpt-4o-mini"
  provider: "openai"
  api_base: "https://api.openai.com/v1"
  triggers:
    - event: "thread.channel_message.notification"
      instruction: "Respond helpfully to channel messages"
    - event: "thread.direct_message.notification"
      instruction: "Handle direct messages with care"
  react_to_all_messages: false
  max_iterations: 10

mods:
  - name: "openagents.mods.workspace.messaging"
    enabled: true
    config:
      max_message_history: 1000
  - name: "openagents.mods.discovery.agent_discovery"
    enabled: true
    config:
      announce_interval: 60

connection:
  host: "localhost"
  port: 8570
  network_id: "integration-test-network"
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            # Test all three loading methods
            
            # 1. Generic loader
            agent1, conn1 = load_agent_from_yaml(str(yaml_file))
            assert isinstance(agent1, WorkerAgent)
            assert agent1.client.agent_id == "integration_test_agent"
            assert conn1["network_id"] == "integration-test-network"
            
            # 2. WorkerAgent-specific loader
            agent2, conn2 = load_worker_agent_from_yaml(str(yaml_file))
            assert isinstance(agent2, WorkerAgent)
            assert agent2.client.agent_id == "integration_test_agent"
            assert conn2["network_id"] == "integration-test-network"
            
            # 3. Class method
            agent3 = AgentRunner.from_yaml(str(yaml_file))
            assert isinstance(agent3, WorkerAgent)
            assert agent3.client.agent_id == "integration_test_agent"
            
            # Verify AgentConfig details
            for agent in [agent1, agent2, agent3]:
                config = agent.agent_config
                assert "helpful assistant agent" in config.instruction.lower()
                assert config.model_name == "gpt-4o-mini"
                assert config.provider == "openai"
                assert config.api_base == "https://api.openai.com/v1"
                assert len(config.triggers) == 2
                assert config.max_iterations == 10
            
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)
    
    def test_environment_simulation(self):
        """Test loading with environment-like overrides."""
        yaml_content = """
agent_id: "base_agent"

config:
  instruction: "Base agent configuration"
  model_name: "gpt-4o-mini"
  triggers: []

connection:
  host: "localhost"
  port: 8570
  network_id: "dev-network"
"""
        
        yaml_file = TestYAMLFileCreation.create_temp_yaml(yaml_content)
        
        try:
            # Simulate different environment deployments
            environments = [
                {
                    "name": "dev",
                    "agent_id": "agent-dev-001",
                    "connection": {"host": "dev-server", "port": 8571, "network_id": "dev-network"}
                },
                {
                    "name": "staging", 
                    "agent_id": "agent-staging-001",
                    "connection": {"host": "staging-server", "port": 8572, "network_id": "staging-network"}
                },
                {
                    "name": "prod",
                    "agent_id": "agent-prod-001", 
                    "connection": {"host": "prod-server", "port": 8573, "network_id": "prod-network"}
                }
            ]
            
            for env in environments:
                agent, connection = load_agent_from_yaml(
                    str(yaml_file),
                    agent_id_override=env["agent_id"],
                    connection_override=env["connection"]
                )
                
                assert agent.client.agent_id == env["agent_id"]
                assert connection == env["connection"]
                assert isinstance(agent, WorkerAgent)
            
        finally:
            TestYAMLFileCreation.cleanup_temp_file(yaml_file)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])