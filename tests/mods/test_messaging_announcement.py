"""
Tests for the Thread Messaging mod announcement feature.

This test suite verifies the announcement functionality:
1. Admin agents can set channel announcements
2. Non-admin agents cannot set announcements (forbidden)
3. Any agent can retrieve announcements
4. Empty announcements are handled correctly
"""

import pytest
import asyncio
import random
from pathlib import Path

from openagents.sdk.client import AgentClient
from openagents.sdk.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.utils.password_utils import hash_password


@pytest.fixture
async def announcement_test_network():
    """Create and start a network with thread messaging mod and admin group configured."""
    config_path = (
        Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    )

    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))

    # Update the gRPC transport port to avoid conflicts - Announcement test range: 42000-43999
    grpc_port = random.randint(42000, 43999)
    http_port = grpc_port + 2000  # HTTP port should be different

    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["port"] = grpc_port
        elif transport.type == "http":
            transport.config["port"] = http_port

    # Ensure admin group is configured in agent_groups
    # The workspace_test.yaml should have an admin group configured
    # If not, we can set it here for testing
    if "admin" not in config.network.agent_groups:
        from openagents.models.network_config import AgentGroupConfig
        config.network.agent_groups["admin"] = AgentGroupConfig(
            password_hash=hash_password("admin_password_123"),
            description="Admin group for testing",
            metadata={"permissions": ["manage_announcements"]}
        )

    # Create and initialize network
    network = create_network(config.network)
    await network.initialize()

    # Give network time to start up
    await asyncio.sleep(1.0)

    # Extract gRPC and HTTP ports for client connections
    grpc_port = None
    http_port = None
    for transport in config.network.transports:
        if transport.type == "grpc":
            grpc_port = transport.config.get("port")
        elif transport.type == "http":
            http_port = transport.config.get("port")

    yield network, config, grpc_port, http_port

    # Cleanup
    try:
        await network.shutdown()
    except Exception as e:
        print(f"Error during network shutdown: {e}")


@pytest.fixture
async def admin_client(announcement_test_network):
    """Create an admin client for announcement tests."""
    network, config, grpc_port, http_port = announcement_test_network

    # Connect as admin with admin password hash
    admin_password_hash = None
    if "admin" in config.network.agent_groups:
        admin_password_hash = config.network.agent_groups["admin"].password_hash

    client = AgentClient(agent_id="admin_user")
    # Enforce HTTP transport to avoid gRPC connection issues in CI
    await client.connect("localhost", http_port, password_hash=admin_password_hash, enforce_transport_type="http")

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting admin_user: {e}")


@pytest.fixture
async def regular_client(announcement_test_network):
    """Create a regular (non-admin) client for announcement tests."""
    network, config, grpc_port, http_port = announcement_test_network

    client = AgentClient(agent_id="regular_user")
    # Enforce HTTP transport to avoid gRPC connection issues in CI
    await client.connect("localhost", http_port, enforce_transport_type="http")

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting regular_user: {e}")


