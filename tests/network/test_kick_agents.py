"""
Test cases for the kick_agent system event functionality.

This module contains tests for the system.kick_agent event and system.agent_kicked 
notification, including admin verification, target validation, and proper event broadcasting.
"""

import pytest
import asyncio
import time

from openagents.sdk.network import AgentNetwork
from openagents.sdk.client import AgentClient
from openagents.models.network_config import NetworkConfig, AgentGroupConfig, NetworkMode, TransportConfigItem
from openagents.models.transport import TransportType
from openagents.models.event import Event
from openagents.config.globals import SYSTEM_EVENT_KICK_AGENT, SYSTEM_NOTIFICATION_AGENT_KICKED


# Test hashes for groups
ADMIN_HASH = "admin_secret_hash_123"
USER_HASH = "user_secret_hash_456"
GUEST_HASH = "guest_secret_hash_789"


@pytest.fixture
async def network_with_admin_groups():
    """Create a test network with admin and user groups configured."""
    config = NetworkConfig(
        name="TestKickNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        requires_password=True,
        transports=[
            TransportConfigItem(
                type=TransportType.GRPC,
                config={"host": "localhost", "port": 8573}
            ),
            TransportConfigItem(
                type=TransportType.HTTP,
                config={"host": "localhost", "port": 8574}
            ),
        ],
        agent_groups={
            "admin": AgentGroupConfig(
                password_hash=ADMIN_HASH,
                description="Administrator agents with kick privileges",
                metadata={"permissions": ["all", "kick_agent"]},
            ),
            "users": AgentGroupConfig(
                password_hash=USER_HASH,
                description="Regular user agents",
                metadata={"permissions": ["read", "write"]},
            ),
            "guests": AgentGroupConfig(
                password_hash=GUEST_HASH,
                description="Guest agents with limited access",
                metadata={"permissions": ["read"]},
            ),
        },
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    yield network

    # Cleanup
    await network.shutdown()


@pytest.mark.asyncio
async def test_admin_can_kick_user_agent(network_with_admin_groups):
    """Test that admin agent can successfully kick a user agent."""
    network = network_with_admin_groups

    # Create admin and user clients
    admin_client = AgentClient(agent_id="admin-1")
    user_client = AgentClient(agent_id="user-1")

    try:
        # Connect admin with admin credentials
        admin_connected = await admin_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=ADMIN_HASH,
        )
        assert admin_connected, "Admin should connect successfully"

        # Connect user with user credentials
        user_connected = await user_client.connect(
            network_host="localhost", 
            network_port=8574,
            password_hash=USER_HASH,
        )
        assert user_connected, "User should connect successfully"

        # Verify both agents are registered and in correct groups
        assert "admin-1" in network.topology.agent_group_membership
        assert "user-1" in network.topology.agent_group_membership
        assert network.topology.agent_group_membership["admin-1"] == "admin"
        assert network.topology.agent_group_membership["user-1"] == "users"

        # Create kick event from admin
        kick_event = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "target_agent_id": "user-1"
            }
        )

        # Process the kick event
        response = await network.event_gateway.system_command_processor.process_command(kick_event)

        # Verify successful kick
        assert response is not None
        assert response.success, f"Kick should succeed: {response.message}"
        assert "Successfully kicked agent 'user-1'" in response.message
        assert response.data["target_agent_id"] == "user-1"
        assert response.data["kicked_by"] == "admin-1"

        # Verify user agent was removed from network
        assert "user-1" not in network.topology.agent_group_membership
        agent_registry = network.get_agent_registry()
        assert "user-1" not in agent_registry

        # Admin should still be connected
        assert "admin-1" in network.topology.agent_group_membership

    finally:
        await admin_client.disconnect()
        await user_client.disconnect()


