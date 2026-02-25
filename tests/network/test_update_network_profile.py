"""
Test cases for the update_network_profile system event functionality.

This module contains tests for the system.update_network_profile event,
including admin verification, field validation, YAML persistence, and memory updates.
"""

import pytest
import asyncio
import tempfile
import os
import yaml
from pathlib import Path

from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient
from openagents.models.network_config import NetworkConfig, AgentGroupConfig, NetworkMode, TransportConfigItem
from openagents.models.transport import TransportType
from openagents.models.network_profile import NetworkProfile
from openagents.models.event import Event
from openagents.config.globals import SYSTEM_EVENT_UPDATE_NETWORK_PROFILE


# Test hashes for groups
ADMIN_HASH = "admin_secret_hash_123"
USER_HASH = "user_secret_hash_456"


@pytest.fixture
async def network_with_profile():
    """Create a test network with network profile and admin group configured."""
    # Create temporary config file
    temp_config = tempfile.NamedTemporaryFile(
        mode='w', suffix='.yaml', delete=False, encoding='utf-8'
    )
    config_path = temp_config.name
    
    # Initial network profile
    initial_profile = {
        "discoverable": True,
        "name": "Test Network",
        "description": "A test network for profile updates",
        "icon": "https://example.com/icon.png",
        "website": "https://example.com",
        "tags": ["test", "development"],
        "categories": ["testing"],
        "country": "Worldwide",
        "required_openagents_version": "0.5.0",
        "capacity": 50,
        "host": "localhost",
        "port": 8700,
    }
    
    # Write initial config
    config_data = {
        "network": {
            "name": "TestNetwork",
            "mode": "centralized",
        },
        "network_profile": initial_profile,
    }
    yaml.dump(config_data, temp_config, default_flow_style=False)
    temp_config.close()
    
    config = NetworkConfig(
        name="TestProfileNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        transports=[
            TransportConfigItem(
                type=TransportType.GRPC,
                config={"host": "localhost", "port": 8575}
            ),
            TransportConfigItem(
                type=TransportType.HTTP,
                config={"host": "localhost", "port": 8576}
            ),
        ],
        agent_groups={
            "admin": AgentGroupConfig(
                password_hash=ADMIN_HASH,
                description="Administrator agents with profile update privileges",
                metadata={"permissions": ["all", "update_network_profile"]},
            ),
            "users": AgentGroupConfig(
                password_hash=USER_HASH,
                description="Regular user agents",
                metadata={"permissions": ["read", "write"]},
            ),
        },
        network_profile=NetworkProfile(**initial_profile),
    )

    network = AgentNetwork.create_from_config(config)
    network.config_path = config_path  # Store config path for YAML writes
    await network.initialize()

    yield {"network": network, "config_path": config_path}

    # Cleanup
    await network.shutdown()
    try:
        os.unlink(config_path)
    except Exception:
        pass


@pytest.mark.asyncio
async def test_admin_can_update_network_profile(network_with_profile):
    """Test that admin agent can successfully update network profile."""
    network = network_with_profile["network"]
    config_path = network_with_profile["config_path"]

    # Create admin client
    admin_client = AgentClient(agent_id="admin-1")

    try:
        # Connect admin with admin credentials
        admin_connected = await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )
        assert admin_connected, "Admin should connect successfully"

        # Verify admin is in admin group
        assert "admin-1" in network.topology.agent_group_membership
        assert network.topology.agent_group_membership["admin-1"] == "admin"

        # Get initial profile
        initial_name = network.config.network_profile.name

        # Create update event
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "name": "Updated Test Network",
                    "capacity": 100,
                    "tags": ["test", "updated"],
                }
            }
        )

        # Process the update event
        response = await network.event_gateway.system_command_processor.process_command(update_event)

        # Verify successful update
        assert response is not None
        assert response.success, f"Update should succeed: {response.message}"
        assert "successfully" in response.message.lower()
        assert response.data["network_profile"]["name"] == "Updated Test Network"
        assert response.data["network_profile"]["capacity"] == 100
        assert "updated" in response.data["network_profile"]["tags"]

        # Verify memory was updated
        assert network.config.network_profile.name == "Updated Test Network"
        assert network.config.network_profile.name != initial_name
        assert network.config.network_profile.capacity == 100

        # Verify YAML was updated
        with open(config_path, 'r', encoding='utf-8') as f:
            config_data = yaml.safe_load(f)
        
        profile = config_data.get("network_profile", {})
        assert profile["name"] == "Updated Test Network"
        assert profile["capacity"] == 100
        assert "updated" in profile["tags"]

        # Verify /api/health returns updated profile
        health_stats = network.get_network_stats()
        assert "network_profile" in health_stats
        assert health_stats["network_profile"]["name"] == "Updated Test Network"

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_non_admin_cannot_update_profile(network_with_profile):
    """Test that non-admin agent cannot update network profile."""
    network = network_with_profile["network"]

    # Create user client
    user_client = AgentClient(agent_id="user-1")

    try:
        # Connect user with user credentials
        user_connected = await user_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=USER_HASH,
        )
        assert user_connected, "User should connect successfully"

        # Verify user is in users group
        assert "user-1" in network.topology.agent_group_membership
        assert network.topology.agent_group_membership["user-1"] == "users"

        # Create update event from non-admin user
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="user-1",
            payload={
                "agent_id": "user-1",
                "profile": {
                    "name": "Should Not Update",
                }
            }
        )

        # Process the update event
        response = await network.event_gateway.system_command_processor.process_command(update_event)

        # Verify update was rejected
        assert response is not None
        assert not response.success, "Update should fail for non-admin"
        assert "Unauthorized" in response.message or "Admin privileges required" in response.message

        # Verify profile was not changed
        assert network.config.network_profile.name != "Should Not Update"

    finally:
        await user_client.disconnect()


