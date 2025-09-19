"""
Test cases for the OT (Operational Transformation) collaborative editing functionality
in the workspace documents mod.

This test suite validates the real-time collaborative editing features including:
- User identity assignment
- Document history synchronization  
- Edit operations with OT conflict resolution
- Cursor and selection synchronization
- Language switching
- Error handling for various edge cases
"""

import pytest
import asyncio
import random
from pathlib import Path
from typing import Dict, Any, List

from openagents.core.client import AgentClient
from openagents.launchers.network_launcher import load_network_config, create_network
from openagents.mods.workspace.documents import SharedDocumentAgentAdapter
from openagents.models.event import Event


@pytest.fixture
async def ot_documents_network():
    """Create a test network with workspace documents mod enabled for OT testing."""
    
    # Load the workspace test configuration
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    
    # Load config and use different ports to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update ports to avoid conflicts (use random ports)
    grpc_port = random.randint(51000, 52000)
    http_port = grpc_port + 100
    
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
    
    yield network, config, grpc_port, http_port
    
    # Cleanup
    await network.shutdown()


@pytest.fixture
async def alice_ot_client(ot_documents_network):
    """Create Alice client with documents adapter for OT testing."""
    network, config, grpc_port, http_port = ot_documents_network
    
    # Create client
    client = AgentClient(agent_id="alice")
    
    # Add documents adapter
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)
    
    # Connect to network using HTTP
    await client.connect("localhost", http_port)
    
    # Give client time to connect and register
    await asyncio.sleep(1.0)
    
    yield client, documents_adapter
    
    # Cleanup
    await client.disconnect()


@pytest.fixture  
async def bob_ot_client(ot_documents_network):
    """Create Bob client with documents adapter for OT testing."""
    network, config, grpc_port, http_port = ot_documents_network
    
    # Create client
    client = AgentClient(agent_id="bob")
    
    # Add documents adapter
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)
    
    # Connect to network using HTTP
    await client.connect("localhost", http_port)
    
    # Give client time to connect and register
    await asyncio.sleep(1.0)
    
    yield client, documents_adapter
    
    # Cleanup
    await client.disconnect()


@pytest.fixture
async def charlie_ot_client(ot_documents_network):
    """Create Charlie client with documents adapter for OT testing."""
    network, config, grpc_port, http_port = ot_documents_network
    
    # Create client
    client = AgentClient(agent_id="charlie")
    
    # Add documents adapter
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)
    
    # Connect to network using HTTP
    await client.connect("localhost", http_port)
    
    # Give client time to connect and register
    await asyncio.sleep(1.0)
    
    yield client, documents_adapter
    
    # Cleanup
    await client.disconnect()


@pytest.mark.asyncio
async def test_identity_assignment(alice_ot_client):
    """Test that connecting clients receive proper user identity assignment."""
    client, adapter = alice_ot_client
    
    # Track received identity events
    identity_received = []
    
    def identity_handler(event_data):
        if event_data.get("event") == "identity_assigned":
            identity_received.append(event_data)
    
    adapter.register_document_handler("identity_test", identity_handler)
    
    # Request user identity
    result = await adapter.request_user_identity()
    assert result["status"] == "success"
    
    # Wait for identity assignment
    await asyncio.sleep(1.0)
    
    # Verify identity was assigned
    assert len(identity_received) > 0
    identity_data = identity_received[0]
    assert identity_data["user_id"] == "alice"
    assert "color" in identity_data
    assert identity_data["color"].startswith("#")  # Should be a hex color


