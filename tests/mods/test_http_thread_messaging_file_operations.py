"""
HTTP Thread Messaging File Operations Test.

This test verifies that two real HTTP clients can:
1. Connect to the network using workspace_test.yaml with enforced HTTP transport
2. Upload files using the thread_messaging mod
3. Download files using the thread_messaging mod
4. Verify file content integrity

No mocks - uses real HTTP clients and network infrastructure.
"""

import pytest
import asyncio
import random
import base64
import tempfile
from pathlib import Path

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.models.event import Event


@pytest.fixture
async def test_network():
    """Create and start a network using workspace_test.yaml config."""
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    
    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update the gRPC and HTTP transport ports to avoid conflicts - HTTP file ops test range: 36000-37999
    grpc_port = random.randint(36000, 37999)
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
async def http_client_alice(test_network):
    """Create first HTTP client (Alice) with enforced HTTP transport."""
    network, config, grpc_port, http_port = test_network
    
    client = AgentClient(agent_id="alice")
    # Use enforce_transport_type to force HTTP transport selection
    await client.connect("localhost", http_port, enforce_transport_type="http")
    
    # Give client time to connect
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting alice: {e}")


@pytest.fixture  
async def http_client_bob(test_network):
    """Create second HTTP client (Bob) with enforced HTTP transport."""
    network, config, grpc_port, http_port = test_network
    
    client = AgentClient(agent_id="bob")
    # Use enforce_transport_type to force HTTP transport selection
    await client.connect("localhost", http_port, enforce_transport_type="http")
    
    # Give client time to connect
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting bob: {e}")


@pytest.mark.asyncio
async def test_file_upload_http(http_client_alice):
    """Test file upload functionality using HTTP client."""
    
    print("🔍 Testing file upload via HTTP...")
    
    # Track received messages
    alice_messages = []
    
    # Set up message handler for Alice
    async def alice_handler(event):
        print(f"📨 Alice received: {event.event_name} from {event.source_id}")
        alice_messages.append(event)
    
    # Register handler for file operations
    http_client_alice.register_event_handler(alice_handler, ["thread.file.*"])
    
    # Create test file content
    test_content = "This is a test file for HTTP thread messaging.\nIt contains multiple lines.\nAnd some special characters: éñ中文🚀"
    encoded_content = base64.b64encode(test_content.encode('utf-8')).decode('utf-8')
    
    # Create file upload event
    file_upload = Event(
        event_name="thread.file.upload",
        source_id="alice",
        payload={
            "filename": "http_test_document.txt",
            "mime_type": "text/plain",
            "file_size": len(test_content),
            "file_content": encoded_content,
            "test_id": "http_file_upload_test"
        },
        event_id="http-file-upload-001"
    )
    
    print("📤 Alice uploading file via HTTP...")
    
    # Send the file upload event
    response = await http_client_alice.send_event(file_upload)
    
    # Verify immediate response
    assert response is not None, "Alice should receive immediate response for file upload"
    assert response.success == True, "File upload should be successful"
    assert response.data is not None, "Response should contain data"
    
    # Extract file upload data from immediate response
    upload_data = response.data
    assert upload_data["success"] == True, "File upload should be successful"
    assert "file_id" in upload_data, "Upload response should contain file_id"
    assert upload_data["filename"] == "http_test_document.txt", "Upload response should contain correct filename"
    
    file_id = upload_data["file_id"]
    print(f"✅ File uploaded successfully via HTTP with ID: {file_id}")
    
    # Verify file_id is a valid UUID format
    import uuid
    try:
        uuid.UUID(file_id)
        print(f"✅ File ID is valid UUID format: {file_id}")
    except ValueError:
        pytest.fail(f"File ID should be valid UUID format, got: {file_id}")
    
    print("✅ File upload HTTP test PASSED")
    print(f"   Alice successfully uploaded file: {upload_data['filename']}")
    print(f"   File ID: {file_id}")


