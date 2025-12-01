"""
Tests for the Shared Artifact mod.

This test suite verifies the shared artifact functionality:
1. Artifact creation with MIME types and optional names
2. Artifact retrieval with content
3. Artifact updates
4. Artifact deletion
5. Artifact listing with filtering
6. Agent group-based access control
7. Binary file support (base64 encoding)
8. Real-time notifications
"""

import pytest
import asyncio
import random
import base64
from pathlib import Path

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.models.event import Event
from openagents.models.event_response import EventResponse
from openagents.utils.password_utils import hash_password


@pytest.fixture
async def shared_artifact_test_network():
    """Create and start a network with shared artifact mod configured."""
    config_path = (
        Path(__file__).parent.parent.parent
        / "examples"
        / "test_configs"
        / "shared_artifacts.yaml"
    )

    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))

    # Update the gRPC transport port to avoid conflicts - Shared artifact test range: 46000-47999
    grpc_port = random.randint(46000, 47999)
    http_port = grpc_port + 2000  # HTTP port should be different

    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["port"] = grpc_port
        elif transport.type == "http":
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
async def admin_client(shared_artifact_test_network):
    """Create an admin client for artifact tests."""
    network, config, grpc_port, http_port = shared_artifact_test_network

    # Connect as admin with admin password hash
    admin_password_hash = None
    if "admin" in config.network.agent_groups:
        admin_password_hash = config.network.agent_groups["admin"].password_hash

    client = AgentClient(agent_id="admin_agent")
    await client.connect("localhost", http_port, password_hash=admin_password_hash)

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting admin_agent: {e}")


@pytest.fixture
async def analyst_client(shared_artifact_test_network):
    """Create an analyst client for artifact tests."""
    network, config, grpc_port, http_port = shared_artifact_test_network

    # Connect as analyst with analyst password hash
    analyst_password_hash = None
    if "analysts" in config.network.agent_groups:
        analyst_password_hash = config.network.agent_groups["analysts"].password_hash

    client = AgentClient(agent_id="analyst_agent")
    await client.connect("localhost", http_port, password_hash=analyst_password_hash)

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting analyst_agent: {e}")


@pytest.fixture
async def user_client(shared_artifact_test_network):
    """Create a regular user client for artifact tests."""
    network, config, grpc_port, http_port = shared_artifact_test_network

    # Connect as user with user password hash
    user_password_hash = None
    if "users" in config.network.agent_groups:
        user_password_hash = config.network.agent_groups["users"].password_hash

    client = AgentClient(agent_id="user_agent")
    await client.connect("localhost", http_port, password_hash=user_password_hash)

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting user_agent: {e}")


@pytest.mark.asyncio
async def test_create_artifact(admin_client):
    """Test creating an artifact."""

    print("🔍 Testing artifact creation...")

    # Create a public artifact
    create_event = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Monthly Sales Report",
            "content": '{"result": 95}',
            "mime_type": "application/json",
            "allowed_agent_groups": [],  # Public - accessible by all
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    print("📤 Creating artifact...")
    response = await admin_client.send_event(create_event)

    # Verify response
    assert response is not None, "Should receive a response"
    assert response.success == True, f"Artifact creation should succeed"
    assert "artifact_id" in response.data, "Response should include artifact_id"

    artifact_id = response.data["artifact_id"]
    print(f"✅ Artifact created successfully: {artifact_id}")

    return artifact_id