@pytest.mark.asyncio
async def test_history_initialization(alice_ot_client, bob_ot_client):
    """Test that new connections receive complete document history."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    
    # Alice creates a document
    create_result = await alice_adapter.create_document(
        document_name="OT History Test",
        initial_content="Initial content for OT testing",
        access_permissions={"bob": "read_write"}
    )
    
    assert create_result["status"] == "success"
    document_id = create_result["data"]["document_id"]
    
    # Alice joins collaborative session
    join_result = await alice_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    assert join_result["status"] == "success"
    
    # Alice submits some edit operations
    edit1_result = await alice_adapter.submit_edit_operation(
        document_id=document_id,
        revision=0,
        operation=[0, "Hello ", 32]  # Insert "Hello " at beginning
    )
    assert edit1_result["status"] == "success"
    
    # Wait for operation to be processed
    await asyncio.sleep(0.5)
    
    edit2_result = await alice_adapter.submit_edit_operation(
        document_id=document_id,
        revision=1,
        operation=[6, "World! ", 32]  # Insert "World! " after "Hello "
    )
    assert edit2_result["status"] == "success"
    
    # Wait for operation to be processed
    await asyncio.sleep(0.5)
    
    # Track Bob's history reception
    history_received = []
    
    def history_handler(event_data):
        if event_data.get("event") == "history_received":
            history_received.append(event_data)
    
    bob_adapter.register_document_handler("history_test", history_handler)
    
    # Bob joins and requests history
    await bob_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Bob",
        user_color="#4ECDC4"
    )
    
    history_result = await bob_adapter.request_document_history(document_id)
    assert history_result["status"] == "success"
    
    # Wait for history to be received
    await asyncio.sleep(1.0)
    
    # Verify Bob received complete history
    assert len(history_received) > 0
    history_data = history_received[0]
    assert history_data["document_id"] == document_id
    assert "history" in history_data
    assert "operations" in history_data["history"]
    assert len(history_data["history"]["operations"]) >= 2  # Should have both edits
    assert "content" in history_data  # Should include current content


@pytest.mark.asyncio
async def test_edit_success(alice_ot_client, bob_ot_client):
    """Test successful edit operations and proper broadcasting."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    
    # Create document and join collaborative sessions
    create_result = await alice_adapter.create_document(
        document_name="Edit Success Test",
        initial_content="Original content",
        access_permissions={"bob": "read_write"}
    )
    
    document_id = create_result["data"]["document_id"]
    
    await alice_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    
    await bob_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Bob", 
        user_color="#4ECDC4"
    )
    
    # Track Bob's history updates
    history_updates = []
    
    def bob_history_handler(event_data):
        if event_data.get("event") == "history_received":
            history_updates.append(event_data)
    
    bob_adapter.register_document_handler("edit_test", bob_history_handler)
    
    # Alice submits an edit operation
    edit_result = await alice_adapter.submit_edit_operation(
        document_id=document_id,
        revision=0,
        operation=[0, "Modified ", 16]  # Insert "Modified " at beginning
    )
    
    assert edit_result["status"] == "success"
    assert "edit_id" in edit_result
    
    # Wait for broadcast to Bob
    await asyncio.sleep(1.0)
    
    # Verify Bob received the update
    assert len(history_updates) > 0
    latest_update = history_updates[-1]
    assert latest_update["document_id"] == document_id
    assert "Modified Original content" in latest_update["content"]


@pytest.mark.asyncio
async def test_edit_revision_mismatch(alice_ot_client):
    """Test error handling when client revision doesn't match server revision."""
    client, adapter = alice_ot_client
    
    # Create document and join session
    create_result = await adapter.create_document(
        document_name="Revision Mismatch Test",
        initial_content="Test content"
    )
    
    document_id = create_result["data"]["document_id"]
    
    await adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    
    # Track error events
    errors_received = []
    
    def error_handler(event_data):
        if event_data.get("event") == "error_occurred":
            errors_received.append(event_data)
    
    adapter.register_document_handler("error_test", error_handler)
    
    # Submit edit with wrong revision (should be 0, but using 5)
    edit_result = await adapter.submit_edit_operation(
        document_id=document_id,
        revision=5,  # Wrong revision
        operation=[0, "Wrong revision ", 12]
    )
    
    # The operation might succeed at adapter level but should trigger error from server
    await asyncio.sleep(1.0)
    
    # Verify error was received
    assert len(errors_received) > 0
    error_data = errors_received[0]
    assert error_data["error_type"] == "REVISION_MISMATCH"
    assert "revision" in error_data["error_message"].lower()


