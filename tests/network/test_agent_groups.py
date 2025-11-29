"""
Test cases for the agent groups system.

This module contains tests for agent group configuration, authentication,
and permission management.
"""

import pytest
import asyncio

from openagents.core.network import AgentNetwork
from openagents.models.network_config import NetworkConfig, AgentGroupConfig, NetworkMode
from openagents.models.transport import TransportType

# Predefined password hashes for testing
MODERATOR_HASH = "mod_hash_12345"
USER_HASH = "user_hash_67890"


@pytest.fixture
async def network_with_groups():
    """Create a test network with agent groups configured."""
    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        agent_groups={
            "moderators": AgentGroupConfig(
                password_hash=MODERATOR_HASH,
                description="Forum moderators with elevated permissions",
                metadata={"permissions": ["delete_posts", "ban_users", "manage_channels"]},
            ),
            "users": AgentGroupConfig(
                password_hash=USER_HASH,
                description="Regular user agents",
                metadata={"permissions": ["post_messages", "read_channels"]},
            ),
        },
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    yield network

    # Cleanup
    await network.shutdown()


@pytest.mark.asyncio
async def test_password_based_authentication(network_with_groups):
    """Test password-based group authentication."""
    network = network_with_groups

    # Register agent with valid moderator password hash
    response = await network.register_agent(
        agent_id="mod-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Moderator Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=MODERATOR_HASH,
    )

    assert response.success, f"Registration failed: {response.message}"

    # Verify agent was assigned to moderators group
    group = network.topology.agent_group_membership.get("mod-agent-1")
    assert group == "moderators", f"Expected 'moderators', got '{group}'"

    # Verify group metadata is preserved
    stats = network.get_network_stats()
    mod_group_config = next(
        (g for g in stats["group_config"] if g["name"] == "moderators"), None
    )
    assert mod_group_config is not None
    assert mod_group_config["description"] == "Forum moderators with elevated permissions"
    assert mod_group_config["metadata"]["permissions"] == [
        "delete_posts",
        "ban_users",
        "manage_channels",
    ]


@pytest.mark.asyncio
async def test_invalid_password_authentication(network_with_groups):
    """Test that invalid passwords assign agents to default group."""
    network = network_with_groups

    # Register agent with invalid password
    response = await network.register_agent(
        agent_id="invalid-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Invalid Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash="WrongPassword123!",
    )

    assert response.success, f"Registration failed: {response.message}"

    # Verify agent was assigned to default group (guests)
    group = network.topology.agent_group_membership.get("invalid-agent-1")
    assert group == "guests", f"Expected 'guests', got '{group}'"


@pytest.mark.asyncio
async def test_no_credentials_authentication(network_with_groups):
    """Test that agents without credentials go to default group."""
    network = network_with_groups

    # Register agent without any credentials
    response = await network.register_agent(
        agent_id="guest-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Guest Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=None,
    )

    assert response.success, f"Registration failed: {response.message}"

    # Verify agent was assigned to default group (guests)
    group = network.topology.agent_group_membership.get("guest-agent-1")
    assert group == "guests", f"Expected 'guests', got '{group}'"


@pytest.mark.asyncio
async def test_multiple_agents_same_group(network_with_groups):
    """Test multiple agents can join the same group."""
    network = network_with_groups

    # Register multiple users with same password
    for i in range(3):
        response = await network.register_agent(
            agent_id=f"user-agent-{i}",
            transport_type=TransportType.HTTP,
            metadata={"name": f"User Agent {i}"},
            certificate=None,
            force_reconnect=False,
            password_hash=USER_HASH,
        )
        assert response.success

    # Verify all were assigned to users group
    for i in range(3):
        group = network.topology.agent_group_membership.get(f"user-agent-{i}")
        assert group == "users", f"Agent {i} expected 'users', got '{group}'"

    # Verify network stats show correct counts
    stats = network.get_network_stats()
    assert "users" in stats["groups"]
    assert len(stats["groups"]["users"]) == 3


