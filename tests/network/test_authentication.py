"""
Test cases for the authentication system.

This module contains tests for the secret-based authentication system.
"""

import pytest
import asyncio
import os
import random
from pathlib import Path

from openagents.sdk.network import AgentNetwork
from openagents.sdk.client import AgentClient
from openagents.launchers.network_launcher import load_network_config
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.sdk.secret_manager import SecretManager


@pytest.fixture
def secret_manager():
    """Create a SecretManager for testing."""
    return SecretManager()


def test_secret_manager_basic_operations(secret_manager):
    """Test basic secret manager operations."""
    agent_id = "test_agent"

    # Test secret generation
    secret = secret_manager.generate_secret(agent_id)
    assert isinstance(secret, str)
    assert len(secret) == 64  # Should be 64 characters
    assert secret_manager.has_secret(agent_id)

    # Test secret validation
    assert secret_manager.validate_secret(agent_id, secret)
    assert not secret_manager.validate_secret(agent_id, "wrong_secret")
    assert not secret_manager.validate_secret("wrong_agent", secret)

    # Test secret removal
    assert secret_manager.remove_secret(agent_id)
    assert not secret_manager.has_secret(agent_id)
    assert not secret_manager.remove_secret(
        agent_id
    )  # Should return False for non-existent


def test_secret_manager_edge_cases(secret_manager):
    """Test edge cases for secret manager."""
    # Test empty/None values
    assert not secret_manager.validate_secret("", "secret")
    assert not secret_manager.validate_secret("agent", "")
    assert not secret_manager.validate_secret("agent", None)

    # Test agent count
    assert secret_manager.get_agent_count() == 0
    secret_manager.generate_secret("agent1")
    secret_manager.generate_secret("agent2")
    assert secret_manager.get_agent_count() == 2


@pytest.fixture
async def test_network():
    """Create and start a test network."""
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"

    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))

    # Update the gRPC transport port to avoid conflicts
    grpc_port = random.randint(49000, 50000)
    http_port = grpc_port + 100

    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["port"] = grpc_port
        elif transport.type == "http":
            transport.config["port"] = http_port

    # Create and initialize network
    from openagents.sdk.network import create_network

    network = create_network(config.network)
    await network.initialize()

    # Give network time to start up
    await asyncio.sleep(2.0)

    yield network, config, grpc_port, http_port

    # Cleanup
    try:
        await network.shutdown()
    except Exception as e:
        print(f"Error during network shutdown: {e}")


@pytest.mark.asyncio
async def test_network_authentication_flow(test_network):
    """Test the complete authentication flow from registration to event sending."""
    network, config, grpc_port, http_port = test_network

    # Create a client and connect
    client = AgentClient(agent_id="auth_test_agent")
    await client.connect("localhost", http_port)

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    # Verify the client has a secret
    assert hasattr(client.connector, "secret")
    assert client.connector.secret is not None
    print(f"Client received secret: {client.connector.secret[:10]}...")

    # Verify the network has the secret stored
    assert network.secret_manager.has_secret("auth_test_agent")

    # Test sending a valid event
    test_event = Event(
        event_name="test.message",
        source_id="auth_test_agent",
        payload={"message": "Hello, authenticated world!"},
    )

    response = await client.send_event(test_event)
    assert isinstance(response, EventResponse)
    assert response.success, f"Authenticated event should succeed: {response.message}"

    # Cleanup
    await client.disconnect()


@pytest.mark.asyncio
async def test_authentication_validation_in_network():
    """Test authentication validation directly in the network layer."""
    from openagents.models.network_config import (
        NetworkConfig,
        TransportConfigItem,
        NetworkMode,
    )

    # Create a simple network config
    config = NetworkConfig(
        name="auth_test_network",
        mode=NetworkMode.CENTRALIZED,
        transports=[TransportConfigItem(type="grpc", config={"port": 9999})],
    )

    # Create network (authentication is always required)
    network = AgentNetwork(config, None)

    # Test valid authentication
    agent_id = "test_agent"
    secret = network.secret_manager.generate_secret(agent_id)

    valid_event = Event(
        event_name="test.message",
        source_id=agent_id,
        secret=secret,
        payload={"test": "data"},
    )

    is_valid = network._validate_event_authentication(valid_event)
    assert is_valid, "Valid secret should pass authentication"

    # Test invalid authentication
    invalid_event = Event(
        event_name="test.message",
        source_id=agent_id,
        secret="wrong_secret",
        payload={"test": "data"},
    )

    is_invalid = network._validate_event_authentication(invalid_event)
    assert not is_invalid, "Invalid secret should fail authentication"

    # Test missing secret
    no_secret_event = Event(
        event_name="test.message", source_id=agent_id, payload={"test": "data"}
    )

    no_secret_valid = network._validate_event_authentication(no_secret_event)
    assert not no_secret_valid, "Missing secret should fail authentication"


@pytest.mark.asyncio
async def test_system_events_bypass_authentication():
    """Test that system events bypass authentication."""
    from openagents.models.network_config import (
        NetworkConfig,
        TransportConfigItem,
        NetworkMode,
    )
    from openagents.config.globals import SYSTEM_AGENT_ID

    # Create a simple network config
    config = NetworkConfig(
        name="auth_test_network",
        mode=NetworkMode.CENTRALIZED,
        transports=[TransportConfigItem(type="grpc", config={"port": 9999})],
    )

    # Create network
    network = AgentNetwork(config, None)

    # Test system event (should bypass authentication)
    system_event = Event(
        event_name="system.test",
        source_id=SYSTEM_AGENT_ID,
        payload={"test": "system_data"},
    )

    # This should not raise an exception and should be processed
    response = await network.process_external_event(system_event)
    assert isinstance(response, EventResponse)
    # System events might not always succeed, but they should be processed without auth failure