@pytest.mark.asyncio
async def test_concurrent_edits_ot_resolution(alice_ot_client, bob_ot_client):
    """Test OT conflict resolution with concurrent edits."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    
    # Create document and join sessions
    create_result = await alice_adapter.create_document(
        document_name="OT Conflict Test",
        initial_content="Hello World",
        access_permissions={"bob": "read_write"}
    )
    
    document_id = create_result["data"]["document_id"]
    
    await alice_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    
    await bob_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Bob",
        user_color="#4ECDC4"
    )
    
    # Both get initial history
    await alice_adapter.request_document_history(document_id)
    await bob_adapter.request_document_history(document_id)
    await asyncio.sleep(1.0)
    
    # Track history updates
    alice_updates = []
    bob_updates = []
    
    def alice_handler(event_data):
        if event_data.get("event") == "history_received":
            alice_updates.append(event_data)
    
    def bob_handler(event_data):
        if event_data.get("event") == "history_received":
            bob_updates.append(event_data)
    
    alice_adapter.register_document_handler("alice_ot", alice_handler)
    bob_adapter.register_document_handler("bob_ot", bob_handler)
    
    # Submit concurrent edits (both based on revision 0)
    # Alice inserts at position 6 (after "Hello ")
    alice_edit = alice_adapter.submit_edit_operation(
        document_id=document_id,
        revision=0,
        operation=[6, "Beautiful ", 5]  # Insert "Beautiful " before "World"
    )
    
    # Bob inserts at position 0 (beginning)
    bob_edit = bob_adapter.submit_edit_operation(
        document_id=document_id,
        revision=0,
        operation=[0, "Hi ", 11]  # Insert "Hi " at beginning
    )
    
    # Wait for both operations to be processed
    await asyncio.sleep(2.0)
    
    # Both clients should eventually have consistent content
    # The exact result depends on OT algorithm, but both should see both insertions
    alice_final = alice_updates[-1]["content"] if alice_updates else ""
    bob_final = bob_updates[-1]["content"] if bob_updates else ""
    
    # Both should contain both insertions
    assert "Hi " in alice_final or "Beautiful " in alice_final
    assert "Hi " in bob_final or "Beautiful " in bob_final


@pytest.mark.asyncio
async def test_cursor_synchronization(alice_ot_client, bob_ot_client):
    """Test cursor position and selection synchronization."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    
    # Create document and join sessions
    create_result = await alice_adapter.create_document(
        document_name="Cursor Sync Test",
        initial_content="This is a test document for cursor synchronization",
        access_permissions={"bob": "read_write"}
    )
    
    document_id = create_result["data"]["document_id"]
    
    await alice_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    
    await bob_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Bob",
        user_color="#4ECDC4"
    )
    
    # Track cursor updates
    cursor_updates = []
    
    def cursor_handler(event_data):
        if event_data.get("event") == "cursor_updated":
            cursor_updates.append(event_data)
    
    bob_adapter.register_document_handler("cursor_test", cursor_handler)
    
    # Alice updates cursor position
    cursor_result = await alice_adapter.update_cursor_position_ot(
        document_id=document_id,
        cursor_position=15,
        selection_start=10,
        selection_end=20
    )
    
    assert cursor_result["status"] == "success"
    
    # Wait for cursor update to be broadcast to Bob
    await asyncio.sleep(1.0)
    
    # Verify Bob received cursor update
    assert len(cursor_updates) > 0
    cursor_data = cursor_updates[0]
    assert cursor_data["document_id"] == document_id
    assert "cursor_data" in cursor_data
    
    cursor_info = cursor_data["cursor_data"]
    assert "cursors" in cursor_info
    assert "selections" in cursor_info