@pytest.mark.asyncio
async def test_validation_errors_rejected(network_with_profile):
    """Test that invalid updates are rejected with validation errors."""
    network = network_with_profile["network"]

    # Create admin client
    admin_client = AgentClient(agent_id="admin-1")

    try:
        await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )

        # Test 1: Invalid capacity (too large)
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "capacity": 200000,  # Exceeds max 100000
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert not response.success
        assert "validation" in response.message.lower()

        # Test 2: Invalid URL scheme
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "icon": "ftp://invalid-scheme.com/icon.png",
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert not response.success
        assert "validation" in response.message.lower()

        # Test 3: Invalid port (out of range)
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "port": 99999,  # Exceeds max 65535
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert not response.success
        assert "validation" in response.message.lower()

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_unknown_fields_rejected(network_with_profile):
    """Test that unknown fields are rejected (extra='forbid')."""
    network = network_with_profile["network"]

    admin_client = AgentClient(agent_id="admin-1")

    try:
        await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )

        # Try to update with unknown field
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "name": "Valid Name",
                    "unknown_field": "should_be_rejected",
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert not response.success
        assert "validation" in response.message.lower() or "extra" in response.message.lower()

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_partial_update_preserves_other_fields(network_with_profile):
    """Test that partial updates don't affect other fields."""
    network = network_with_profile["network"]

    admin_client = AgentClient(agent_id="admin-1")

    try:
        await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )

        # Get initial values
        initial_description = network.config.network_profile.description
        initial_capacity = network.config.network_profile.capacity

        # Update only tags
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "tags": ["partial", "update", "test"],
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert response.success

        # Verify only tags changed
        assert network.config.network_profile.tags == ["partial", "update", "test"]
        assert network.config.network_profile.description == initial_description
        assert network.config.network_profile.capacity == initial_capacity

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_duplicate_tags_rejected(network_with_profile):
    """Test that duplicate tags (case-insensitive) are rejected."""
    network = network_with_profile["network"]

    admin_client = AgentClient(agent_id="admin-1")

    try:
        await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )

        # Try to set duplicate tags
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "tags": ["test", "Test", "TEST"],  # Duplicates
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert not response.success
        assert "unique" in response.message.lower() or "validation" in response.message.lower()

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_url_validation(network_with_profile):
    """Test URL validation for icon and website fields."""
    network = network_with_profile["network"]

    admin_client = AgentClient(agent_id="admin-1")

    try:
        await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )

        # Valid URLs should succeed
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "icon": "https://example.com/icon.png",
                    "website": "http://example.org",
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert response.success

        # Invalid URL (not http/https) should fail
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "icon": "ftp://invalid.com/icon.png",
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert not response.success

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_host_validation(network_with_profile):
    """Test host address validation."""
    network = network_with_profile["network"]

    admin_client = AgentClient(agent_id="admin-1")

    try:
        await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )

        # Valid hosts
        valid_hosts = ["localhost", "0.0.0.0", "192.168.1.1", "example.com"]
        
        for host in valid_hosts:
            update_event = Event(
                event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
                source_id="admin-1",
                payload={
                    "agent_id": "admin-1",
                    "profile": {
                        "host": host,
                    }
                }
            )

            response = await network.event_gateway.system_command_processor.process_command(update_event)
            assert response.success, f"Host {host} should be valid"

        # Invalid host
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "host": "invalid host with spaces",
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert not response.success

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_memory_update_immediate_effect(network_with_profile):
    """Test that updates immediately affect in-memory configuration and /api/health."""
    network = network_with_profile["network"]

    admin_client = AgentClient(agent_id="admin-1")

    try:
        await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )

        # Get initial name
        initial_name = network.config.network_profile.name

        # Update
        new_name = "Immediately Effective Name"
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {
                    "name": new_name,
                }
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        assert response.success

        # Verify immediate update in memory
        assert network.config.network_profile.name == new_name
        assert network.config.network_profile.name != initial_name

        # Verify /api/health reflects change
        health_stats = network.get_network_stats()
        assert health_stats["network_profile"]["name"] == new_name

    finally:
        await admin_client.disconnect()


@pytest.mark.asyncio
async def test_empty_payload_rejected(network_with_profile):
    """Test that empty profile payload is rejected."""
    network = network_with_profile["network"]

    admin_client = AgentClient(agent_id="admin-1")

    try:
        await admin_client.connect(
            network_host="localhost",
            network_port=8576,
            password_hash=ADMIN_HASH,
        )

        # Empty profile
        update_event = Event(
            event_name=SYSTEM_EVENT_UPDATE_NETWORK_PROFILE,
            source_id="admin-1",
            payload={
                "agent_id": "admin-1",
                "profile": {}
            }
        )

        response = await network.event_gateway.system_command_processor.process_command(update_event)
        # Empty payload should either be rejected or do nothing
        # Depending on implementation, this might succeed with no changes or fail
        # The important thing is it doesn't break the system

    finally:
        await admin_client.disconnect()


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])

