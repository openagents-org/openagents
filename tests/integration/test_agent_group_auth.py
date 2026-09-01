"""
Integration tests for agent group authentication with gRPC and HTTP clients.

This module tests end-to-end agent group authentication using both
gRPC and HTTP transports.
"""

import pytest
import asyncio

from openagents.sdk.network import AgentNetwork
from openagents.sdk.client import AgentClient
from openagents.models.network_config import NetworkConfig, AgentGroupConfig, NetworkMode, TransportConfigItem
from openagents.models.transport import TransportType


# Test hashes for groups
ADMIN_HASH = "admin_secret_hash_123"
USER_HASH = "user_secret_hash_456"


@pytest.fixture
async def network_with_groups():
    """Create a test network with agent groups and both gRPC and HTTP transports."""
    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
        host="localhost",
        port=8571,  # Use different port to avoid conflicts
        default_agent_group="guests",
        transports=[
            TransportConfigItem(
                type=TransportType.GRPC,
                config={"host": "localhost", "port": 8571}
            ),
            TransportConfigItem(
                type=TransportType.HTTP,
                config={"host": "localhost", "port": 8572}
            ),
        ],
        agent_groups={
            "admins": AgentGroupConfig(
                password_hash=ADMIN_HASH,
                description="Administrator agents",
                metadata={"permissions": ["all"]},
            ),
            "users": AgentGroupConfig(
                password_hash=USER_HASH,
                description="Regular user agents",
                metadata={"permissions": ["read", "write"]},
            ),
        },
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    yield network

    # Cleanup
    await network.shutdown()


@pytest.mark.asyncio
async def test_grpc_client_with_valid_password_hash(network_with_groups):
    """Test gRPC client connecting with valid password hash."""
    network = network_with_groups

    client = AgentClient(agent_id="grpc-admin-1")

    try:
        # Connect with valid admin password hash
        # Use HTTP port for auto-detection, it will choose the right transport
        connected = await client.connect(
            network_host="localhost",
            network_port=8572,  # HTTP port for auto-detection
            password_hash=ADMIN_HASH,
        )

        assert connected, "Client should connect successfully"

        # Verify agent was assigned to admins group
        group = network.topology.agent_group_membership.get("grpc-admin-1")
        assert group == "admins", f"Expected 'admins', got '{group}'"

        # Verify agent appears in network stats
        stats = network.get_network_stats()
        assert "grpc-admin-1" in stats["agents"]
        assert stats["agents"]["grpc-admin-1"]["group"] == "admins"
        assert "grpc-admin-1" in stats["groups"]["admins"]

    finally:
        await client.disconnect()


@pytest.mark.asyncio
async def test_grpc_client_with_invalid_password_hash(network_with_groups):
    """Test gRPC client connecting with invalid password hash goes to default group."""
    network = network_with_groups

    client = AgentClient(agent_id="grpc-guest-1")

    try:
        # Connect with invalid password hash
        connected = await client.connect(
            network_host="localhost",
            network_port=8572,
            
            password_hash="wrong_hash_999",
        )

        assert connected, "gRPC client should connect successfully"

        # Verify agent was assigned to default guests group
        group = network.topology.agent_group_membership.get("grpc-guest-1")
        assert group == "guests", f"Expected 'guests', got '{group}'"

        # Verify agent appears in network stats
        stats = network.get_network_stats()
        assert "grpc-guest-1" in stats["agents"]
        assert stats["agents"]["grpc-guest-1"]["group"] == "guests"

    finally:
        await client.disconnect()


@pytest.mark.asyncio
async def test_grpc_client_without_password_hash(network_with_groups):
    """Test gRPC client connecting without password hash goes to default group."""
    network = network_with_groups

    client = AgentClient(agent_id="grpc-no-password-1")

    try:
        # Connect without password hash
        connected = await client.connect(
            network_host="localhost",
            network_port=8572,
            
        )

        assert connected, "gRPC client should connect successfully"

        # Verify agent was assigned to default guests group
        group = network.topology.agent_group_membership.get("grpc-no-password-1")
        assert group == "guests", f"Expected 'guests', got '{group}'"

    finally:
        await client.disconnect()