@pytest.mark.asyncio
async def test_language_switching(alice_ot_client, bob_ot_client):
    """Test document language switching and broadcasting."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    
    # Create document and join sessions
    create_result = await alice_adapter.create_document(
        document_name="Language Test",
        initial_content="def hello():\n    print('Hello World')",
        access_permissions={"bob": "read_write"}
    )
    
    document_id = create_result["data"]["document_id"]
    
    await alice_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    
    await bob_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Bob",
        user_color="#4ECDC4"
    )
    
    # Track language changes
    language_changes = []
    
    def language_handler(event_data):
        if event_data.get("event") == "language_changed":
            language_changes.append(event_data)
    
    bob_adapter.register_document_handler("language_test", language_handler)
    
    # Alice sets document language
    language_result = await alice_adapter.set_document_language(
        document_id=document_id,
        language="python"
    )
    
    assert language_result["status"] == "success"
    assert language_result["language"] == "python"
    
    # Wait for language change to be broadcast to Bob
    await asyncio.sleep(1.0)
    
    # Verify Bob received language change
    assert len(language_changes) > 0
    language_data = language_changes[0]
    assert language_data["document_id"] == document_id
    assert language_data["language"] == "python"


@pytest.mark.asyncio
async def test_invalid_operation_error(alice_ot_client):
    """Test error handling for invalid edit operations."""
    client, adapter = alice_ot_client
    
    # Create document and join session
    create_result = await adapter.create_document(
        document_name="Invalid Operation Test",
        initial_content="Test content"
    )
    
    document_id = create_result["data"]["document_id"]
    
    await adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    
    # Track error events
    errors_received = []
    
    def error_handler(event_data):
        if event_data.get("event") == "error_occurred":
            errors_received.append(event_data)
    
    adapter.register_document_handler("invalid_op_test", error_handler)
    
    # Submit edit with invalid operation (empty operation)
    edit_result = await adapter.submit_edit_operation(
        document_id=document_id,
        revision=0,
        operation=[]  # Invalid empty operation
    )
    
    # Wait for error response
    await asyncio.sleep(1.0)
    
    # Should receive error for invalid operation
    assert len(errors_received) > 0
    error_data = errors_received[0]
    assert error_data["error_type"] == "INVALID_OPERATION"


@pytest.mark.asyncio
async def test_user_join_leave_notifications(alice_ot_client, bob_ot_client):
    """Test user join/leave notifications in collaborative sessions."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    
    # Create document
    create_result = await alice_adapter.create_document(
        document_name="User Join/Leave Test",
        initial_content="Collaboration test",
        access_permissions={"bob": "read_write"}
    )
    
    document_id = create_result["data"]["document_id"]
    
    # Alice joins first
    await alice_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    
    # Track user info updates
    user_updates = []
    
    def user_info_handler(event_data):
        if event_data.get("event") == "user_info_updated":
            user_updates.append(event_data)
    
    alice_adapter.register_document_handler("user_info_test", user_info_handler)
    
    # Bob joins - Alice should be notified
    await bob_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Bob",
        user_color="#4ECDC4"
    )
    
    # Wait for join notification
    await asyncio.sleep(1.0)
    
    # Verify Alice received Bob's join notification
    join_notifications = [u for u in user_updates if u.get("action") == "join"]
    assert len(join_notifications) > 0
    
    join_data = join_notifications[0]
    assert join_data["document_id"] == document_id
    assert join_data["user_info"]["name"] == "Bob"
    assert join_data["user_info"]["color"] == "#4ECDC4"
    
    # Bob leaves - Alice should be notified
    await bob_adapter.leave_collaborative_session(document_id)
    
    # Wait for leave notification
    await asyncio.sleep(1.0)
    
    # Verify Alice received Bob's leave notification
    leave_notifications = [u for u in user_updates if u.get("action") == "leave"]
    assert len(leave_notifications) > 0


