"""
Test cases for the workspace documents mod using gRPC transport.

This test suite validates the collaborative document editing functionality
including document creation, editing operations, and real-time synchronization.
"""

import pytest
import asyncio
import tempfile
import yaml
from pathlib import Path
from typing import Dict, Any

from openagents.core.client import AgentClient
from openagents.launchers.network_launcher import load_network_config
from openagents.core.network import AgentNetwork
from openagents.mods.workspace.documents import SharedDocumentAgentAdapter


@pytest.fixture
async def documents_network():
    """Create a test network with workspace documents mod enabled."""
    
    # Load the workspace test configuration
    config_path = Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    
    # Load config and use different ports to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update ports to avoid conflicts - Documents test range: 24000-25999
    import random
    grpc_port = random.randint(24000, 25999)
    http_port = grpc_port + 2000
    
    for transport in config.network.transports:
        if transport.type == "grpc":
            transport.config["port"] = grpc_port
        elif transport.type == "http":
            transport.config["port"] = http_port
    
    # Create and initialize network
    network = AgentNetwork.create_from_config(config.network)
    await network.initialize()
    
    # Give network time to start up
    await asyncio.sleep(1.0)
    
    yield network, config, grpc_port, http_port
    
    # Cleanup
    await network.shutdown()


@pytest.fixture
async def alice_client(documents_network):
    """Create Alice client with documents adapter."""
    network, config, grpc_port, http_port = documents_network
    
    # Create client
    client = AgentClient(agent_id="alice")
    
    # Add documents adapter
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)
    
    # Connect to network using HTTP (like other tests)
    await client.connect("localhost", http_port)
    
    # Give client time to connect and register
    await asyncio.sleep(1.0)
    
    yield client, documents_adapter
    
    # Cleanup
    await client.disconnect()


@pytest.fixture  
async def bob_client(documents_network):
    """Create Bob client with documents adapter."""
    network, config, grpc_port, http_port = documents_network
    
    # Create client
    client = AgentClient(agent_id="bob")
    
    # Add documents adapter
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)
    
    # Connect to network using HTTP (like other tests)
    await client.connect("localhost", http_port)
    
    # Give client time to connect and register
    await asyncio.sleep(1.0)
    
    yield client, documents_adapter
    
    # Cleanup
    await client.disconnect()


@pytest.mark.asyncio
async def test_document_creation(alice_client):
    """Test basic document creation functionality."""
    client, adapter = alice_client
    
    # Create a document
    result = await adapter.create_document(
        document_name="Test Document",
        initial_content="# Test Document\n\nThis is a test document.",
        access_permissions={"bob": "read_write"}
    )
    
    # Verify creation was successful
    assert result["status"] == "success"
    assert "document_id" in result.get("data", {})
    
    document_id = result["data"]["document_id"]
    assert document_id is not None


@pytest.mark.asyncio
async def test_document_collaboration(alice_client, bob_client):
    """Test collaborative document editing between two agents."""
    alice, alice_adapter = alice_client
    bob, bob_adapter = bob_client
    
    # Alice creates a document
    create_result = await alice_adapter.create_document(
        document_name="Collaborative Doc",
        initial_content="Line 1\nLine 2\nLine 3",
        access_permissions={"bob": "read_write"}
    )
    
    assert create_result["status"] == "success"
    document_id = create_result["data"]["document_id"]
    
    # Bob opens the document
    open_result = await bob_adapter.open_document(document_id)
    assert open_result["status"] == "success"
    
    # Alice inserts a line
    insert_result = await alice_adapter.insert_lines(
        document_id=document_id,
        line_number=2,
        content=["New line inserted by Alice"]
    )
    assert insert_result["status"] == "success"
    
    # Bob gets the document content to verify the change
    content_result = await bob_adapter.get_document_content(document_id)
    assert content_result["status"] == "success"
    
    # Verify the content includes Alice's insertion
    content = content_result["data"]["content"]
    assert "New line inserted by Alice" in content