@pytest.mark.asyncio
async def test_non_admin_cannot_kick_agent(network_with_admin_groups):
    """Test that non-admin agent cannot kick other agents."""
    network = network_with_admin_groups

    # Create two user clients
    user_client1 = AgentClient(agent_id="user-1")
    user_client2 = AgentClient(agent_id="user-2")

    try:
        # Connect both users
        user1_connected = await user_client1.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=USER_HASH,
        )
        user2_connected = await user_client2.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=USER_HASH,
        )
        assert user1_connected and user2_connected, "Users should connect successfully"

        # Verify both are in users group
        assert network.topology.agent_group_membership["user-1"] == "users"
        assert network.topology.agent_group_membership["user-2"] == "users"

        # Create kick event from non-admin user
        kick_event = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="user-1",
            payload={
                "agent_id": "user-1",
                "target_agent_id": "user-2"
            }
        )

        # Process the kick event
        response = await network.event_gateway.system_command_processor.process_command(kick_event)

        # Verify kick was denied
        assert response is not None
        assert not response.success, "Non-admin kick should fail"
        assert "Unauthorized: Admin privileges required" in response.message
        assert response.data["requesting_group"] == "users"

        # Verify target agent is still connected
        assert "user-2" in network.topology.agent_group_membership
        agent_registry = network.get_agent_registry()
        assert "user-2" in agent_registry

    finally:
        await user_client1.disconnect()
        await user_client2.disconnect()


@pytest.mark.asyncio
async def test_guest_cannot_kick_agent(network_with_admin_groups):
    """Test that guest agent cannot kick other agents."""
    network = network_with_admin_groups

    # Create guest and user clients
    guest_client = AgentClient(agent_id="guest-1")
    user_client = AgentClient(agent_id="user-1")

    try:
        # Connect guest with guest credentials (goes to default group)
        guest_connected = await guest_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=GUEST_HASH,
        )
        user_connected = await user_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=USER_HASH,
        )
        assert guest_connected and user_connected, "Clients should connect successfully"

        # Verify guest is in default group
        assert network.topology.agent_group_membership["guest-1"] == "guests"
        assert network.topology.agent_group_membership["user-1"] == "users"

        # Create kick event from guest
        kick_event = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="guest-1",
            payload={
                "agent_id": "guest-1",
                "target_agent_id": "user-1"
            }
        )

        # Process the kick event
        response = await network.event_gateway.system_command_processor.process_command(kick_event)

        # Verify kick was denied
        assert response is not None
        assert not response.success, "Guest kick should fail"
        assert "Unauthorized: Admin privileges required" in response.message
        assert response.data["requesting_group"] == "guests"

        # Verify target agent is still connected
        assert "user-1" in network.topology.agent_group_membership

    finally:
        await guest_client.disconnect()
        await user_client.disconnect()


@pytest.mark.asyncio
async def test_cannot_kick_nonexistent_agent(network_with_admin_groups):
    """Test that kicking a non-existent agent returns appropriate error."""
    network = network_with_admin_groups

    admin_client = AgentClient(agent_id="admin-1")

    try:
        # Connect admin
        admin_connected = await admin_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=ADMIN_HASH,
        )
        assert admin_connected, "Admin should connect successfully"

        # Create kick event for non-existent agent
        kick_event = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "target_agent_id": "nonexistent-agent"
            }
        )

        # Process the kick event
        response = await network.event_gateway.system_command_processor.process_command(kick_event)

        # Verify appropriate error
        assert response is not None
        assert not response.success, "Kick of non-existent agent should fail"
        assert "Target agent 'nonexistent-agent' not found" in response.message
        assert response.data["target_agent_id"] == "nonexistent-agent"

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_cannot_kick_self(network_with_admin_groups):
    """Test that agents cannot kick themselves."""
    network = network_with_admin_groups

    admin_client = AgentClient(agent_id="admin-1")

    try:
        # Connect admin
        admin_connected = await admin_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=ADMIN_HASH,
        )
        assert admin_connected, "Admin should connect successfully"

        # Create kick event for self
        kick_event = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "target_agent_id": "admin-1"
            }
        )

        # Process the kick event
        response = await network.event_gateway.system_command_processor.process_command(kick_event)

        # Verify self-kick was denied
        assert response is not None
        assert not response.success, "Self-kick should fail"
        assert "Cannot kick yourself" in response.message
        assert response.data["target_agent_id"] == "admin-1"

        # Verify admin is still connected
        assert "admin-1" in network.topology.agent_group_membership

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_kick_event_missing_target_agent_id(network_with_admin_groups):
    """Test kick event with missing target_agent_id parameter."""
    network = network_with_admin_groups

    admin_client = AgentClient(agent_id="admin-1")

    try:
        # Connect admin
        admin_connected = await admin_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=ADMIN_HASH,
        )
        assert admin_connected, "Admin should connect successfully"

        # Create kick event without target_agent_id
        kick_event = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                # Missing target_agent_id
            }
        )

        # Process the kick event
        response = await network.event_gateway.system_command_processor.process_command(kick_event)

        # Verify appropriate error
        assert response is not None
        assert not response.success, "Kick without target should fail"
        assert "Missing target_agent_id parameter" in response.message

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_admin_kick_multiple_agents(network_with_admin_groups):
    """Test that admin can kick multiple agents sequentially."""
    network = network_with_admin_groups

    # Create admin and multiple user clients
    admin_client = AgentClient(agent_id="admin-1")
    user_client1 = AgentClient(agent_id="user-1")
    user_client2 = AgentClient(agent_id="user-2")
    user_client3 = AgentClient(agent_id="user-3")

    try:
        # Connect all clients
        admin_connected = await admin_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=ADMIN_HASH,
        )
        user1_connected = await user_client1.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=USER_HASH,
        )
        user2_connected = await user_client2.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=USER_HASH,
        )
        user3_connected = await user_client3.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=USER_HASH,
        )

        assert all([admin_connected, user1_connected, user2_connected, user3_connected]), \
            "All clients should connect successfully"

        # Verify all are connected
        assert len(network.topology.agent_group_membership) == 4

        # Kick user-1
        kick_event1 = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "target_agent_id": "user-1"
            }
        )
        response1 = await network.event_gateway.system_command_processor.process_command(kick_event1)
        assert response1.success, "First kick should succeed"
        assert "user-1" not in network.topology.agent_group_membership

        # Kick user-2
        kick_event2 = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "target_agent_id": "user-2"
            }
        )
        response2 = await network.event_gateway.system_command_processor.process_command(kick_event2)
        assert response2.success, "Second kick should succeed"
        assert "user-2" not in network.topology.agent_group_membership

        # Verify admin and user-3 still connected
        assert "admin-1" in network.topology.agent_group_membership
        assert "user-3" in network.topology.agent_group_membership
        assert len(network.topology.agent_group_membership) == 2

    finally:
        await admin_client.disconnect()
        await user_client1.disconnect()
        await user_client2.disconnect()
        await user_client3.disconnect()


