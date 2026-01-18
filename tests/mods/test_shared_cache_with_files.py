"""
Tests for the Shared Cache mod file upload/download functionality.

This test suite verifies the shared cache file operations:
1. File upload to cache
2. File download from cache
3. File access control
4. File metadata retrieval
5. Error handling for invalid operations
"""

import pytest
import asyncio
import random
import base64
from pathlib import Path

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.models.event import Event, EventVisibility


@pytest.fixture
async def shared_cache_file_test_network():
    """Create and start a network with shared cache mod configured for file tests."""
    config_path = (
        Path(__file__).parent.parent.parent
        / "examples"
        / "test_configs"
        / "test_shared_cache.yaml"
    )

    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))

    # Update the gRPC transport port to avoid conflicts - File cache test range: 46000-46999
    # Keep http_port within the same exclusive range to avoid overlaps with other test files
    grpc_port = random.randint(46000, 46499)
    http_port = grpc_port + 500  # HTTP port in range 46500-46999

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
async def admin_client(shared_cache_file_test_network):
    """Create an admin client for file cache tests."""
    network, config, grpc_port, http_port = shared_cache_file_test_network

    # Connect as admin with admin password hash
    admin_password_hash = None
    if "admin" in config.network.agent_groups:
        admin_password_hash = config.network.agent_groups["admin"].password_hash

    client = AgentClient(agent_id="admin_file_agent")
    await client.connect("localhost", http_port, password_hash=admin_password_hash)

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting admin_file_agent: {e}")


@pytest.fixture
async def developer_client(shared_cache_file_test_network):
    """Create a developer client for file cache tests."""
    network, config, grpc_port, http_port = shared_cache_file_test_network

    # Connect as developer with developer password hash
    dev_password_hash = None
    if "developers" in config.network.agent_groups:
        dev_password_hash = config.network.agent_groups["developers"].password_hash

    client = AgentClient(agent_id="developer_file_agent")
    await client.connect("localhost", http_port, password_hash=dev_password_hash)

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting developer_file_agent: {e}")


@pytest.fixture
async def user_client(shared_cache_file_test_network):
    """Create a regular user client for file cache tests."""
    network, config, grpc_port, http_port = shared_cache_file_test_network

    # Connect as user with user password hash
    user_password_hash = None
    if "users" in config.network.agent_groups:
        user_password_hash = config.network.agent_groups["users"].password_hash

    client = AgentClient(agent_id="user_file_agent")
    await client.connect("localhost", http_port, password_hash=user_password_hash)

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client

    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting user_file_agent: {e}")


@pytest.mark.asyncio
async def test_file_upload(admin_client):
    """Test uploading a file to the shared cache."""

    print("🔍 Testing file upload...")

    # Create test file content
    test_content = b"Hello, this is a test file content for shared cache!"
    file_data_b64 = base64.b64encode(test_content).decode("utf-8")

    # Upload file
    upload_event = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "file_data": file_data_b64,
            "filename": "test_file.txt",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],  # Public - accessible by all
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    print("📤 Uploading file...")
    response = await admin_client.send_event(upload_event)

    # Verify response
    assert response is not None, "Should receive a response"
    assert response.success == True, f"File upload should succeed: {response.message}"
    assert "cache_id" in response.data, "Response should include cache_id"
    assert response.data.get("filename") == "test_file.txt", "Filename should match"
    assert response.data.get("file_size") == len(test_content), "File size should match"
    assert response.data.get("mime_type") == "text/plain", "MIME type should match"

    cache_id = response.data["cache_id"]
    print(f"✅ File uploaded successfully: {cache_id}")

    return cache_id


