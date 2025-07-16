"""
Unit tests for the network launcher.
"""

import pytest
import asyncio
import sys
import os
import tempfile
import yaml
from unittest.mock import AsyncMock, MagicMock, patch

# Add the src directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))

from openagents.launchers.network_launcher import load_network_config, launch_network, async_launch_network
from openagents.models.network_config import OpenAgentsConfig, NetworkConfig, NetworkMode
from openagents.models.transport import TransportType


class TestConfigLoading:
    """Test configuration loading functionality."""
    
    def test_load_valid_config(self):
        """Test loading a valid configuration file."""
        config_data = {
            "network": {
                "name": "TestNetwork",
                "mode": "centralized",
                "transport": "websocket",
                "host": "127.0.0.1",
                "port": 8765
            }
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yaml.dump(config_data, f)
            f.flush()
            
            try:
                config = load_network_config(f.name)
                assert isinstance(config, OpenAgentsConfig)
                assert config.network.name == "TestNetwork"
                assert config.network.mode == "centralized"
                assert config.network.transport == "websocket"
                assert config.network.host == "127.0.0.1"
                assert config.network.port == 8765
            finally:
                os.unlink(f.name)


class TestNetworkLauncher:
    """Test network launcher functionality."""
    
    @pytest.fixture
    def valid_config_file(self):
        """Create a valid configuration file for testing."""
        config_data = {
            "network": {
                "name": "TestNetwork",
                "mode": "centralized",
                "transport": "websocket",
                "host": "127.0.0.1",
                "port": 8765,
                "server_mode": True
            }
        }
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yaml.dump(config_data, f)
            f.flush()
            yield f.name
            os.unlink(f.name)
    
    @pytest.mark.asyncio
    async def test_async_launch_network_success(self, valid_config_file):
        """Test successful async network launch."""
        with patch('openagents.launchers.network_launcher.create_network') as mock_create, \
             patch('openagents.launchers.network_launcher.load_network_config') as mock_load:
            
            # Mock configuration
            mock_config = MagicMock()
            mock_config.network = MagicMock()
            mock_config.network.mode = "centralized"
            mock_load.return_value = mock_config
            
            # Mock network
            mock_network = AsyncMock()
            mock_network.initialize.return_value = True
            mock_network.shutdown.return_value = True
            mock_network.is_running = True
            mock_network.network_name = "TestNetwork"
            mock_network.get_network_stats.return_value = {"status": "running"}
            mock_create.return_value = mock_network
            
            # Test with runtime limit
            await async_launch_network(valid_config_file, runtime=1)
            
            mock_load.assert_called_once_with(valid_config_file)
            mock_create.assert_called_once()
            mock_network.initialize.assert_called_once()
            mock_network.shutdown.assert_called_once()
    
    def test_launch_network_sync(self, valid_config_file):
        """Test synchronous network launch wrapper."""
        with patch('openagents.launchers.network_launcher.asyncio.run') as mock_run, \
             patch('openagents.launchers.network_launcher.async_launch_network') as mock_async:
            launch_network(valid_config_file, runtime=1)
            mock_run.assert_called_once()
            mock_async.assert_called_once_with(valid_config_file, 1)


if __name__ == "__main__":
    pytest.main([__file__])
 