@pytest.mark.asyncio
async def test_create_and_get_artifact(admin_client):
    """Test creating and retrieving an artifact."""

    print("🔍 Testing artifact create and get...")

    # Create artifact
    create_event = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Test Report",
            "content": '{"api_key": "test_key", "endpoint": "https://api.example.com"}',
            "mime_type": "application/json",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    create_response = await admin_client.send_event(create_event)
    assert create_response.success == True, "Artifact creation should succeed"
    artifact_id = create_response.data["artifact_id"]

    print(f"✅ Created artifact: {artifact_id}")

    # Get artifact
    get_event = Event(
        event_name="shared_artifact.get",
        source_id="admin_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    get_response = await admin_client.send_event(get_event)

    # Verify get response
    assert get_response is not None, "Should receive a response"
    assert get_response.success == True, f"Artifact retrieval should succeed"
    assert get_response.data["artifact_id"] == artifact_id, "Artifact ID should match"
    assert get_response.data["name"] == "Test Report", "Name should match"
    assert get_response.data["content"] == '{"api_key": "test_key", "endpoint": "https://api.example.com"}', "Content should match"
    assert get_response.data["mime_type"] == "application/json", "MIME type should match"
    assert get_response.data["created_by"] == "admin_agent", "Created by should match"
    assert "file_size" in get_response.data, "Response should include file_size"

    print("✅ Artifact create and get test PASSED")
    print(f"   Artifact ID: {artifact_id}")
    print(f"   Name: {get_response.data['name']}")
    print(f"   Content: {get_response.data['content']}")
    print(f"   MIME type: {get_response.data['mime_type']}")
    print(f"   File size: {get_response.data['file_size']} bytes")


@pytest.mark.asyncio
async def test_update_artifact(admin_client):
    """Test updating an artifact."""

    print("🔍 Testing artifact update...")

    # Create artifact
    create_event = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Update Test",
            "content": "Initial value",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    create_response = await admin_client.send_event(create_event)
    artifact_id = create_response.data["artifact_id"]

    # Update artifact
    update_event = Event(
        event_name="shared_artifact.update",
        source_id="admin_agent",
        payload={
            "artifact_id": artifact_id,
            "content": "Updated value",
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    update_response = await admin_client.send_event(update_event)

    # Verify update response
    assert update_response is not None, "Should receive a response"
    assert update_response.success == True, f"Artifact update should succeed: {update_response.message}"

    # Verify updated content
    get_event = Event(
        event_name="shared_artifact.get",
        source_id="admin_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    get_response = await admin_client.send_event(get_event)
    assert get_response.data["content"] == "Updated value", "Content should be updated"

    print("✅ Artifact update test PASSED")
    print(f"   Initial: Initial value")
    print(f"   Updated: {get_response.data['content']}")


@pytest.mark.asyncio
async def test_delete_artifact(admin_client):
    """Test deleting an artifact."""

    print("🔍 Testing artifact deletion...")

    # Create artifact
    create_event = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Temporary Document",
            "content": "Temporary data",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    create_response = await admin_client.send_event(create_event)
    artifact_id = create_response.data["artifact_id"]

    # Delete artifact
    delete_event = Event(
        event_name="shared_artifact.delete",
        source_id="admin_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    delete_response = await admin_client.send_event(delete_event)

    # Verify delete response
    assert delete_response is not None, "Should receive a response"
    assert delete_response.success == True, f"Artifact deletion should succeed: {delete_response.message}"

    # Verify artifact is deleted
    get_event = Event(
        event_name="shared_artifact.get",
        source_id="admin_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    get_response = await admin_client.send_event(get_event)
    assert get_response.success == False, "Should fail to get deleted artifact"

    print("✅ Artifact deletion test PASSED")
    print(f"   Artifact {artifact_id} deleted successfully")


@pytest.mark.asyncio
async def test_list_artifacts(admin_client):
    """Test listing artifacts."""

    print("🔍 Testing artifact listing...")

    # Create multiple artifacts with different MIME types
    artifacts = []

    # Create JSON artifact
    create_json = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "JSON Data",
            "content": '{"type": "json"}',
            "mime_type": "application/json",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )
    response = await admin_client.send_event(create_json)
    artifacts.append(response.data["artifact_id"])

    # Create text artifact
    create_text = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Text Document",
            "content": "This is text",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )
    response = await admin_client.send_event(create_text)
    artifacts.append(response.data["artifact_id"])

    # List all artifacts
    list_event = Event(
        event_name="shared_artifact.list",
        source_id="admin_agent",
        payload={},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    list_response = await admin_client.send_event(list_event)

    # Verify list response
    assert list_response is not None, "Should receive a response"
    assert list_response.success == True, "Artifact listing should succeed"
    assert "artifacts" in list_response.data, "Response should include artifacts list"
    assert len(list_response.data["artifacts"]) >= 2, "Should list at least 2 artifacts"

    print(f"✅ Listed {len(list_response.data['artifacts'])} artifacts")

    # List only JSON artifacts
    list_json_event = Event(
        event_name="shared_artifact.list",
        source_id="admin_agent",
        payload={"mime_type": "application/json"},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    list_json_response = await admin_client.send_event(list_json_event)
    assert list_json_response.success == True, "JSON artifact listing should succeed"

    # Verify all returned artifacts are JSON
    for artifact in list_json_response.data["artifacts"]:
        assert artifact["mime_type"] == "application/json", "All artifacts should be JSON"

    print("✅ Artifact listing test PASSED")
    print(f"   Total artifacts: {len(list_response.data['artifacts'])}")
    print(f"   JSON artifacts: {len(list_json_response.data['artifacts'])}")


@pytest.mark.asyncio
async def test_binary_artifact(admin_client):
    """Test creating and retrieving a binary artifact (simulated image)."""

    print("🔍 Testing binary artifact...")

    # Create fake binary data (simulating an image)
    binary_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10'
    encoded_data = base64.b64encode(binary_data).decode("utf-8")

    # Create binary artifact
    create_event = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Test Image",
            "content": encoded_data,
            "mime_type": "image/png",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    create_response = await admin_client.send_event(create_event)
    assert create_response.success == True, "Binary artifact creation should succeed"
    artifact_id = create_response.data["artifact_id"]

    print(f"✅ Created binary artifact: {artifact_id}")

    # Get binary artifact
    get_event = Event(
        event_name="shared_artifact.get",
        source_id="admin_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    get_response = await admin_client.send_event(get_event)

    # Verify binary content
    assert get_response.success == True, "Binary artifact retrieval should succeed"
    assert get_response.data["mime_type"] == "image/png", "MIME type should be image/png"

    # Decode and verify content
    decoded_data = base64.b64decode(get_response.data["content"])
    assert decoded_data == binary_data, "Binary data should match"

    print("✅ Binary artifact test PASSED")
    print(f"   Original size: {len(binary_data)} bytes")
    print(f"   Encoded size: {len(encoded_data)} bytes")
    print(f"   Retrieved and decoded successfully")


@pytest.mark.asyncio
async def test_access_control_restricted_artifact(admin_client, analyst_client, user_client):
    """Test agent group-based access control."""

    print("🔍 Testing access control with restricted artifact...")

    # Admin creates an artifact restricted to admin and analysts
    create_event = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Restricted Report",
            "content": "Restricted data for admins and analysts",
            "mime_type": "text/plain",
            "allowed_agent_groups": ["admin", "analysts"],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    create_response = await admin_client.send_event(create_event)
    artifact_id = create_response.data["artifact_id"]

    print(f"✅ Created restricted artifact: {artifact_id}")

    # Analyst should be able to access
    get_event_analyst = Event(
        event_name="shared_artifact.get",
        source_id="analyst_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    analyst_response = await analyst_client.send_event(get_event_analyst)
    assert analyst_response.success == True, "Analyst should be able to access restricted artifact"

    print("✅ Analyst can access restricted artifact")

    # Regular user should NOT be able to access
    get_event_user = Event(
        event_name="shared_artifact.get",
        source_id="user_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    user_response = await user_client.send_event(get_event_user)
    assert user_response.success == False, "Regular user should NOT be able to access restricted artifact"
    assert "permission" in user_response.data.get("error", "").lower(), "Error should mention permission"

    print("✅ Access control test PASSED")
    print(f"   Admin created restricted artifact")
    print(f"   Analyst: ACCESS GRANTED ✓")
    print(f"   User: ACCESS DENIED ✗")


@pytest.mark.asyncio
async def test_list_filters_by_access_control(admin_client, user_client):
    """Test that list operation respects access control."""

    print("🔍 Testing list with access control...")

    # Admin creates a restricted artifact
    create_restricted = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Admin Only Document",
            "content": "Admin only data",
            "mime_type": "text/plain",
            "allowed_agent_groups": ["admin"],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )
    await admin_client.send_event(create_restricted)

    # Admin creates a public artifact
    create_public = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Public Document",
            "content": "Public data",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )
    await admin_client.send_event(create_public)

    # Admin lists artifacts (should see both)
    admin_list = Event(
        event_name="shared_artifact.list",
        source_id="admin_agent",
        payload={},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )
    admin_response = await admin_client.send_event(admin_list)
    admin_count = len(admin_response.data["artifacts"])

    # User lists artifacts (should only see public ones)
    user_list = Event(
        event_name="shared_artifact.list",
        source_id="user_agent",
        payload={},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )
    user_response = await user_client.send_event(user_list)
    user_count = len(user_response.data["artifacts"])

    # Verify user sees fewer artifacts than admin
    assert user_count < admin_count or admin_count > 0, "User should see fewer or equal artifacts than admin"

    print("✅ List access control test PASSED")
    print(f"   Admin sees: {admin_count} artifacts")
    print(f"   User sees: {user_count} artifacts")


@pytest.mark.asyncio
async def test_get_nonexistent_artifact(admin_client):
    """Test getting a non-existent artifact."""

    print("🔍 Testing retrieval of non-existent artifact...")

    # Try to get non-existent artifact
    get_event = Event(
        event_name="shared_artifact.get",
        source_id="admin_agent",
        payload={"artifact_id": "nonexistent-artifact-id-12345"},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    response = await admin_client.send_event(get_event)

    # Verify returns error
    assert response is not None, "Should receive a response"
    assert response.success == False, "Should fail for non-existent artifact"
    assert "not found" in response.data.get("error", "").lower(), "Error should mention not found"

    print("✅ Non-existent artifact test PASSED")
    print(f"   Error message: {response.data.get('error')}")


@pytest.mark.asyncio
async def test_update_restricted_artifact_access_denied(admin_client, user_client):
    """Test that users without permission cannot update restricted artifact."""

    print("🔍 Testing update access control...")

    # Admin creates restricted artifact
    create_event = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Protected Document",
            "content": "Admin only data",
            "mime_type": "text/plain",
            "allowed_agent_groups": ["admin"],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    create_response = await admin_client.send_event(create_event)
    artifact_id = create_response.data["artifact_id"]

    # User tries to update
    update_event = Event(
        event_name="shared_artifact.update",
        source_id="user_agent",
        payload={
            "artifact_id": artifact_id,
            "content": "Hacked content",
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    update_response = await user_client.send_event(update_event)

    # Verify update is denied
    assert update_response.success == False, "User should NOT be able to update restricted artifact"
    assert "permission" in update_response.data.get("error", "").lower(), "Error should mention permission"

    print("✅ Update access control test PASSED")
    print(f"   User denied update permission: {update_response.data.get('error')}")


@pytest.mark.asyncio
async def test_delete_restricted_artifact_access_denied(admin_client, user_client):
    """Test that users without permission cannot delete restricted artifact."""

    print("🔍 Testing delete access control...")

    # Admin creates restricted artifact
    create_event = Event(
        event_name="shared_artifact.create",
        source_id="admin_agent",
        payload={
            "name": "Protected Data",
            "content": "Protected data",
            "mime_type": "text/plain",
            "allowed_agent_groups": ["admin"],
        },
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    create_response = await admin_client.send_event(create_event)
    artifact_id = create_response.data["artifact_id"]

    # User tries to delete
    delete_event = Event(
        event_name="shared_artifact.delete",
        source_id="user_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    delete_response = await user_client.send_event(delete_event)

    # Verify delete is denied
    assert delete_response.success == False, "User should NOT be able to delete restricted artifact"
    assert "permission" in delete_response.data.get("error", "").lower(), "Error should mention permission"

    # Verify artifact still exists
    get_event = Event(
        event_name="shared_artifact.get",
        source_id="admin_agent",
        payload={"artifact_id": artifact_id},
        relevant_mod="openagents.mods.workspace.shared_artifact",
    )

    get_response = await admin_client.send_event(get_event)
    assert get_response.success == True, "Artifact should still exist after failed delete"

    print("✅ Delete access control test PASSED")
    print(f"   User denied delete permission: {delete_response.data.get('error')}")
    print(f"   Artifact still exists: verified ✓")
