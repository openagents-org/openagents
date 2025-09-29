"""
Tests for network password protection functionality.
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock

from openagents.utils.password_utils import hash_password, verify_password, validate_password_strength
from openagents.models.network_config import NetworkConfig
from openagents.core.network import AgentNetwork
from openagents.models.transport import TransportType


class TestPasswordUtils:
    """Test password utility functions."""

    def test_hash_password(self):
        """Test password hashing."""
        password = "test_password_123"
        hash1 = hash_password(password)
        hash2 = hash_password(password)
        
        # Hashes should be different due to salt
        assert hash1 != hash2
        assert len(hash1) > 0
        assert isinstance(hash1, str)

    def test_hash_password_empty(self):
        """Test hashing empty password raises error."""
        with pytest.raises(ValueError, match="Password cannot be empty"):
            hash_password("")
        
        with pytest.raises(ValueError, match="Password cannot be empty"):
            hash_password(None)

    def test_verify_password_correct(self):
        """Test password verification with correct password."""
        password = "test_password_123"
        password_hash = hash_password(password)
        
        assert verify_password(password, password_hash) is True

    def test_verify_password_incorrect(self):
        """Test password verification with incorrect password."""
        password = "test_password_123"
        wrong_password = "wrong_password"
        password_hash = hash_password(password)
        
        assert verify_password(wrong_password, password_hash) is False

    def test_verify_password_empty_inputs(self):
        """Test password verification with empty inputs."""
        assert verify_password("", "hash") is False
        assert verify_password("password", "") is False
        assert verify_password("", "") is False
        assert verify_password(None, "hash") is False
        assert verify_password("password", None) is False

    def test_validate_password_strength(self):
        """Test password strength validation."""
        # Valid password
        is_valid, message = validate_password_strength("validpassword123")
        assert is_valid is True
        assert message == ""
        
        # Too short
        is_valid, message = validate_password_strength("short")
        assert is_valid is False
        assert "8 characters" in message
        
        # Empty
        is_valid, message = validate_password_strength("")
        assert is_valid is False
        assert "empty" in message


class TestNetworkConfigPasswordFields:
    """Test NetworkConfig password-related fields."""

    def test_network_config_default_values(self):
        """Test default values for password fields."""
        config = NetworkConfig(name="test_network")
        
        assert config.password_hash is None
        assert config.require_password is False

    def test_network_config_with_password_hash(self):
        """Test NetworkConfig with password hash."""
        password_hash = hash_password("test_password")
        
        config = NetworkConfig(
            name="test_network",
            password_hash=password_hash,
            require_password=True
        )
        
        assert config.password_hash == password_hash
        assert config.require_password is True


class TestNetworkPasswordValidation:
    """Test network-level password validation."""

    @pytest.fixture
    def mock_network_config(self):
        """Create a mock network config with password protection."""
        password = "test_network_password"
        password_hash = hash_password(password)
        
        config = NetworkConfig(
            name="protected_network",
            password_hash=password_hash,
            require_password=True
        )
        return config, password

    @pytest.fixture
    def mock_network(self, mock_network_config):
        """Create a mock network instance."""
        config, password = mock_network_config
        
        # Mock the network instance
        network = MagicMock(spec=AgentNetwork)
        network.config = config
        network.register_agent = AsyncMock()
        
        return network, password

    @pytest.mark.asyncio
    async def test_register_with_correct_password(self, mock_network):
        """Test agent registration with correct password."""
        network, correct_password = mock_network
        
        # Import the actual register_agent method to test
        from openagents.core.network import AgentNetwork
        
        # Create a real network instance for testing
        config, _ = mock_network
        real_network = AgentNetwork(config.config, None)
        
        # Mock the topology to avoid actual network setup
        real_network.topology = MagicMock()
        real_network.topology.is_agent_registered = AsyncMock(return_value=False)
        real_network.topology.register_agent = AsyncMock(return_value=True)
        real_network.secret_manager = MagicMock()
        real_network.secret_manager.generate_secret = MagicMock(return_value="test_secret")
        real_network.event_gateway = MagicMock()
        real_network.event_gateway.register_agent = MagicMock()
        real_network.process_event = AsyncMock()
        
        # Test registration with correct password
        result = await real_network.register_agent(
            agent_id="test_agent",
            transport_type=TransportType.HTTP,
            metadata={"test": "data"},
            certificate="",
            password=correct_password
        )
        
        assert result.success is True
        assert "secret" in result.data

    @pytest.mark.asyncio
    async def test_register_with_incorrect_password(self, mock_network):
        """Test agent registration with incorrect password."""
        network, _ = mock_network
        
        # Import the actual register_agent method to test
        from openagents.core.network import AgentNetwork
        
        # Create a real network instance for testing
        config, _ = mock_network
        real_network = AgentNetwork(config.config, None)
        
        # Test registration with incorrect password
        result = await real_network.register_agent(
            agent_id="test_agent",
            transport_type=TransportType.HTTP,
            metadata={"test": "data"},
            certificate="",
            password="wrong_password"
        )
        
        assert result.success is False
        assert "Invalid network password" in result.message

    @pytest.mark.asyncio
    async def test_register_without_password_when_required(self, mock_network):
        """Test agent registration without password when required."""
        network, _ = mock_network
        
        # Import the actual register_agent method to test
        from openagents.core.network import AgentNetwork
        
        # Create a real network instance for testing
        config, _ = mock_network
        real_network = AgentNetwork(config.config, None)
        
        # Test registration without password
        result = await real_network.register_agent(
            agent_id="test_agent",
            transport_type=TransportType.HTTP,
            metadata={"test": "data"},
            certificate="",
            password=None
        )
        
        assert result.success is False
        assert "Password is required" in result.message

    @pytest.mark.asyncio
    async def test_register_no_password_requirement(self):
        """Test agent registration when no password is required."""
        # Create config without password requirement
        config = NetworkConfig(name="open_network", require_password=False)
        
        # Import the actual register_agent method to test
        from openagents.core.network import AgentNetwork
        
        # Create a real network instance for testing
        real_network = AgentNetwork(config, None)
        
        # Mock the topology to avoid actual network setup
        real_network.topology = MagicMock()
        real_network.topology.is_agent_registered = AsyncMock(return_value=False)
        real_network.topology.register_agent = AsyncMock(return_value=True)
        real_network.secret_manager = MagicMock()
        real_network.secret_manager.generate_secret = MagicMock(return_value="test_secret")
        real_network.event_gateway = MagicMock()
        real_network.event_gateway.register_agent = MagicMock()
        real_network.process_event = AsyncMock()
        
        # Test registration without password (should succeed)
        result = await real_network.register_agent(
            agent_id="test_agent",
            transport_type=TransportType.HTTP,
            metadata={"test": "data"},
            certificate="",
            password=None
        )
        
        assert result.success is True
        assert "secret" in result.data


class TestConfigurationMismatches:
    """Test configuration error cases."""

    @pytest.mark.asyncio
    async def test_require_password_without_hash(self):
        """Test configuration error: require_password=True but no password_hash."""
        # Create config with password requirement but no hash
        config = NetworkConfig(name="broken_network", require_password=True, password_hash=None)
        
        from openagents.core.network import AgentNetwork
        real_network = AgentNetwork(config, None)
        
        # Test registration should fail due to configuration error
        result = await real_network.register_agent(
            agent_id="test_agent",
            transport_type=TransportType.HTTP,
            metadata={"test": "data"},
            certificate="",
            password="any_password"
        )
        
        assert result.success is False
        assert "configuration error" in result.message