@pytest.mark.asyncio
async def test_document_operations(alice_client):
    """Test various document editing operations."""
    client, adapter = alice_client
    
    # Create a document
    create_result = await adapter.create_document(
        document_name="Operations Test",
        initial_content="Line 1\nLine 2\nLine 3\nLine 4"
    )
    
    document_id = create_result["data"]["document_id"]
    
    # Test line insertion
    insert_result = await adapter.insert_lines(
        document_id=document_id,
        line_number=3,
        content=["Inserted line A", "Inserted line B"]
    )
    assert insert_result["status"] == "success"
    
    # Test line replacement
    replace_result = await adapter.replace_lines(
        document_id=document_id,
        start_line=1,
        end_line=1,
        content=["Modified Line 1"]
    )
    assert replace_result["status"] == "success"
    
    # Test line removal
    remove_result = await adapter.remove_lines(
        document_id=document_id,
        start_line=5,
        end_line=6
    )
    assert remove_result["status"] == "success"


@pytest.mark.asyncio
async def test_document_comments(alice_client, bob_client):
    """Test document commenting functionality."""
    alice, alice_adapter = alice_client
    bob, bob_adapter = bob_client
    
    # Create a document
    create_result = await alice_adapter.create_document(
        document_name="Comment Test",
        initial_content="Line 1\nLine 2\nLine 3",
        access_permissions={"bob": "read_write"}
    )
    
    document_id = create_result["data"]["document_id"]
    
    # Alice adds a comment
    comment_result = await alice_adapter.add_comment(
        document_id=document_id,
        line_number=2,
        comment_text="This line needs revision"
    )
    assert comment_result["status"] == "success"
    
    # Bob opens the document and sees the comment
    open_result = await bob_adapter.open_document(document_id)
    assert open_result["status"] == "success"
    
    # Get document content with comments
    content_result = await bob_adapter.get_document_content(
        document_id=document_id,
        include_comments=True
    )
    assert content_result["status"] == "success"
    
    # Verify comment is present
    comments = content_result["data"].get("comments", [])
    assert len(comments) > 0
    assert any("This line needs revision" in comment.get("text", "") for comment in comments)


@pytest.mark.asyncio
async def test_document_listing(alice_client):
    """Test document listing functionality."""
    client, adapter = alice_client
    
    # Create multiple documents
    doc1_result = await adapter.create_document("Document 1", "Content 1")
    doc2_result = await adapter.create_document("Document 2", "Content 2")
    
    assert doc1_result["status"] == "success"
    assert doc2_result["status"] == "success"
    
    # List documents
    list_result = await adapter.list_documents()
    assert list_result["status"] == "success"
    
    # Verify both documents are in the list
    documents = list_result["data"]["documents"]
    doc_names = [doc["name"] for doc in documents]
    assert "Document 1" in doc_names
    assert "Document 2" in doc_names


@pytest.mark.asyncio
async def test_agent_presence(alice_client, bob_client):
    """Test agent presence tracking in documents."""
    alice, alice_adapter = alice_client
    bob, bob_adapter = bob_client
    
    # Create a document
    create_result = await alice_adapter.create_document(
        document_name="Presence Test",
        initial_content="Test content",
        access_permissions={"bob": "read_write"}
    )
    
    document_id = create_result["data"]["document_id"]
    
    # Both agents open the document
    await alice_adapter.open_document(document_id)
    await bob_adapter.open_document(document_id)
    
    # Update cursor positions
    await alice_adapter.update_cursor_position(document_id, 1, 5)
    await bob_adapter.update_cursor_position(document_id, 1, 10)
    
    # Get presence information
    presence_result = await alice_adapter.get_agent_presence(document_id)
    assert presence_result["status"] == "success"
    
    # Verify both agents are present
    presence_data = presence_result["data"]["presence"]
    agent_ids = [p["agent_id"] for p in presence_data]
    assert "alice" in agent_ids
    assert "bob" in agent_ids


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])
