"""
Test cases for the refactored persistence functionality.

This module tests the new modular persistence system where:
- PersistenceManager provides directory interfaces
- Each mod handles its own persistence logic
- Network handles basic agent registry
"""

import pytest
import asyncio
import logging
import tempfile
import shutil
import sqlite3
import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

# Add the src directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))

from openagents.core.persistence import PersistenceManager, ModPersistenceHelper
from openagents.core.network import AgentNetwork
from openagents.models.network_config import NetworkConfig, NetworkMode
from openagents.models.transport import TransportType, AgentInfo
from openagents.models.event import Event

# Configure logging for tests
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


class TestPersistenceManager:
    """Test the refactored PersistenceManager class."""
    
    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def persistence_manager(self, temp_workspace):
        """Create a persistence manager with temporary workspace."""
        return PersistenceManager(temp_workspace)
    
    def test_directory_structure_initialization(self, persistence_manager):
        """Test directory structure initialization."""
        # Check that main directories are created
        assert persistence_manager.workspace_dir.exists()
        assert persistence_manager.global_dir.exists()
        assert persistence_manager.mods_dir.exists()
        
        # Check that global database exists
        assert persistence_manager.db_path.exists()
        assert persistence_manager.db_path.name == "network.db"
        assert persistence_manager.db_path.parent == persistence_manager.global_dir
    
    def test_global_database_schema(self, persistence_manager):
        """Test global database schema creation."""
        # Check database schema
        conn = sqlite3.connect(persistence_manager.db_path)
        cursor = conn.cursor()
        
        # Get list of tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        
        expected_tables = ['network_metadata', 'agent_registry']
        
        for table in expected_tables:
            assert table in tables, f"Table {table} not found in global database"
        
        conn.close()
    
    def test_mod_data_dir_creation(self, persistence_manager):
        """Test mod data directory creation."""
        # Test mod directory creation
        mod_dir1 = persistence_manager.mod_data_dir("thread_messaging")
        mod_dir2 = persistence_manager.mod_data_dir("shared_document")
        mod_dir3 = persistence_manager.mod_data_dir("openagents.mods.communication.thread_messaging")
        
        # Check directories exist
        assert mod_dir1.exists()
        assert mod_dir2.exists()
        assert mod_dir3.exists()
        
        # Check directory structure
        assert mod_dir1.parent == persistence_manager.mods_dir
        assert mod_dir2.parent == persistence_manager.mods_dir
        assert mod_dir3.parent == persistence_manager.mods_dir
        
        # Check sanitized names
        assert mod_dir1.name == "thread_messaging"
        assert mod_dir2.name == "shared_document"
        assert mod_dir3.name == "openagents_mods_communication_thread_messaging"
    
    def test_global_data_dir(self, persistence_manager):
        """Test global data directory access."""
        global_dir = persistence_manager.global_data_dir()
        assert global_dir == persistence_manager.global_dir
        assert global_dir.exists()
    
    def test_network_metadata_operations(self, persistence_manager):
        """Test network metadata operations."""
        # Set metadata
        persistence_manager.set_network_metadata("network_name", "TestNetwork")
        persistence_manager.set_network_metadata("startup_time", "2023-01-01T12:00:00Z")
        persistence_manager.set_network_metadata("config", {"port": 8572, "transport": "grpc"})
        
        # Get metadata
        assert persistence_manager.get_network_metadata("network_name") == "TestNetwork"
        assert persistence_manager.get_network_metadata("startup_time") == "2023-01-01T12:00:00Z"
        assert persistence_manager.get_network_metadata("config") == {"port": 8572, "transport": "grpc"}
        assert persistence_manager.get_network_metadata("nonexistent", "default") == "default"
        
        # List all metadata
        all_metadata = persistence_manager.list_network_metadata()
        assert "network_name" in all_metadata
        assert "startup_time" in all_metadata
        assert "config" in all_metadata
        assert len(all_metadata) == 3
    
    def test_agent_registry_operations(self, persistence_manager):
        """Test basic agent registry operations."""
        # Register agents
        persistence_manager.register_agent("agent1", {"name": "Agent 1", "type": "worker"})
        persistence_manager.register_agent("agent2", {"name": "Agent 2", "type": "assistant"})
        
        # Get active agents
        agents = persistence_manager.get_active_agents()
        assert len(agents) == 2
        
        agent_ids = {agent["agent_id"] for agent in agents}
        assert "agent1" in agent_ids
        assert "agent2" in agent_ids
        
        # Check agent data
        agent1 = next(agent for agent in agents if agent["agent_id"] == "agent1")
        assert agent1["metadata"]["name"] == "Agent 1"
        assert agent1["metadata"]["type"] == "worker"
        
        # Unregister agent
        persistence_manager.unregister_agent("agent1")
        
        # Check only active agents are returned
        active_agents = persistence_manager.get_active_agents()
        assert len(active_agents) == 1
        assert active_agents[0]["agent_id"] == "agent2"
    
    def test_utility_methods(self, persistence_manager):
        """Test utility methods."""
        # Test database path generation
        global_db = persistence_manager.get_database_path()
        mod_db = persistence_manager.get_database_path("thread_messaging")
        
        assert global_db == persistence_manager.db_path
        assert mod_db.name == "thread_messaging.db"
        assert mod_db.parent == persistence_manager.mod_data_dir("thread_messaging")
        
        # Test workspace path generation
        test_path = persistence_manager.get_workspace_path("test", "sub", "file.txt")
        expected_path = persistence_manager.workspace_dir / "test" / "sub" / "file.txt"
        assert test_path == expected_path
        
        # Test storage stats
        stats = persistence_manager.get_storage_stats()
        assert "workspace_dir" in stats
        assert "global_dir" in stats
        assert "mods_dir" in stats
        assert "active_agents" in stats
        assert stats["active_agents"] >= 0