@pytest.mark.asyncio
async def test_configurable_default_group():
    """Test that default_agent_group configuration is respected."""
    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="anonymous",  # Custom default group name
        agent_groups={},
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    try:
        # Register agent without credentials
        response = await network.register_agent(
            agent_id="test-agent",
            transport_type=TransportType.HTTP,
            metadata={"name": "Test Agent"},
            certificate=None,
            force_reconnect=False,
            password_hash=None,
        )

        assert response.success

        # Verify agent was assigned to custom default group
        group = network.topology.agent_group_membership.get("test-agent")
        assert group == "anonymous", f"Expected 'anonymous', got '{group}'"

        # Verify network stats use custom default group name
        stats = network.get_network_stats()
        assert "anonymous" in stats["groups"]
        assert "default" not in stats["groups"]

    finally:
        await network.shutdown()


@pytest.mark.asyncio
async def test_group_cleanup_on_unregister(network_with_groups):
    """Test that group membership is cleaned up when agent unregisters."""
    network = network_with_groups

    # Register agent
    response = await network.register_agent(
        agent_id="temp-agent",
        transport_type=TransportType.HTTP,
        metadata={"name": "Temporary Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=MODERATOR_HASH,
    )

    assert response.success

    # Verify agent is in moderators group
    group = network.topology.agent_group_membership.get("temp-agent")
    assert group == "moderators"

    # Unregister agent
    unregister_response = await network.unregister_agent("temp-agent")
    assert unregister_response.success

    # Verify agent is removed from group membership
    assert "temp-agent" not in network.topology.agent_group_membership

    # Verify network stats don't include the agent
    stats = network.get_network_stats()
    assert "temp-agent" not in stats["agents"]


@pytest.mark.asyncio
async def test_requires_password_valid_password(network_with_groups):
    """Test that requires_password=True allows valid password."""
    # Create network with requires_password=True
    config = NetworkConfig(
        name="SecureNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        requires_password=True,
        agent_groups={
            "users": AgentGroupConfig(
                password_hash=USER_HASH,
                description="Regular user agents",
                metadata={"permissions": ["post_messages"]},
            ),
        },
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    # Register agent with valid password
    response = await network.register_agent(
        agent_id="user-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "User 1"},
        certificate=None,
        password_hash=USER_HASH,
    )

    assert response.success
    assert network.topology.agent_group_membership.get("user-1") == "users"

    await network.shutdown()


@pytest.mark.asyncio
async def test_requires_password_no_password():
    """Test that requires_password=True rejects agents without password."""
    # Create network with requires_password=True
    config = NetworkConfig(
        name="SecureNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        requires_password=True,
        agent_groups={
            "users": AgentGroupConfig(
                password_hash=USER_HASH,
                description="Regular user agents",
                metadata={"permissions": ["post_messages"]},
            ),
        },
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    # Register agent without password
    response = await network.register_agent(
        agent_id="user-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "User 1"},
        certificate=None,
        password_hash=None,
    )

    assert not response.success
    assert "Password authentication required" in response.message
    assert "user-1" not in network.topology.agent_group_membership

    await network.shutdown()


@pytest.mark.asyncio
async def test_requires_password_invalid_password():
    """Test that requires_password=True rejects agents with invalid password."""
    # Create network with requires_password=True
    config = NetworkConfig(
        name="SecureNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        requires_password=True,
        agent_groups={
            "users": AgentGroupConfig(
                password_hash=USER_HASH,
                description="Regular user agents",
                metadata={"permissions": ["post_messages"]},
            ),
        },
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    # Register agent with invalid password
    response = await network.register_agent(
        agent_id="user-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "User 1"},
        certificate=None,
        password_hash="wrong_password_hash",
    )

    assert not response.success
    assert "Password authentication required" in response.message
    assert "user-1" not in network.topology.agent_group_membership

    await network.shutdown()


@pytest.mark.asyncio
async def test_requires_password_false_no_password(network_with_groups):
    """Test that requires_password=False allows agents without password (default group)."""
    network = network_with_groups

    # Verify requires_password is False
    assert network.config.requires_password is False

    # Register agent without password
    response = await network.register_agent(
        agent_id="guest-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Guest 1"},
        certificate=None,
        password_hash=None,
    )

    assert response.success
    assert network.topology.agent_group_membership.get("guest-1") == "guests"


@pytest.mark.asyncio
async def test_network_stats_group_info(network_with_groups):
    """Test that network stats correctly report group information."""
    network = network_with_groups

    # Register agents in different groups
    await network.register_agent(
        agent_id="mod-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Moderator 1"},
        certificate=None,
        password_hash=MODERATOR_HASH,
    )

    await network.register_agent(
        agent_id="user-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "User 1"},
        certificate=None,
        password_hash=USER_HASH,
    )

    await network.register_agent(
        agent_id="guest-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Guest 1"},
        certificate=None,
        password_hash=None,
    )

    # Get network stats
    stats = network.get_network_stats()

    # Verify groups dictionary is populated correctly
    assert "moderators" in stats["groups"]
    assert "users" in stats["groups"]
    assert "guests" in stats["groups"]

    assert "mod-1" in stats["groups"]["moderators"]
    assert "user-1" in stats["groups"]["users"]
    assert "guest-1" in stats["groups"]["guests"]

    # Verify group_config array includes all groups
    group_names = [g["name"] for g in stats["group_config"]]
    assert "moderators" in group_names
    assert "users" in group_names
    assert "guests" in group_names  # Default group should be included

    # Verify agent count is correct in group_config
    mod_config = next(g for g in stats["group_config"] if g["name"] == "moderators")
    assert mod_config["agent_count"] == 1

    # Verify each agent has group info
    assert stats["agents"]["mod-1"]["group"] == "moderators"
    assert stats["agents"]["user-1"]["group"] == "users"
    assert stats["agents"]["guest-1"]["group"] == "guests"


@pytest.mark.asyncio
async def test_group_metadata_not_exposed_in_stats(network_with_groups):
    """Test that sensitive group data (tokens, passwords) is not exposed in stats."""
    network = network_with_groups

    stats = network.get_network_stats()

    # Verify group_config doesn't include password_hashes
    for group_cfg in stats["group_config"]:
        assert "password_hash" not in group_cfg

        # But metadata should be included
        if group_cfg["name"] == "moderators":
            assert "metadata" in group_cfg
            assert "permissions" in group_cfg["metadata"]


# ==== Tests for Explicit Group Selection Feature ====


@pytest.mark.asyncio
async def test_explicit_group_selection_with_correct_password(network_with_groups):
    """Test explicit group selection with the correct password."""
    network = network_with_groups

    # Register agent with explicit group and correct password
    response = await network.register_agent(
        agent_id="explicit-mod-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Explicit Moderator"},
        certificate=None,
        force_reconnect=False,
        password_hash=MODERATOR_HASH,
        requested_group="moderators",
    )

    assert response.success, f"Registration failed: {response.message}"
    assert response.data.get("assigned_group") == "moderators"

    # Verify agent was assigned to moderators group
    group = network.topology.agent_group_membership.get("explicit-mod-1")
    assert group == "moderators", f"Expected 'moderators', got '{group}'"