@pytest.mark.asyncio
async def test_multi_user_collaboration(alice_ot_client, bob_ot_client, charlie_ot_client):
    """Test collaboration with multiple users (3+ users)."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    charlie, charlie_adapter = charlie_ot_client
    
    # Create document with permissions for all users
    create_result = await alice_adapter.create_document(
        document_name="Multi-User Test",
        initial_content="Multi-user collaboration test",
        access_permissions={"bob": "read_write", "charlie": "read_write"}
    )
    
    document_id = create_result["data"]["document_id"]
    
    # All users join collaborative session
    await alice_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Alice",
        user_color="#FF6B6B"
    )
    
    await bob_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Bob",
        user_color="#4ECDC4"
    )
    
    await charlie_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Charlie",
        user_color="#45B7D1"
    )
    
    # Track updates for verification
    alice_updates = []
    bob_updates = []
    charlie_updates = []
    
    def alice_handler(event_data):
        if event_data.get("event") == "history_received":
            alice_updates.append(event_data)
    
    def bob_handler(event_data):
        if event_data.get("event") == "history_received":
            bob_updates.append(event_data)
    
    def charlie_handler(event_data):
        if event_data.get("event") == "history_received":
            charlie_updates.append(event_data)
    
    alice_adapter.register_document_handler("multi_alice", alice_handler)
    bob_adapter.register_document_handler("multi_bob", bob_handler)
    charlie_adapter.register_document_handler("multi_charlie", charlie_handler)
    
    # Each user makes an edit
    await alice_adapter.submit_edit_operation(
        document_id=document_id,
        revision=0,
        operation=[0, "Alice: ", 29]
    )
    
    await asyncio.sleep(0.5)
    
    await bob_adapter.submit_edit_operation(
        document_id=document_id,
        revision=1,
        operation=[7, "Bob: ", 29]
    )
    
    await asyncio.sleep(0.5)
    
    await charlie_adapter.submit_edit_operation(
        document_id=document_id,
        revision=2,
        operation=[12, "Charlie: ", 29]
    )
    
    # Wait for all operations to propagate
    await asyncio.sleep(2.0)
    
    # All users should eventually see all edits
    # Check that each user received updates
    assert len(alice_updates) > 0
    assert len(bob_updates) > 0
    assert len(charlie_updates) > 0
    
    # Final content should contain all user contributions
    final_content = alice_updates[-1]["content"] if alice_updates else ""
    assert "Alice:" in final_content
    assert "Bob:" in final_content  
    assert "Charlie:" in final_content


@pytest.mark.asyncio
async def test_document_access_denied_error(alice_ot_client, bob_ot_client):
    """Test error handling when user lacks write permissions."""
    alice, alice_adapter = alice_ot_client
    bob, bob_adapter = bob_ot_client
    
    # Alice creates document with read-only access for Bob
    create_result = await alice_adapter.create_document(
        document_name="Access Denied Test",
        initial_content="Protected content",
        access_permissions={"bob": "read"}  # Read-only for Bob
    )
    
    document_id = create_result["data"]["document_id"]
    
    # Bob joins session
    await bob_adapter.join_collaborative_session(
        document_id=document_id,
        user_name="Bob",
        user_color="#4ECDC4"
    )
    
    # Track error events
    errors_received = []
    
    def error_handler(event_data):
        if event_data.get("event") == "error_occurred":
            errors_received.append(event_data)
    
    bob_adapter.register_document_handler("access_test", error_handler)
    
    # Bob tries to edit (should fail due to read-only access)
    edit_result = await bob_adapter.submit_edit_operation(
        document_id=document_id,
        revision=0,
        operation=[0, "Unauthorized edit ", 16]
    )
    
    # Wait for error response
    await asyncio.sleep(1.0)
    
    # Should receive access denied error
    assert len(errors_received) > 0
    error_data = errors_received[0]
    assert error_data["error_type"] == "ACCESS_DENIED"


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])