@pytest.mark.asyncio
async def test_file_upload_and_download_http(http_client_alice, http_client_bob):
    """Test complete file upload and download workflow using HTTP clients."""
    
    print("🔍 Testing file upload and download workflow via HTTP...")
    
    # Track received messages
    alice_messages = []
    bob_messages = []
    
    # Set up message handlers
    async def alice_handler(event):
        print(f"📨 Alice received: {event.event_name} from {event.source_id}")
        alice_messages.append(event)
    
    async def bob_handler(event):
        print(f"📨 Bob received: {event.event_name} from {event.source_id}")
        bob_messages.append(event)
    
    # Register handlers for file operations
    http_client_alice.register_event_handler(alice_handler, ["thread.file.*"])
    http_client_bob.register_event_handler(bob_handler, ["thread.file.*"])
    
    # Create test file content with various data types
    test_content = """This is a comprehensive test file for HTTP thread messaging.
It contains:
- Multiple lines
- Special characters: éñ中文🚀
- Numbers: 12345
- Symbols: !@#$%^&*()
- Unicode: 🌟✨🎉

This tests the complete upload/download workflow via HTTP."""
    
    encoded_content = base64.b64encode(test_content.encode('utf-8')).decode('utf-8')
    
    # Step 1: Alice uploads a file
    file_upload = Event(
        event_name="thread.file.upload",
        source_id="alice",
        payload={
            "filename": "http_comprehensive_test.txt",
            "mime_type": "text/plain",
            "file_size": len(test_content),
            "file_content": encoded_content,
            "test_id": "http_comprehensive_test"
        },
        event_id="http-comprehensive-upload-001"
    )
    
    print("📤 Step 1: Alice uploading file via HTTP...")
    upload_response = await http_client_alice.send_event(file_upload)
    
    # Verify upload response
    assert upload_response is not None, "Alice should receive immediate response for file upload"
    assert upload_response.success == True, "File upload should be successful"
    assert upload_response.data is not None, "Upload response should contain data"
    
    upload_data = upload_response.data
    assert upload_data["success"] == True, "File upload should be successful"
    assert "file_id" in upload_data, "Upload response should contain file_id"
    assert upload_data["filename"] == "http_comprehensive_test.txt", "Upload response should contain correct filename"
    
    file_id = upload_data["file_id"]
    print(f"✅ File uploaded successfully with ID: {file_id}")
    
    # Step 2: Bob downloads the file
    file_download = Event(
        event_name="thread.file.download",
        source_id="bob",
        payload={
            "file_id": file_id,
            "test_id": "http_comprehensive_download_test"
        },
        event_id="http-comprehensive-download-001"
    )
    
    print("📤 Step 2: Bob downloading file via HTTP...")
    download_response = await http_client_bob.send_event(file_download)
    
    # Verify download response
    assert download_response is not None, "Bob should receive immediate response for file download"
    assert download_response.success == True, "File download should be successful"
    assert download_response.data is not None, "Download response should contain data"
    
    download_data = download_response.data
    assert download_data["success"] == True, "File download should be successful"
    assert download_data["file_id"] == file_id, "Download response should contain correct file_id"
    assert download_data["filename"] == "http_comprehensive_test.txt", "Download response should contain correct filename"
    assert "content" in download_data, "Download response should contain file content"
    
    # Step 3: Verify file content integrity
    downloaded_content = base64.b64decode(download_data["content"]).decode('utf-8')
    assert downloaded_content == test_content, "Downloaded content should match original content exactly"
    
    print("✅ Content integrity verified - downloaded content matches original")
    
    # Step 4: Verify file metadata
    assert "mime_type" in download_data, "Download response should contain mime_type"
    assert download_data["mime_type"] == "text/plain", "Download response should have correct mime_type"
    
    print("✅ File upload and download HTTP workflow test PASSED")
    print(f"   Alice successfully uploaded: {upload_data['filename']}")
    print(f"   Bob successfully downloaded: {download_data['filename']}")
    print(f"   File ID: {file_id}")
    print(f"   Content size: {len(test_content)} bytes")
    print(f"   Content integrity: ✅ VERIFIED")