@pytest.mark.asyncio
async def test_non_admin_cannot_set_announcement(regular_client):
    """Test that non-admin agents cannot set announcements (expect forbidden)."""

    print("🔍 Testing non-admin agent attempting to set announcement...")

    # Regular user attempts to set announcement
    set_event = Event(
        event_name="thread.announcement.set",
        source_id="regular_user",
        payload={
            "channel": "general",
            "text": "This should be forbidden!",
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Regular user attempting to set announcement...")
    response = await regular_client.send_event(set_event)

    # Verify response indicates forbidden
    assert response is not None, "Should receive a response"
    assert isinstance(response, EventResponse), "Response should be EventResponse"
    assert response.success == False, "Non-admin should not be allowed to set announcement"
    assert response.message == "forbidden", f"Expected 'forbidden' message, got '{response.message}'"

    print("✅ Non-admin forbidden test PASSED")
    print(f"   Regular user correctly rejected: {response.message}")
    print(f"   Response data: {response.data}")


@pytest.mark.asyncio
async def test_admin_can_set_and_get_announcement(admin_client):
    """Test that admin agents can set and retrieve announcements correctly."""

    print("🔍 Testing admin agent setting and getting announcement...")

    # Admin sets announcement
    announcement_text = "Welcome to the general channel! Please read the rules."
    set_event = Event(
        event_name="thread.announcement.set",
        source_id="admin_user",
        payload={
            "channel": "general",
            "text": announcement_text,
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Admin user setting announcement...")
    set_response = await admin_client.send_event(set_event)

    # Verify set was successful
    assert set_response is not None, "Should receive a response for set"
    assert isinstance(set_response, EventResponse), "Response should be EventResponse"
    assert set_response.success == True, f"Admin should be able to set announcement: {set_response.message}"
    assert set_response.message == "ok", f"Expected 'ok' message, got '{set_response.message}'"
    assert set_response.data is not None, "Response should include data"
    assert set_response.data.get("channel") == "general", "Response should include channel"
    assert set_response.data.get("text") == announcement_text, "Response should include announcement text"

    print("✅ Admin set announcement successfully")
    print(f"   Announcement: {announcement_text}")

    # Admin retrieves announcement
    get_event = Event(
        event_name="thread.announcement.get",
        source_id="admin_user",
        payload={
            "channel": "general",
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Admin user retrieving announcement...")
    get_response = await admin_client.send_event(get_event)

    # Verify get was successful and text matches
    assert get_response is not None, "Should receive a response for get"
    assert isinstance(get_response, EventResponse), "Response should be EventResponse"
    assert get_response.success == True, f"Should be able to get announcement: {get_response.message}"
    assert get_response.message == "ok", f"Expected 'ok' message, got '{get_response.message}'"
    assert get_response.data is not None, "Response should include data"
    assert get_response.data.get("text") == announcement_text, f"Retrieved text should match: expected '{announcement_text}', got '{get_response.data.get('text')}'"

    print("✅ Admin can set and get announcement test PASSED")
    print(f"   Set announcement: {announcement_text}")
    print(f"   Retrieved announcement: {get_response.data.get('text')}")


@pytest.mark.asyncio
async def test_regular_user_can_get_announcement(admin_client, regular_client):
    """Test that regular users can retrieve announcements set by admin."""

    print("🔍 Testing regular user retrieving admin-set announcement...")

    # Admin sets announcement first
    announcement_text = "Important: Server maintenance tonight at 10 PM."
    set_event = Event(
        event_name="thread.announcement.set",
        source_id="admin_user",
        payload={
            "channel": "support",
            "text": announcement_text,
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Admin user setting announcement...")
    set_response = await admin_client.send_event(set_event)
    assert set_response.success == True, "Admin should be able to set announcement"

    # Regular user retrieves announcement
    get_event = Event(
        event_name="thread.announcement.get",
        source_id="regular_user",
        payload={
            "channel": "support",
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Regular user retrieving announcement...")
    get_response = await regular_client.send_event(get_event)

    # Verify regular user can retrieve announcement
    assert get_response is not None, "Should receive a response"
    assert isinstance(get_response, EventResponse), "Response should be EventResponse"
    assert get_response.success == True, f"Regular user should be able to get announcement: {get_response.message}"
    assert get_response.message == "ok", f"Expected 'ok' message, got '{get_response.message}'"
    assert get_response.data.get("text") == announcement_text, f"Retrieved text should match: expected '{announcement_text}', got '{get_response.data.get('text')}'"

    print("✅ Regular user can get announcement test PASSED")
    print(f"   Admin set: {announcement_text}")
    print(f"   Regular user retrieved: {get_response.data.get('text')}")


@pytest.mark.asyncio
async def test_get_nonexistent_announcement(regular_client):
    """Test that getting a non-existent announcement returns empty string."""

    print("🔍 Testing retrieval of non-existent announcement...")

    # Try to get announcement for channel with no announcement set
    get_event = Event(
        event_name="thread.announcement.get",
        source_id="regular_user",
        payload={
            "channel": "nonexistent_channel",
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Regular user retrieving non-existent announcement...")
    get_response = await regular_client.send_event(get_event)

    # Verify returns success with empty text
    assert get_response is not None, "Should receive a response"
    assert isinstance(get_response, EventResponse), "Response should be EventResponse"
    assert get_response.success == True, f"Should succeed even for non-existent announcement: {get_response.message}"
    assert get_response.message == "ok", f"Expected 'ok' message, got '{get_response.message}'"
    assert get_response.data.get("text") == "", f"Expected empty string, got '{get_response.data.get('text')}'"

    print("✅ Non-existent announcement test PASSED")
    print(f"   Retrieved text: '{get_response.data.get('text')}' (empty string)")


@pytest.mark.asyncio
async def test_admin_can_update_announcement(admin_client):
    """Test that admin can update an existing announcement."""

    print("🔍 Testing admin updating announcement...")

    # Admin sets initial announcement
    initial_text = "Initial announcement"
    set_event = Event(
        event_name="thread.announcement.set",
        source_id="admin_user",
        payload={
            "channel": "dev",
            "text": initial_text,
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Admin user setting initial announcement...")
    set_response = await admin_client.send_event(set_event)
    assert set_response.success == True, "Admin should be able to set initial announcement"

    # Admin updates announcement
    updated_text = "Updated announcement with new information"
    update_event = Event(
        event_name="thread.announcement.set",
        source_id="admin_user",
        payload={
            "channel": "dev",
            "text": updated_text,
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Admin user updating announcement...")
    update_response = await admin_client.send_event(update_event)
    assert update_response.success == True, "Admin should be able to update announcement"

    # Verify announcement is updated
    get_event = Event(
        event_name="thread.announcement.get",
        source_id="admin_user",
        payload={
            "channel": "dev",
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    get_response = await admin_client.send_event(get_event)
    assert get_response.success == True, "Should be able to get updated announcement"
    assert get_response.data.get("text") == updated_text, f"Should get updated text: expected '{updated_text}', got '{get_response.data.get('text')}'"

    print("✅ Admin can update announcement test PASSED")
    print(f"   Initial: {initial_text}")
    print(f"   Updated: {updated_text}")
    print(f"   Retrieved: {get_response.data.get('text')}")


@pytest.mark.asyncio
async def test_admin_can_clear_announcement(admin_client):
    """Test that admin can clear an announcement by setting it to empty string."""

    print("🔍 Testing admin clearing announcement...")

    # Admin sets announcement
    set_event = Event(
        event_name="thread.announcement.set",
        source_id="admin_user",
        payload={
            "channel": "test_channel",
            "text": "This will be cleared",
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Admin user setting announcement...")
    set_response = await admin_client.send_event(set_event)
    assert set_response.success == True, "Admin should be able to set announcement"

    # Admin clears announcement by setting empty text
    clear_event = Event(
        event_name="thread.announcement.set",
        source_id="admin_user",
        payload={
            "channel": "test_channel",
            "text": "",
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    print("📤 Admin user clearing announcement...")
    clear_response = await admin_client.send_event(clear_event)
    assert clear_response.success == True, "Admin should be able to clear announcement"

    # Verify announcement is cleared
    get_event = Event(
        event_name="thread.announcement.get",
        source_id="admin_user",
        payload={
            "channel": "test_channel",
        },
        relevant_mod="openagents.mods.workspace.messaging",
    )

    get_response = await admin_client.send_event(get_event)
    assert get_response.success == True, "Should be able to get announcement"
    assert get_response.data.get("text") == "", f"Announcement should be cleared: got '{get_response.data.get('text')}'"

    print("✅ Admin can clear announcement test PASSED")
    print(f"   Announcement cleared successfully")