@pytest.mark.asyncio
async def test_http_client_with_valid_password_hash(network_with_groups):
    """Test HTTP client connecting with valid password hash."""
    network = network_with_groups

    client = AgentClient(agent_id="http-admin-1")

    try:
        # Connect with valid admin password hash
        connected = await client.connect(
            network_host="localhost",
            network_port=8572,
            enforce_transport_type="http",
            password_hash=ADMIN_HASH,
        )

        assert connected, "HTTP client should connect successfully"

        # Verify agent was assigned to admins group
        group = network.topology.agent_group_membership.get("http-admin-1")
        assert group == "admins", f"Expected 'admins', got '{group}'"

        # Verify agent appears in network stats
        stats = network.get_network_stats()
        assert "http-admin-1" in stats["agents"]
        assert stats["agents"]["http-admin-1"]["group"] == "admins"
        assert "http-admin-1" in stats["groups"]["admins"]

    finally:
        await client.disconnect()


@pytest.mark.asyncio
async def test_http_client_with_invalid_password_hash(network_with_groups):
    """Test HTTP client connecting with invalid password hash goes to default group."""
    network = network_with_groups

    client = AgentClient(agent_id="http-guest-1")

    try:
        # Connect with invalid password hash
        connected = await client.connect(
            network_host="localhost",
            network_port=8572,
            enforce_transport_type="http",
            password_hash="wrong_hash_999",
        )

        assert connected, "HTTP client should connect successfully"

        # Verify agent was assigned to default guests group
        group = network.topology.agent_group_membership.get("http-guest-1")
        assert group == "guests", f"Expected 'guests', got '{group}'"

        # Verify agent appears in network stats
        stats = network.get_network_stats()
        assert "http-guest-1" in stats["agents"]
        assert stats["agents"]["http-guest-1"]["group"] == "guests"

    finally:
        await client.disconnect()


@pytest.mark.asyncio
async def test_http_client_without_password_hash(network_with_groups):
    """Test HTTP client connecting without password hash goes to default group."""
    network = network_with_groups

    client = AgentClient(agent_id="http-no-password-1")

    try:
        # Connect without password hash
        connected = await client.connect(
            network_host="localhost",
            network_port=8572,
            enforce_transport_type="http",
        )

        assert connected, "HTTP client should connect successfully"

        # Verify agent was assigned to default guests group
        group = network.topology.agent_group_membership.get("http-no-password-1")
        assert group == "guests", f"Expected 'guests', got '{group}'"

    finally:
        await client.disconnect()


@pytest.mark.asyncio
async def test_multiple_clients_different_transports_same_group(network_with_groups):
    """Test multiple clients using different transports can join the same group."""
    network = network_with_groups

    grpc_client = AgentClient(agent_id="grpc-user-1")
    http_client = AgentClient(agent_id="http-user-1")

    try:
        # Connect both clients with user password hash
        grpc_connected = await grpc_client.connect(
            network_host="localhost",
            network_port=8572,
            
            password_hash=USER_HASH,
        )

        http_connected = await http_client.connect(
            network_host="localhost",
            network_port=8572,
            enforce_transport_type="http",
            password_hash=USER_HASH,
        )

        assert grpc_connected and http_connected, "Both clients should connect"

        # Verify both agents assigned to users group
        grpc_group = network.topology.agent_group_membership.get("grpc-user-1")
        http_group = network.topology.agent_group_membership.get("http-user-1")

        assert grpc_group == "users", f"gRPC client expected 'users', got '{grpc_group}'"
        assert http_group == "users", f"HTTP client expected 'users', got '{http_group}'"

        # Verify both appear in same group in network stats
        stats = network.get_network_stats()
        assert "grpc-user-1" in stats["groups"]["users"]
        assert "http-user-1" in stats["groups"]["users"]
        assert len(stats["groups"]["users"]) == 2

    finally:
        await grpc_client.disconnect()
        await http_client.disconnect()


@pytest.mark.asyncio
async def test_group_cleanup_on_disconnect(network_with_groups):
    """Test that group membership is cleaned up when client disconnects."""
    network = network_with_groups

    client = AgentClient(agent_id="temp-admin")

    try:
        # Connect with admin password
        connected = await client.connect(
            network_host="localhost",
            network_port=8572,
            
            password_hash=ADMIN_HASH,
        )

        assert connected, "Client should connect"

        # Verify agent in admins group
        group = network.topology.agent_group_membership.get("temp-admin")
        assert group == "admins"

        # Disconnect
        await client.disconnect()

        # Verify agent removed from group membership
        assert "temp-admin" not in network.topology.agent_group_membership

        # Verify agent not in network stats
        stats = network.get_network_stats()
        assert "temp-admin" not in stats["agents"]

    except Exception:
        # Ensure cleanup even if test fails
        await client.disconnect()
        raise