@pytest.mark.asyncio
async def test_kick_notification_event_structure(network_with_admin_groups):
    """Test that agent_kicked notification event has correct structure."""
    network = network_with_admin_groups

    admin_client = AgentClient(agent_id="admin-1")
    user_client = AgentClient(agent_id="user-1")

    # Capture broadcast events
    broadcast_events = []
    original_process_event = network.event_gateway.process_event

    async def capture_process_event(event, enable_delivery=True):
        broadcast_events.append(event)
        return await original_process_event(event, enable_delivery)

    network.event_gateway.process_event = capture_process_event

    try:
        # Connect clients
        admin_connected = await admin_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=ADMIN_HASH,
        )
        user_connected = await user_client.connect(
            network_host="localhost",
            network_port=8574,
            password_hash=USER_HASH,
        )
        assert admin_connected and user_connected, "Clients should connect successfully"

        # Clear any connection events
        broadcast_events.clear()

        # Record timestamp before kick for verification
        before_kick_time = int(time.time())

        # Kick user
        kick_event = Event(
            event_name=SYSTEM_EVENT_KICK_AGENT,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "target_agent_id": "user-1"
            }
        )
        response = await network.event_gateway.system_command_processor.process_command(kick_event)
        assert response.success, "Kick should succeed"

        # Find the agent_kicked notification event
        kicked_events = [e for e in broadcast_events if e.event_name == SYSTEM_NOTIFICATION_AGENT_KICKED]
        assert len(kicked_events) == 1, "Should have exactly one agent_kicked notification"

        kicked_event = kicked_events[0]

        # Verify event structure
        assert kicked_event.event_name == SYSTEM_NOTIFICATION_AGENT_KICKED
        assert kicked_event.source_id == "system"
        assert kicked_event.destination_id == "agent:broadcast"

        # Verify payload structure
        payload = kicked_event.payload
        assert payload["target_agent_id"] == "user-1"
        assert payload["kicked_by"] == "admin-1"
        assert payload["target_group"] == "users"
        assert payload["reason"] == "Kicked by admin"
        assert isinstance(payload["timestamp"], int)
        assert payload["timestamp"] >= before_kick_time

        # Verify text representation
        assert "Agent user-1 was kicked by admin admin-1" in kicked_event.text_representation

    finally:
        # Restore original process_event function
        network.event_gateway.process_event = original_process_event
        await admin_client.disconnect()
        await user_client.disconnect()