@pytest.mark.asyncio
async def test_file_download_nonexistent_file_http(http_client_bob):
    """Test downloading a non-existent file returns appropriate error."""
    
    print("🔍 Testing download of non-existent file via HTTP...")
    
    # Track received messages
    bob_messages = []
    
    # Set up message handler for Bob
    async def bob_handler(event):
        print(f"📨 Bob received: {event.event_name} from {event.source_id}")
        bob_messages.append(event)
    
    # Register handler for file operations
    http_client_bob.register_event_handler(bob_handler, ["thread.file.*"])
    
    # Try to download a non-existent file
    fake_file_id = "00000000-0000-0000-0000-000000000000"
    file_download = Event(
        event_name="thread.file.download",
        source_id="bob",
        payload={
            "file_id": fake_file_id,
            "test_id": "http_nonexistent_file_test"
        },
        event_id="http-nonexistent-download-001"
    )
    
    print(f"📤 Bob attempting to download non-existent file: {fake_file_id}")
    download_response = await http_client_bob.send_event(file_download)
    
    # Verify error response
    assert download_response is not None, "Bob should receive immediate response for file download attempt"
    assert download_response.success == True, "Event should be processed successfully"
    assert download_response.data is not None, "Response should contain data"
    
    download_data = download_response.data
    assert download_data["success"] == False, "File download should fail for non-existent file"
    assert "error" in download_data, "Error response should contain error message"
    assert download_data["error"] == "File not found", "Error message should indicate file not found"
    
    print(f"✅ Correctly received error for non-existent file: {download_data['error']}")
    
    print("✅ Non-existent file download HTTP test PASSED")
    print(f"   Correctly handled non-existent file ID: {fake_file_id}")
    print(f"   Error message: {download_data['error']}")


@pytest.mark.asyncio
async def test_multiple_file_operations_http(http_client_alice, http_client_bob):
    """Test multiple file upload and download operations in sequence."""
    
    print("🔍 Testing multiple file operations via HTTP...")
    
    # Track received messages
    alice_messages = []
    bob_messages = []
    
    # Set up message handlers
    async def alice_handler(event):
        alice_messages.append(event)
    
    async def bob_handler(event):
        bob_messages.append(event)
    
    # Register handlers
    http_client_alice.register_event_handler(alice_handler, ["thread.file.*"])
    http_client_bob.register_event_handler(bob_handler, ["thread.file.*"])
    
    # Create multiple test files
    test_files = [
        {
            "filename": "http_test_1.txt",
            "content": "First test file content for HTTP testing.",
            "mime_type": "text/plain"
        },
        {
            "filename": "http_test_2.json",
            "content": '{"message": "Second test file", "type": "json", "test": true, "transport": "http"}',
            "mime_type": "application/json"
        },
        {
            "filename": "http_test_3.md",
            "content": "# Third Test File\n\nThis is a **markdown** file for HTTP testing.\n\n- Item 1\n- Item 2\n- Item 3\n\n> HTTP transport works great!",
            "mime_type": "text/markdown"
        }
    ]
    
    uploaded_files = []
    
    # Step 1: Upload all files
    print("📤 Step 1: Uploading multiple files...")
    for i, file_info in enumerate(test_files):
        encoded_content = base64.b64encode(file_info["content"].encode('utf-8')).decode('utf-8')
        
        file_upload = Event(
            event_name="thread.file.upload",
            source_id="alice",
            payload={
                "filename": file_info["filename"],
                "mime_type": file_info["mime_type"],
                "file_size": len(file_info["content"]),
                "file_content": encoded_content,
                "test_id": f"http_multi_upload_{i+1}"
            },
            event_id=f"http-multi-upload-{i+1:03d}"
        )
        
        print(f"   Uploading {file_info['filename']}...")
        upload_response = await http_client_alice.send_event(file_upload)
        
        assert upload_response is not None, f"Should receive response for {file_info['filename']}"
        assert upload_response.success == True, f"Upload should succeed for {file_info['filename']}"
        
        upload_data = upload_response.data
        assert upload_data["success"] == True, f"Upload should be successful for {file_info['filename']}"
        assert "file_id" in upload_data, f"Should get file_id for {file_info['filename']}"
        
        uploaded_files.append({
            "file_id": upload_data["file_id"],
            "filename": file_info["filename"],
            "original_content": file_info["content"],
            "mime_type": file_info["mime_type"]
        })
        
        print(f"   ✅ {file_info['filename']} uploaded with ID: {upload_data['file_id']}")
    
    # Step 2: Download all files and verify content
    print("📥 Step 2: Downloading and verifying all files...")
    for i, file_info in enumerate(uploaded_files):
        file_download = Event(
            event_name="thread.file.download",
            source_id="bob",
            payload={
                "file_id": file_info["file_id"],
                "test_id": f"http_multi_download_{i+1}"
            },
            event_id=f"http-multi-download-{i+1:03d}"
        )
        
        print(f"   Downloading {file_info['filename']}...")
        download_response = await http_client_bob.send_event(file_download)
        
        assert download_response is not None, f"Should receive response for {file_info['filename']}"
        assert download_response.success == True, f"Download should succeed for {file_info['filename']}"
        
        download_data = download_response.data
        assert download_data["success"] == True, f"Download should be successful for {file_info['filename']}"
        assert download_data["file_id"] == file_info["file_id"], f"Should get correct file_id for {file_info['filename']}"
        assert download_data["filename"] == file_info["filename"], f"Should get correct filename for {file_info['filename']}"
        
        # Verify content integrity
        downloaded_content = base64.b64decode(download_data["content"]).decode('utf-8')
        assert downloaded_content == file_info["original_content"], f"Content should match for {file_info['filename']}"
        
        # Verify mime type
        assert download_data["mime_type"] == file_info["mime_type"], f"MIME type should match for {file_info['filename']}"
        
        print(f"   ✅ {file_info['filename']} downloaded and verified")
    
    print("✅ Multiple file operations HTTP test PASSED")
    print(f"   Successfully uploaded and downloaded {len(test_files)} files")
    print(f"   All content integrity checks passed")
    for file_info in uploaded_files:
        print(f"   - {file_info['filename']}: {file_info['file_id']}")


