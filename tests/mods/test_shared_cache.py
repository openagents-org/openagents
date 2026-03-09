"""
Tests for the Shared Cache mod.

This test suite verifies the shared cache functionality:
1. Cache entry creation with MIME types
2. Cache entry retrieval
3. Cache entry updates
4. Cache entry deletion
5. Agent group-based access control
6. Real-time notifications
"""

import pytest
import asyncio
import socket
from pathlib import Path

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.utils.password_utils import hash_password



def _get_free_port() -> int:
    """Ask the OS for a currently free loopback TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.fixture
async def shared_cache_test_network():
    """Create and start a network with shared cache mod configured."""
    config_path = (
        Path(__file__).parent.parent.parent
        / "examples"
        / "test_configs"
        / "test_shared_cache.yaml"
    )

    # Load config and use OS-assigned free ports to avoid collisions.
    config = load_network_config(str(config_path))

    grpc_port = _get_free_port()
    http_port = _get_free_port()

    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["host"] = "127.0.0.1"
            transport.config["port"] = grpc_port
        elif transport.type == "http":
            transport.config["host"] = "127.0.0.1"
            transport.config["port"] = http_port

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
async def admin_client(shared_cache_test_network):
    """Create an admin client for cache tests."""
    network, config, grpc_port, http_port = shared_cache_test_network

    # Connect as admin with admin password hash
    admin_password_hash = None
    if "admin" in config.network.agent_groups:
        admin_password_hash = config.network.agent_groups["admin"].password_hash

    client = AgentClient(agent_id="admin_agent")
    connected = await client.connect(
        "localhost", http_port, password_hash=admin_password_hash
    )
    assert connected, f"Failed to connect admin_agent to localhost:{http_port}"

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting admin_agent: {e}")


@pytest.fixture
async def developer_client(shared_cache_test_network):
    """Create a developer client for cache tests."""
    network, config, grpc_port, http_port = shared_cache_test_network

    # Connect as developer with developer password hash
    dev_password_hash = None
    if "developers" in config.network.agent_groups:
        dev_password_hash = config.network.agent_groups["developers"].password_hash

    client = AgentClient(agent_id="developer_agent")
    connected = await client.connect(
        "localhost", http_port, password_hash=dev_password_hash
    )
    assert connected, f"Failed to connect developer_agent to localhost:{http_port}"

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting developer_agent: {e}")


@pytest.fixture
async def user_client(shared_cache_test_network):
    """Create a regular user client for cache tests."""
    network, config, grpc_port, http_port = shared_cache_test_network

    # Connect as user with user password hash
    user_password_hash = None
    if "users" in config.network.agent_groups:
        user_password_hash = config.network.agent_groups["users"].password_hash

    client = AgentClient(agent_id="user_agent")
    connected = await client.connect(
        "localhost", http_port, password_hash=user_password_hash
    )
    assert connected, f"Failed to connect user_agent to localhost:{http_port}"

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting user_agent: {e}")


@pytest.mark.asyncio
async def test_create_cache_entry(admin_client):
    """Test creating a cache entry."""

    print("🔍 Testing cache entry creation...")

    # Create a public cache entry
    create_event = Event(
        event_name="shared_cache.create",
        source_id="admin_agent",
        payload={
            "value": "This is cached data",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],  # Public - accessible by all
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    print("📤 Creating cache entry...")
    response = await admin_client.send_event(create_event)

    # Verify response
    assert response is not None, "Should receive a response"
    assert response.success == True, f"Cache creation should succeed"
    assert "cache_id" in response.data, "Response should include cache_id"

    cache_id = response.data["cache_id"]
    print(f"✅ Cache entry created successfully: {cache_id}")

    return cache_id


@pytest.mark.asyncio
async def test_create_and_get_cache(admin_client):
    """Test creating and retrieving a cache entry."""

    print("🔍 Testing cache create and get...")

    # Create cache entry
    create_event = Event(
        event_name="shared_cache.create",
        source_id="admin_agent",
        payload={
            "value": '{"api_key": "test_key", "endpoint": "https://api.example.com"}',
            "mime_type": "application/json",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    create_response = await admin_client.send_event(create_event)
    assert create_response.success == True, "Cache creation should succeed"
    cache_id = create_response.data["cache_id"]

    print(f"✅ Created cache: {cache_id}")

    # Get cache entry
    get_event = Event(
        event_name="shared_cache.get",
        source_id="admin_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    get_response = await admin_client.send_event(get_event)

    # Verify get response
    assert get_response is not None, "Should receive a response"
    assert get_response.success == True, f"Cache retrieval should succeed"
    assert get_response.data["cache_id"] == cache_id, "Cache ID should match"
    assert get_response.data["value"] == '{"api_key": "test_key", "endpoint": "https://api.example.com"}', "Value should match"
    assert get_response.data["mime_type"] == "application/json", "MIME type should match"
    assert get_response.data["created_by"] == "admin_agent", "Created by should match"

    print("✅ Cache create and get test PASSED")
    print(f"   Cache ID: {cache_id}")
    print(f"   Value: {get_response.data['value']}")
    print(f"   MIME type: {get_response.data['mime_type']}")


@pytest.mark.asyncio
async def test_update_cache(admin_client):
    """Test updating a cache entry."""

    print("🔍 Testing cache update...")

    # Create cache entry
    create_event = Event(
        event_name="shared_cache.create",
        source_id="admin_agent",
        payload={
            "value": "Initial value",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    create_response = await admin_client.send_event(create_event)
    cache_id = create_response.data["cache_id"]

    # Update cache entry
    update_event = Event(
        event_name="shared_cache.update",
        source_id="admin_agent",
        payload={
            "cache_id": cache_id,
            "value": "Updated value",
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    update_response = await admin_client.send_event(update_event)

    # Verify update response
    assert update_response is not None, "Should receive a response"
    assert update_response.success == True, f"Cache update should succeed: {update_response.message}"

    # Verify updated value
    get_event = Event(
        event_name="shared_cache.get",
        source_id="admin_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    get_response = await admin_client.send_event(get_event)
    assert get_response.data["value"] == "Updated value", "Value should be updated"

    print("✅ Cache update test PASSED")
    print(f"   Initial: Initial value")
    print(f"   Updated: {get_response.data['value']}")


@pytest.mark.asyncio
async def test_delete_cache(admin_client):
    """Test deleting a cache entry."""

    print("🔍 Testing cache deletion...")

    # Create cache entry
    create_event = Event(
        event_name="shared_cache.create",
        source_id="admin_agent",
        payload={
            "value": "Temporary data",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    create_response = await admin_client.send_event(create_event)
    cache_id = create_response.data["cache_id"]

    # Delete cache entry
    delete_event = Event(
        event_name="shared_cache.delete",
        source_id="admin_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    delete_response = await admin_client.send_event(delete_event)

    # Verify delete response
    assert delete_response is not None, "Should receive a response"
    assert delete_response.success == True, f"Cache deletion should succeed: {delete_response.message}"

    # Verify cache is deleted
    get_event = Event(
        event_name="shared_cache.get",
        source_id="admin_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    get_response = await admin_client.send_event(get_event)
    assert get_response.success == False, "Should fail to get deleted cache entry"

    print("✅ Cache deletion test PASSED")
    print(f"   Cache {cache_id} deleted successfully")


@pytest.mark.asyncio
async def test_access_control_restricted_cache(admin_client, developer_client, user_client):
    """Test agent group-based access control."""

    print("🔍 Testing access control with restricted cache...")

    # Admin creates a cache entry restricted to admin and developers
    create_event = Event(
        event_name="shared_cache.create",
        source_id="admin_agent",
        payload={
            "value": "Restricted data for admins and developers",
            "mime_type": "text/plain",
            "allowed_agent_groups": ["admin", "developers"],
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    create_response = await admin_client.send_event(create_event)
    cache_id = create_response.data["cache_id"]

    print(f"✅ Created restricted cache: {cache_id}")

    # Developer should be able to access
    get_event_dev = Event(
        event_name="shared_cache.get",
        source_id="developer_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    dev_response = await developer_client.send_event(get_event_dev)
    assert dev_response.success == True, "Developer should be able to access restricted cache"

    print("✅ Developer can access restricted cache")

    # Regular user should NOT be able to access
    get_event_user = Event(
        event_name="shared_cache.get",
        source_id="user_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    user_response = await user_client.send_event(get_event_user)
    assert user_response.success == False, "Regular user should NOT be able to access restricted cache"
    assert "permission" in user_response.data.get("error", "").lower(), "Error should mention permission"

    print("✅ Access control test PASSED")
    print(f"   Admin created restricted cache")
    print(f"   Developer: ACCESS GRANTED ✓")
    print(f"   User: ACCESS DENIED ✗")


@pytest.mark.asyncio
async def test_get_nonexistent_cache(admin_client):
    """Test getting a non-existent cache entry."""

    print("🔍 Testing retrieval of non-existent cache...")

    # Try to get non-existent cache
    get_event = Event(
        event_name="shared_cache.get",
        source_id="admin_agent",
        payload={"cache_id": "nonexistent-cache-id-12345"},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    response = await admin_client.send_event(get_event)

    # Verify returns error
    assert response is not None, "Should receive a response"
    assert response.success == False, "Should fail for non-existent cache"
    assert "not found" in response.data.get("error", "").lower(), "Error should mention not found"

    print("✅ Non-existent cache test PASSED")
    print(f"   Error message: {response.data.get('error')}")


@pytest.mark.asyncio
async def test_update_restricted_cache_access_denied(admin_client, user_client):
    """Test that users without permission cannot update restricted cache."""

    print("🔍 Testing update access control...")

    # Admin creates restricted cache
    create_event = Event(
        event_name="shared_cache.create",
        source_id="admin_agent",
        payload={
            "value": "Admin only data",
            "mime_type": "text/plain",
            "allowed_agent_groups": ["admin"],
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    create_response = await admin_client.send_event(create_event)
    cache_id = create_response.data["cache_id"]

    # User tries to update
    update_event = Event(
        event_name="shared_cache.update",
        source_id="user_agent",
        payload={
            "cache_id": cache_id,
            "value": "Hacked value",
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    update_response = await user_client.send_event(update_event)

    # Verify update is denied
    assert update_response is not None, (
        "Network/client not connected; send_event returned None"
    )
    assert update_response.success == False, "User should NOT be able to update restricted cache"
    assert "permission" in update_response.data.get("error", "").lower(), "Error should mention permission"

    print("✅ Update access control test PASSED")
    print(f"   User denied update permission: {update_response.data.get('error')}")


@pytest.mark.asyncio
async def test_delete_restricted_cache_access_denied(admin_client, user_client):
    """Test that users without permission cannot delete restricted cache."""

    print("🔍 Testing delete access control...")

    # Admin creates restricted cache
    create_event = Event(
        event_name="shared_cache.create",
        source_id="admin_agent",
        payload={
            "value": "Protected data",
            "mime_type": "text/plain",
            "allowed_agent_groups": ["admin"],
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    create_response = await admin_client.send_event(create_event)
    cache_id = create_response.data["cache_id"]

    # User tries to delete
    delete_event = Event(
        event_name="shared_cache.delete",
        source_id="user_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    delete_response = await user_client.send_event(delete_event)

    # Verify delete is denied
    assert delete_response is not None, (
        "Network/client not connected; send_event returned None"
    )
    assert delete_response.success == False, "User should NOT be able to delete restricted cache"
    assert "permission" in delete_response.data.get("error", "").lower(), "Error should mention permission"

    # Verify cache still exists
    get_event = Event(
        event_name="shared_cache.get",
        source_id="admin_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    get_response = await admin_client.send_event(get_event)
    assert get_response.success == True, "Cache should still exist after failed delete"

    print("✅ Delete access control test PASSED")
    print(f"   User denied delete permission: {delete_response.data.get('error')}")
    print(f"   Cache still exists: verified ✓")