@pytest.mark.asyncio
async def test_explicit_group_selection_with_wrong_password(network_with_groups):
    """Test explicit group selection with wrong password is rejected."""
    network = network_with_groups

    # Register agent with explicit group but wrong password
    response = await network.register_agent(
        agent_id="wrong-password-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Wrong Password Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash="wrong_password_hash",
        requested_group="moderators",
    )

    assert not response.success, "Registration should have failed with wrong password"
    assert "moderators" in response.message, f"Expected group name in error message, got: {response.message}"
    assert "wrong-password-1" not in network.topology.agent_group_membership


@pytest.mark.asyncio
async def test_explicit_group_selection_without_password_when_required(network_with_groups):
    """Test explicit group selection without password when group requires it."""
    network = network_with_groups

    # Register agent with explicit group but no password (group requires password)
    response = await network.register_agent(
        agent_id="no-password-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "No Password Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=None,
        requested_group="moderators",
    )

    assert not response.success, "Registration should have failed without password"
    assert "no-password-1" not in network.topology.agent_group_membership


@pytest.mark.asyncio
async def test_explicit_group_selection_invalid_group_name(network_with_groups):
    """Test explicit group selection with non-existent group name."""
    network = network_with_groups

    # Register agent with non-existent group
    response = await network.register_agent(
        agent_id="invalid-group-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Invalid Group Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=MODERATOR_HASH,
        requested_group="nonexistent_group",
    )

    assert not response.success, "Registration should have failed with invalid group"
    assert "invalid-group-1" not in network.topology.agent_group_membership