@pytest.mark.asyncio
async def test_large_file_operations_http(http_client_alice, http_client_bob):
    """Test uploading and downloading a larger file to verify size handling."""
    
    print("🔍 Testing large file operations via HTTP...")
    
    # Track received messages
    alice_messages = []
    bob_messages = []
    
    # Set up message handlers
    async def alice_handler(event):
        alice_messages.append(event)
    
    async def bob_handler(event):
        bob_messages.append(event)
    
    # Register handlers
    http_client_alice.register_event_handler(alice_handler, ["thread.file.*"])
    http_client_bob.register_event_handler(bob_handler, ["thread.file.*"])
    
    # Create a larger test file (approximately 5KB)
    large_content = ""
    for i in range(100):
        large_content += f"Line {i+1}: This is a test line with some content to make the file larger via HTTP. "
        large_content += f"It includes numbers ({i+1}), special chars (!@#$%^&*()), and unicode (🚀✨🌟). "
        large_content += "Lorem ipsum dolor sit amet, consectetur adipiscing elit. HTTP transport test.\n"
    
    print(f"📊 Large file size: {len(large_content)} bytes ({len(large_content)/1024:.1f} KB)")
    
    encoded_content = base64.b64encode(large_content.encode('utf-8')).decode('utf-8')
    
    # Step 1: Upload large file
    file_upload = Event(
        event_name="thread.file.upload",
        source_id="alice",
        payload={
            "filename": "http_large_test_file.txt",
            "mime_type": "text/plain",
            "file_size": len(large_content),
            "file_content": encoded_content,
            "test_id": "http_large_file_test"
        },
        event_id="http-large-upload-001"
    )
    
    print("📤 Alice uploading large file via HTTP...")
    upload_response = await http_client_alice.send_event(file_upload)
    
    # Verify upload response
    assert upload_response is not None, "Alice should receive immediate response for large file upload"
    assert upload_response.success == True, "Large file upload should be successful"
    assert upload_response.data is not None, "Upload response should contain data"
    
    upload_data = upload_response.data
    assert upload_data["success"] == True, "Large file upload should be successful"
    assert "file_id" in upload_data, "Upload response should contain file_id"
    
    file_id = upload_data["file_id"]
    print(f"✅ Large file uploaded successfully with ID: {file_id}")
    
    # Step 2: Download large file
    file_download = Event(
        event_name="thread.file.download",
        source_id="bob",
        payload={
            "file_id": file_id,
            "test_id": "http_large_file_download_test"
        },
        event_id="http-large-download-001"
    )
    
    print("📥 Bob downloading large file via HTTP...")
    download_response = await http_client_bob.send_event(file_download)
    
    # Verify download response
    assert download_response is not None, "Bob should receive immediate response for large file download"
    assert download_response.success == True, "Large file download should be successful"
    assert download_response.data is not None, "Download response should contain data"
    
    download_data = download_response.data
    assert download_data["success"] == True, "Large file download should be successful"
    assert download_data["file_id"] == file_id, "Download response should contain correct file_id"
    assert "content" in download_data, "Download response should contain file content"
    
    # Step 3: Verify large file content integrity
    downloaded_content = base64.b64decode(download_data["content"]).decode('utf-8')
    assert len(downloaded_content) == len(large_content), "Downloaded content should have same length as original"
    assert downloaded_content == large_content, "Downloaded content should match original content exactly"
    
    print(f"✅ Large file content integrity verified ({len(downloaded_content)} bytes)")
    
    print("✅ Large file operations HTTP test PASSED")
    print(f"   Successfully uploaded and downloaded {len(large_content)} bytes")
    print(f"   File ID: {file_id}")
    print(f"   Content integrity: ✅ VERIFIED")