class TestModPersistenceHelper:
    """Test the ModPersistenceHelper class."""
    
    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def persistence_manager(self, temp_workspace):
        """Create a persistence manager with temporary workspace."""
        return PersistenceManager(temp_workspace)
    
    @pytest.fixture
    def mod_helper(self, persistence_manager):
        """Create a mod persistence helper."""
        return ModPersistenceHelper("test_mod", persistence_manager)
    
    def test_mod_helper_initialization(self, mod_helper, persistence_manager):
        """Test mod helper initialization."""
        assert mod_helper.mod_name == "test_mod"
        assert mod_helper.persistence_manager == persistence_manager
        assert mod_helper.data_dir.exists()
        assert mod_helper.data_dir.name == "test_mod"
        assert mod_helper.db_path.name == "test_mod.db"
    
    def test_database_initialization(self, mod_helper):
        """Test mod database initialization."""
        schema = """
            CREATE TABLE IF NOT EXISTS test_table (
                id INTEGER PRIMARY KEY,
                name TEXT,
                data TEXT
            );
        """
        
        mod_helper.init_database(schema)
        
        # Check that database exists and has the table
        assert mod_helper.db_path.exists()
        
        # Check table exists
        results = mod_helper.execute_query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'"
        )
        assert len(results) == 1
        assert results[0][0] == "test_table"
    
    def test_database_operations(self, mod_helper):
        """Test database operations."""
        # Initialize database
        schema = """
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                value INTEGER
            );
        """
        mod_helper.init_database(schema)
        
        # Insert data
        rows_affected = mod_helper.execute_update(
            "INSERT INTO items (name, value) VALUES (?, ?)",
            ("test_item", 42)
        )
        assert rows_affected == 1
        
        # Query data
        results = mod_helper.execute_query("SELECT name, value FROM items")
        assert len(results) == 1
        assert results[0] == ("test_item", 42)
        
        # Update data
        rows_affected = mod_helper.execute_update(
            "UPDATE items SET value = ? WHERE name = ?",
            (100, "test_item")
        )
        assert rows_affected == 1
        
        # Query updated data
        results = mod_helper.execute_query("SELECT value FROM items WHERE name = ?", ("test_item",))
        assert results[0][0] == 100
    
    def test_json_file_operations(self, mod_helper):
        """Test JSON file operations."""
        # Save JSON data
        test_data = {
            "string": "test",
            "number": 42,
            "list": [1, 2, 3],
            "nested": {"key": "value"}
        }
        
        mod_helper.save_json_file("test_data.json", test_data)
        
        # Check file exists
        file_path = mod_helper.get_file_path("test_data.json")
        assert file_path.exists()
        
        # Load JSON data
        loaded_data = mod_helper.load_json_file("test_data.json")
        assert loaded_data == test_data
        
        # Test loading non-existent file
        missing_data = mod_helper.load_json_file("missing.json", {"default": True})
        assert missing_data == {"default": True}