@pytest.mark.asyncio
async def test_explicit_group_selection_default_group_no_password(network_with_groups):
    """Test explicit selection of default group without password."""
    network = network_with_groups

    # Register agent with explicit default group selection (no password needed)
    response = await network.register_agent(
        agent_id="explicit-guest-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Explicit Guest"},
        certificate=None,
        force_reconnect=False,
        password_hash=None,
        requested_group="guests",  # Default group
    )

    assert response.success, f"Registration failed: {response.message}"
    assert response.data.get("assigned_group") == "guests"

    # Verify agent was assigned to guests group
    group = network.topology.agent_group_membership.get("explicit-guest-1")
    assert group == "guests", f"Expected 'guests', got '{group}'"


@pytest.mark.asyncio
async def test_legacy_registration_still_works(network_with_groups):
    """Test that legacy registration without explicit group still works."""
    network = network_with_groups

    # Register agent without explicit group (legacy behavior)
    response = await network.register_agent(
        agent_id="legacy-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Legacy Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=USER_HASH,
        # No requested_group - should use legacy password matching
    )

    assert response.success, f"Registration failed: {response.message}"

    # Verify agent was assigned to users group via password matching
    group = network.topology.agent_group_membership.get("legacy-agent-1")
    assert group == "users", f"Expected 'users', got '{group}'"


@pytest.mark.asyncio
async def test_network_stats_has_password_field(network_with_groups):
    """Test that network stats include has_password field for groups."""
    network = network_with_groups

    stats = network.get_network_stats()

    # Verify has_password field is present for each group
    for group_cfg in stats["group_config"]:
        assert "has_password" in group_cfg, f"Missing has_password for group {group_cfg['name']}"

        if group_cfg["name"] == "moderators":
            assert group_cfg["has_password"] is True
        elif group_cfg["name"] == "users":
            assert group_cfg["has_password"] is True
        elif group_cfg["name"] == "guests":
            assert group_cfg["has_password"] is False


@pytest.mark.asyncio
async def test_explicit_group_without_password_requirement():
    """Test explicit group selection for default group which doesn't require password."""
    # Create network with groups that require password - we'll test selecting the default group
    config = NetworkConfig(
        name="TestNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        agent_groups={
            "premium": AgentGroupConfig(
                password_hash=USER_HASH,
                description="Premium users",
                metadata={},
            ),
        },
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    try:
        # Register agent with explicit default group selection (no password needed)
        response = await network.register_agent(
            agent_id="guest-agent-1",
            transport_type=TransportType.HTTP,
            metadata={"name": "Guest Agent"},
            certificate=None,
            force_reconnect=False,
            password_hash=None,
            requested_group="guests",  # Select default group explicitly
        )

        assert response.success, f"Registration failed: {response.message}"
        assert response.data.get("assigned_group") == "guests"

        # Verify agent was assigned to guests group
        group = network.topology.agent_group_membership.get("guest-agent-1")
        assert group == "guests", f"Expected 'guests', got '{group}'"

    finally:
        await network.shutdown()