@pytest.mark.asyncio
async def test_http_transport_verification(http_client_alice, http_client_bob):
    """Test to verify that clients are actually using HTTP transport."""
    
    print("🔍 Testing HTTP transport verification...")
    
    # Check that clients are using HTTP transport
    alice_connector = http_client_alice.connector
    bob_connector = http_client_bob.connector
    
    # Verify connector types (should be HTTP connectors)
    print(f"Alice connector type: {type(alice_connector).__name__}")
    print(f"Bob connector type: {type(bob_connector).__name__}")
    
    # The connector should be an HTTP connector
    assert "HTTP" in type(alice_connector).__name__ or "Http" in type(alice_connector).__name__, "Alice should be using HTTP connector"
    assert "HTTP" in type(bob_connector).__name__ or "Http" in type(bob_connector).__name__, "Bob should be using HTTP connector"
    
    # Test a simple file operation to ensure HTTP transport works
    test_content = "HTTP transport verification test file."
    encoded_content = base64.b64encode(test_content.encode('utf-8')).decode('utf-8')
    
    file_upload = Event(
        event_name="thread.file.upload",
        source_id="alice",
        payload={
            "filename": "http_transport_verification.txt",
            "mime_type": "text/plain",
            "file_size": len(test_content),
            "file_content": encoded_content,
            "test_id": "http_transport_verification"
        },
        event_id="http-transport-verification-001"
    )
    
    print("📤 Testing file upload via HTTP transport...")
    upload_response = await http_client_alice.send_event(file_upload)
    
    assert upload_response is not None, "Should receive response via HTTP transport"
    assert upload_response.success == True, "File upload should succeed via HTTP transport"
    assert upload_response.data["success"] == True, "Upload should be successful"
    
    file_id = upload_response.data["file_id"]
    
    # Test download via HTTP transport
    file_download = Event(
        event_name="thread.file.download",
        source_id="bob",
        payload={
            "file_id": file_id,
            "test_id": "http_transport_verification_download"
        },
        event_id="http-transport-verification-download-001"
    )
    
    print("📥 Testing file download via HTTP transport...")
    download_response = await http_client_bob.send_event(file_download)
    
    assert download_response is not None, "Should receive response via HTTP transport"
    assert download_response.success == True, "File download should succeed via HTTP transport"
    assert download_response.data["success"] == True, "Download should be successful"
    
    # Verify content
    downloaded_content = base64.b64decode(download_response.data["content"]).decode('utf-8')
    assert downloaded_content == test_content, "Content should match via HTTP transport"
    
    print("✅ HTTP transport verification test PASSED")
    print(f"   Alice connector: {type(alice_connector).__name__}")
    print(f"   Bob connector: {type(bob_connector).__name__}")
    print(f"   File operations working correctly via HTTP transport")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s", "--tb=short"])