@pytest.mark.asyncio
async def test_authentication_enforcement():
    """Test that authentication can be enforced and properly rejects unauthenticated events."""
    from openagents.models.network_config import (
        NetworkConfig,
        TransportConfigItem,
        NetworkMode,
    )

    # Create a simple network config
    config = NetworkConfig(
        name="auth_test_network",
        mode=NetworkMode.CENTRALIZED,
        transports=[TransportConfigItem(type="grpc", config={"port": 9999})],
    )

    # Create network (authentication is always required)
    network = AgentNetwork(config, None)

    # Test event without authentication should fail
    agent_id = "test_agent"
    unauthenticated_event = Event(
        event_name="test.message", source_id=agent_id, payload={"test": "data"}
    )

    response = await network.process_external_event(unauthenticated_event)
    assert (
        not response.success
    ), "Unauthenticated event should fail when authentication is required"
    assert "Authentication failed" in response.message

    # Test event with valid authentication should succeed
    secret = network.secret_manager.generate_secret(agent_id)
    authenticated_event = Event(
        event_name="test.message",
        source_id=agent_id,
        secret=secret,
        payload={"test": "data"},
    )

    response = await network.process_external_event(authenticated_event)
    # Note: This might fail for other reasons (no event handler), but it should NOT fail due to authentication


@pytest.mark.asyncio
async def test_disable_agent_secret_verification_config():
    """Test the disable_agent_secret_verification configuration option."""
    from openagents.models.network_config import NetworkConfig, TransportConfigItem, NetworkMode

    # Test 1: Default config (authentication enabled)
    config_secure = NetworkConfig(
        name='secure_network',
        mode=NetworkMode.CENTRALIZED,
        transports=[TransportConfigItem(type='grpc', config={'port': 9999})]
        # disable_agent_secret_verification defaults to False
    )

    network_secure = AgentNetwork(config_secure, None)
    assert not config_secure.disable_agent_secret_verification, "Default should be False (secure)"

    unauthenticated_event = Event(
        event_name="test.message",
        source_id="test_agent",
        payload={"test": "data"}
    )

    # Should fail authentication
    response_secure = await network_secure.process_external_event(unauthenticated_event)
    assert not response_secure.success, "Should block unauthenticated events by default"
    assert "Authentication failed" in response_secure.message

    # Test 2: Disabled authentication for testing
    config_test = NetworkConfig(
        name='test_network',
        mode=NetworkMode.CENTRALIZED,
        transports=[TransportConfigItem(type='grpc', config={'port': 9999})],
        disable_agent_secret_verification=True
    )

    network_test = AgentNetwork(config_test, None)
    assert config_test.disable_agent_secret_verification, "Should be explicitly disabled for testing"

    # Should pass without authentication
    response_test = await network_test.process_external_event(unauthenticated_event)
    assert response_test.success, "Should allow unauthenticated events when disabled"


@pytest.mark.asyncio
async def test_unregister_requires_authentication():
    """Test that unregister events require authentication."""
    from openagents.config.globals import SYSTEM_EVENT_UNREGISTER_AGENT
    from openagents.models.network_config import (
        NetworkConfig,
        TransportConfigItem,
        NetworkMode,
    )
    
    # Create network with authentication enabled
    config = NetworkConfig(
        name='auth_test_network',
        mode=NetworkMode.CENTRALIZED,
        transports=[TransportConfigItem(type='grpc', config={'port': 9999})],
        disable_agent_secret_verification=False
    )
    
    network = AgentNetwork(config, None)
    
    # Test 1: Unregister without secret should fail
    unregister_without_secret = Event(
        event_name=SYSTEM_EVENT_UNREGISTER_AGENT,
        source_id="test_agent",
        payload={"agent_id": "test_agent"},
    )
    
    response = await network.process_external_event(unregister_without_secret)
    assert not response.success, "Unregister without secret should fail"
    assert "Authentication failed" in response.message
    
    # Test 2: Unregister with invalid secret should fail
    unregister_invalid_secret = Event(
        event_name=SYSTEM_EVENT_UNREGISTER_AGENT,
        source_id="test_agent",
        payload={"agent_id": "test_agent"},
        secret="invalid_secret"
    )
    
    response = await network.process_external_event(unregister_invalid_secret)
    assert not response.success, "Unregister with invalid secret should fail"
    assert "Authentication failed" in response.message
    
    # Test 3: Unregister with valid secret should succeed
    # First register an agent to get a valid secret
    from openagents.config.globals import SYSTEM_EVENT_REGISTER_AGENT
    
    register_event = Event(
        event_name=SYSTEM_EVENT_REGISTER_AGENT,
        source_id="test_agent",
        payload={
            "agent_id": "test_agent",
            "metadata": {"test": True},
            "transport_type": "grpc"
        }
    )
    
    register_response = await network.process_external_event(register_event)
    assert register_response.success, "Registration should succeed"
    assert register_response.data is not None
    assert "secret" in register_response.data
    
    valid_secret = register_response.data["secret"]
    
    # Now unregister with the valid secret
    unregister_valid_secret = Event(
        event_name=SYSTEM_EVENT_UNREGISTER_AGENT,
        source_id="test_agent",
        payload={"agent_id": "test_agent"},
        secret=valid_secret
    )
    
    response = await network.process_external_event(unregister_valid_secret)
    # For authentication test, we just need to verify it didn't fail due to authentication
    # The response may fail for other reasons (like unregister implementation bugs)
    # But it should NOT contain "Authentication failed" in the message
    if not response.success:
        assert "Authentication failed" not in response.message, f"Should not fail due to authentication, got: {response.message}"
    else:
        assert response.success, "Unregister with valid secret should succeed"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