class TestNetworkIntegration:
    """Test integration with network."""
    
    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def network_config_with_persistence(self, temp_workspace):
        """Create network config with persistence enabled."""
        return NetworkConfig(
            name="PersistentTestNetwork",
            mode=NetworkMode.CENTRALIZED,
            host="127.0.0.1",
            port=8571,
            transport=TransportType.WEBSOCKET,
            server_mode=True,
            workspace_dir=temp_workspace
        )
    
    def test_network_persistence_integration(self, network_config_with_persistence):
        """Test network integration with new persistence architecture."""
        network = AgentNetwork(network_config_with_persistence)
        workspace_dir = network_config_with_persistence.workspace_dir
        network.persistence_manager = PersistenceManager(workspace_dir)
        
        # Verify persistence manager is set up correctly
        assert hasattr(network, 'persistence_manager')
        assert network.persistence_manager is not None
        
        # Check directory structure
        assert network.persistence_manager.global_dir.exists()
        assert network.persistence_manager.mods_dir.exists()
        
        # Test network metadata
        network.persistence_manager.set_network_metadata("network_id", network.network_name)
        stored_name = network.persistence_manager.get_network_metadata("network_id")
        assert stored_name == network.network_name
    
    @pytest.mark.asyncio
    async def test_agent_registration_persistence(self, network_config_with_persistence):
        """Test agent registration with new persistence."""
        network = AgentNetwork(network_config_with_persistence)
        workspace_dir = network_config_with_persistence.workspace_dir
        network.persistence_manager = PersistenceManager(workspace_dir)
        
        # Mock topology
        network.topology.register_agent = AsyncMock(return_value=True)
        
        # Register agent
        agent_id = "test_agent"
        metadata = {"name": "Test Agent", "type": "worker"}
        
        result = await network.register_agent(agent_id, metadata)
        assert result is True
        
        # Verify agent was saved to global registry
        agents = network.persistence_manager.get_active_agents()
        assert len(agents) >= 1
        test_agent = next((agent for agent in agents if agent["agent_id"] == agent_id), None)
        assert test_agent is not None
        assert test_agent["metadata"]["name"] == "Test Agent"


class TestCLIIntegration:
    """Test CLI integration with new persistence features."""
    
    @pytest.fixture
    def temp_workspace(self):
        """Create a temporary workspace directory."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    def test_workspace_config_discovery(self, temp_workspace):
        """Test CLI discovery of network.yaml in workspace."""
        from openagents.cli import launch_network_command
        import argparse
        
        # Create a network.yaml in workspace
        workspace_path = Path(temp_workspace)
        config_content = """
network:
  name: "WorkspaceNetwork"
  mode: "centralized"
  host: "127.0.0.1"
  port: 8573
  transport: "grpc"
  server_mode: true
"""
        
        network_config_path = workspace_path / "network.yaml"
        network_config_path.write_text(config_content)
        
        # Create args object simulating CLI call without config but with workspace_dir
        args = argparse.Namespace()
        args.config = None
        args.workspace_dir = temp_workspace
        args.runtime = None
        
        # Mock the launch_network function to prevent actual network launch
        with patch('openagents.cli.launch_network') as mock_launch:
            launch_network_command(args)
            
            # Verify that launch_network was called with the discovered config
            mock_launch.assert_called_once()
            call_args = mock_launch.call_args[0]
            assert call_args[0] == str(network_config_path)  # config path
            assert call_args[1] is None  # runtime
            assert call_args[2] == temp_workspace  # workspace_dir


if __name__ == "__main__":
    pytest.main([__file__])