@pytest.mark.asyncio
async def test_file_upload_and_download(admin_client):
    """Test uploading and downloading a file."""

    print("🔍 Testing file upload and download...")

    # Create test file content
    test_content = b"Binary content: \x00\x01\x02\x03\xff\xfe\xfd"
    file_data_b64 = base64.b64encode(test_content).decode("utf-8")

    # Upload file
    upload_event = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "file_data": file_data_b64,
            "filename": "binary_test.bin",
            "mime_type": "application/octet-stream",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    upload_response = await admin_client.send_event(upload_event)
    assert upload_response.success == True, f"File upload should succeed: {upload_response.message}"
    cache_id = upload_response.data["cache_id"]

    print(f"✅ File uploaded: {cache_id}")

    # Download file
    download_event = Event(
        event_name="shared_cache.file.download",
        source_id="admin_file_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    download_response = await admin_client.send_event(download_event)

    # Verify download response
    assert download_response is not None, "Should receive a response"
    assert download_response.success == True, f"File download should succeed: {download_response.message}"
    assert download_response.data.get("cache_id") == cache_id, "Cache ID should match"
    assert download_response.data.get("filename") == "binary_test.bin", "Filename should match"
    assert download_response.data.get("mime_type") == "application/octet-stream", "MIME type should match"

    # Verify file content
    downloaded_data = base64.b64decode(download_response.data["file_data"])
    assert downloaded_data == test_content, "Downloaded content should match original"

    print("✅ File upload and download test PASSED")
    print(f"   Cache ID: {cache_id}")
    print(f"   Filename: {download_response.data['filename']}")
    print(f"   File size: {download_response.data['file_size']} bytes")


@pytest.mark.asyncio
async def test_file_access_control(admin_client, developer_client, user_client):
    """Test file access control with agent groups."""

    print("🔍 Testing file access control...")

    # Create test file content
    test_content = b"Restricted file content for admins and developers only"
    file_data_b64 = base64.b64encode(test_content).decode("utf-8")

    # Admin uploads a restricted file
    upload_event = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "file_data": file_data_b64,
            "filename": "restricted_file.txt",
            "mime_type": "text/plain",
            "allowed_agent_groups": ["admin", "developers"],  # Restricted access
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    upload_response = await admin_client.send_event(upload_event)
    assert upload_response.success == True, "File upload should succeed"
    cache_id = upload_response.data["cache_id"]

    print(f"✅ Restricted file uploaded: {cache_id}")

    # Developer should be able to download
    download_event_dev = Event(
        event_name="shared_cache.file.download",
        source_id="developer_file_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    dev_response = await developer_client.send_event(download_event_dev)
    assert dev_response.success == True, "Developer should be able to download restricted file"

    print("✅ Developer can download restricted file")

    # Regular user should NOT be able to download
    download_event_user = Event(
        event_name="shared_cache.file.download",
        source_id="user_file_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    user_response = await user_client.send_event(download_event_user)
    assert user_response.success == False, "User should NOT be able to download restricted file"
    assert "permission" in user_response.data.get("error", "").lower(), "Error should mention permission"

    print("✅ File access control test PASSED")
    print(f"   Admin uploaded restricted file")
    print(f"   Developer: ACCESS GRANTED ✓")
    print(f"   User: ACCESS DENIED ✗")


@pytest.mark.asyncio
async def test_download_nonexistent_file(admin_client):
    """Test downloading a non-existent file."""

    print("🔍 Testing download of non-existent file...")

    # Try to download non-existent file
    download_event = Event(
        event_name="shared_cache.file.download",
        source_id="admin_file_agent",
        payload={"cache_id": "nonexistent-file-id-12345"},
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    response = await admin_client.send_event(download_event)

    # Verify returns error
    assert response is not None, "Should receive a response"
    assert response.success == False, "Should fail for non-existent file"
    assert "not found" in response.data.get("error", "").lower(), "Error should mention not found"

    print("✅ Non-existent file download test PASSED")
    print(f"   Error message: {response.data.get('error')}")


@pytest.mark.asyncio
async def test_download_non_file_cache_entry(admin_client):
    """Test downloading a cache entry that is not a file."""

    print("🔍 Testing download of non-file cache entry...")

    # Create a regular (non-file) cache entry
    create_event = Event(
        event_name="shared_cache.create",
        source_id="admin_file_agent",
        payload={
            "value": "This is a string cache entry, not a file",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
    )

    create_response = await admin_client.send_event(create_event)
    assert create_response.success == True, "Cache creation should succeed"
    cache_id = create_response.data["cache_id"]

    # Try to download it as a file
    download_event = Event(
        event_name="shared_cache.file.download",
        source_id="admin_file_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    response = await admin_client.send_event(download_event)

    # Verify returns error
    assert response is not None, "Should receive a response"
    assert response.success == False, "Should fail for non-file cache entry"
    assert "not a file" in response.data.get("error", "").lower(), "Error should mention not a file"

    print("✅ Non-file cache entry download test PASSED")
    print(f"   Error message: {response.data.get('error')}")


@pytest.mark.asyncio
async def test_file_upload_missing_data(admin_client):
    """Test file upload with missing required fields."""

    print("🔍 Testing file upload with missing data...")

    # Upload without file_data
    upload_event_no_data = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "filename": "test.txt",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    response_no_data = await admin_client.send_event(upload_event_no_data)
    assert response_no_data.success == False, "Should fail without file_data"
    assert "file_data" in response_no_data.data.get("error", "").lower(), "Error should mention file_data"

    print("✅ Missing file_data test PASSED")

    # Upload without filename
    test_content = b"Test content"
    file_data_b64 = base64.b64encode(test_content).decode("utf-8")

    upload_event_no_name = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "file_data": file_data_b64,
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    response_no_name = await admin_client.send_event(upload_event_no_name)
    assert response_no_name.success == False, "Should fail without filename"
    assert "filename" in response_no_name.data.get("error", "").lower(), "Error should mention filename"

    print("✅ Missing filename test PASSED")


@pytest.mark.asyncio
async def test_file_upload_invalid_base64(admin_client):
    """Test file upload with invalid base64 data."""

    print("🔍 Testing file upload with invalid base64...")

    # Upload with invalid base64 data
    upload_event = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "file_data": "this-is-not-valid-base64!!!",
            "filename": "test.txt",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    response = await admin_client.send_event(upload_event)

    # Verify returns error
    assert response is not None, "Should receive a response"
    assert response.success == False, "Should fail with invalid base64"
    assert "base64" in response.data.get("error", "").lower(), "Error should mention base64"

    print("✅ Invalid base64 test PASSED")
    print(f"   Error message: {response.data.get('error')}")


@pytest.mark.asyncio
async def test_file_with_special_characters_in_name(admin_client):
    """Test uploading a file with special characters in filename."""

    print("🔍 Testing file with special characters in name...")

    # Create test file content
    test_content = b"Test content for special filename"
    file_data_b64 = base64.b64encode(test_content).decode("utf-8")

    # Upload file with special characters (should be sanitized)
    upload_event = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "file_data": file_data_b64,
            "filename": "../../../etc/passwd",  # Path traversal attempt
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    response = await admin_client.send_event(upload_event)

    # Should succeed but filename should be sanitized
    assert response is not None, "Should receive a response"
    assert response.success == True, "File upload should succeed with sanitized name"
    assert response.data.get("filename") == "passwd", "Filename should be sanitized (basename only)"

    print("✅ Special characters in filename test PASSED")
    print(f"   Original: ../../../etc/passwd")
    print(f"   Sanitized: {response.data.get('filename')}")


@pytest.mark.asyncio
async def test_large_file_upload(admin_client):
    """Test uploading a larger file (within limits)."""

    print("🔍 Testing larger file upload...")

    # Create a 1MB file content
    test_content = b"X" * (1024 * 1024)  # 1 MB
    file_data_b64 = base64.b64encode(test_content).decode("utf-8")

    # Upload file
    upload_event = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "file_data": file_data_b64,
            "filename": "large_file.bin",
            "mime_type": "application/octet-stream",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    print("📤 Uploading 1MB file...")
    response = await admin_client.send_event(upload_event)

    # Verify response
    assert response is not None, "Should receive a response"
    assert response.success == True, f"Large file upload should succeed: {response.message}"
    assert response.data.get("file_size") == len(test_content), "File size should match"

    print("✅ Large file upload test PASSED")
    print(f"   Cache ID: {response.data['cache_id']}")
    print(f"   File size: {response.data['file_size']} bytes")


@pytest.mark.asyncio
async def test_file_cache_entry_is_marked_as_file(admin_client):
    """Test that file cache entries are properly marked as files."""

    print("🔍 Testing file cache entry is_file flag...")

    # Create test file content
    test_content = b"Test file content"
    file_data_b64 = base64.b64encode(test_content).decode("utf-8")

    # Upload file
    upload_event = Event(
        event_name="shared_cache.file.upload",
        source_id="admin_file_agent",
        payload={
            "file_data": file_data_b64,
            "filename": "test_is_file.txt",
            "mime_type": "text/plain",
            "allowed_agent_groups": [],
        },
        relevant_mod="openagents.mods.core.shared_cache",
        visibility=EventVisibility.MOD_ONLY,
    )

    upload_response = await admin_client.send_event(upload_event)
    assert upload_response.success == True, "File upload should succeed"
    cache_id = upload_response.data["cache_id"]

    # Get cache entry using regular get
    get_event = Event(
        event_name="shared_cache.get",
        source_id="admin_file_agent",
        payload={"cache_id": cache_id},
        relevant_mod="openagents.mods.core.shared_cache",
    )

    get_response = await admin_client.send_event(get_event)

    # Verify is_file flag
    assert get_response is not None, "Should receive a response"
    assert get_response.success == True, "Get should succeed"
    assert get_response.data.get("is_file") == True, "is_file flag should be True"
    assert get_response.data.get("filename") == "test_is_file.txt", "Filename should be present"
    assert get_response.data.get("file_size") == len(test_content), "File size should be present"

    print("✅ File cache entry is_file flag test PASSED")
    print(f"   is_file: {get_response.data.get('is_file')}")
    print(f"   filename: {get_response.data.get('filename')}")
    print(f"   file_size: {get_response.data.get('file_size')}")
