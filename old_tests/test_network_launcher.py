"""
Unit tests for the network launcher.
"""

import pytest
import asyncio
from unittest.mock import patch, MagicMock, AsyncMock
from pathlib import Path

from openagents.launchers.network_launcher import launch_network, async_launch_network


class TestNetworkLauncher:
    """Test cases for network launcher functionality."""
    
    @pytest.fixture
    def valid_config_file(self, tmp_path):
        """Create a valid network config file for testing."""
        config_content = """
network:
  name: "TestNetwork"
  mode: "centralized"
  host: "localhost"
  port: 8000
  protocols:
    - name: "simple_messaging"
      version: "1.0"
"""
        config_file = tmp_path / "test_config.yaml"
        config_file.write_text(config_content)
        return str(config_file)
    
    @pytest.fixture
    def invalid_config_file(self, tmp_path):
        """Create an invalid network config file for testing."""
        config_content = "invalid: yaml: content:"
        config_file = tmp_path / "invalid_config.yaml"
        config_file.write_text(config_content)
        return str(config_file)

    @pytest.mark.asyncio
    async def test_async_launch_network_success(self, valid_config_file):
        """Test successful async network launch."""
        with patch('openagents.launchers.network_launcher.create_network') as mock_create, \
             patch('openagents.launchers.network_launcher.load_network_config') as mock_load, \
             patch('asyncio.run') as mock_asyncio_run:
            
            # Mock configuration
            mock_config = MagicMock()
            mock_config.network = MagicMock()
            mock_config.network.mode = "centralized"
            mock_load.return_value = mock_config
            
            # Mock network with proper async methods
            mock_network = MagicMock()
            mock_network.initialize = AsyncMock(return_value=True)
            mock_network.shutdown = AsyncMock(return_value=True)
            mock_network.is_running = True
            mock_network.network_name = "TestNetwork"
            mock_network.get_network_stats = MagicMock(return_value={"status": "running"})
            mock_create.return_value = mock_network
            
            # Mock asyncio.run to avoid actually running the event loop
            async def mock_async_launch(config_file, runtime=None):
                # Simulate the async_launch_network behavior
                pass
            
            mock_asyncio_run.side_effect = lambda coro: asyncio.get_event_loop().run_until_complete(coro)
            
            # Test with runtime limit
            await async_launch_network(valid_config_file, runtime=1)
            
            mock_load.assert_called_once_with(valid_config_file)
            mock_create.assert_called_once()
            mock_network.initialize.assert_called_once()
            mock_network.shutdown.assert_called_once()

    def test_launch_network_sync(self, valid_config_file):
        """Test synchronous network launch wrapper."""
        with patch('openagents.launchers.network_launcher.asyncio.run') as mock_asyncio_run, \
             patch('openagents.launchers.network_launcher.async_launch_network') as mock_async_launch:
            
            # Mock asyncio.run to avoid actually running async code
            mock_asyncio_run.return_value = None
            mock_async_launch.return_value = None
            
            # Test the synchronous wrapper
            result = launch_network(valid_config_file, runtime=1)
            
            # Verify that asyncio.run was called with the async function
            mock_asyncio_run.assert_called_once()
            
            # The result should be None (successful execution)
            assert result is None

    @pytest.mark.asyncio
    async def test_async_launch_network_file_not_found(self):
        """Test async network launch with non-existent config file."""
        # async_launch_network handles FileNotFoundError gracefully and doesn't re-raise
        # So we just test that it returns without crashing
        await async_launch_network("non_existent_config.yaml")
        # If we get here, the function handled the error correctly

    @pytest.mark.asyncio
    async def test_async_launch_network_invalid_config(self, invalid_config_file):
        """Test async network launch with invalid config file."""
        with patch('openagents.launchers.network_launcher.load_network_config') as mock_load:
            # Mock load_network_config to raise an exception
            mock_load.side_effect = Exception("Invalid configuration")
            
            # async_launch_network handles exceptions gracefully and doesn't re-raise
            # So we just test that it returns without crashing
            await async_launch_network(invalid_config_file)
            # If we get here, the function handled the error correctly

    def test_launch_network_invalid_config(self, invalid_config_file):
        """Test synchronous network launch with invalid config file."""
        # Create a simple mock function that raises an exception
        def mock_run(coro):
            raise Exception("Invalid configuration")
        
        with patch('openagents.launchers.network_launcher.asyncio.run', new=mock_run):
            # launch_network catches exceptions and calls sys.exit(1)
            with pytest.raises(SystemExit) as exc_info:
                launch_network(invalid_config_file)
            assert exc_info.value.code == 1


if __name__ == "__main__":
    pytest.main([__file__])
 