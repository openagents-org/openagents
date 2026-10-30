"""
Test cases for the workspace documents mod using gRPC transport.

This test suite validates the document management functionality
including document creation, saving, renaming, and history tracking.
"""

import pytest
import asyncio
import tempfile
import yaml
from pathlib import Path
from typing import Dict, Any

from openagents.sdk.client import AgentClient
from openagents.launchers.network_launcher import load_network_config
from openagents.sdk.network import AgentNetwork
from openagents.mods.workspace.documents import SharedDocumentAgentAdapter


@pytest.fixture
async def documents_network():
    """Create a test network with workspace documents mod enabled."""

    # Load the workspace test configuration
    config_path = (
        Path(__file__).parent.parent.parent / "examples" / "workspace_test.yaml"
    )

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

    try:
        # Initialize with timeout
        await asyncio.wait_for(network.initialize(), timeout=10.0)
    except asyncio.TimeoutError:
        pytest.fail("Network initialization timed out after 10 seconds")

    # Give network time to start up
    await asyncio.sleep(1.0)

    yield network, config, grpc_port, http_port

    # Cleanup
    try:
        await asyncio.wait_for(network.shutdown(), timeout=5.0)
    except asyncio.TimeoutError:
        print("Warning: Network shutdown timed out")


@pytest.fixture
async def alice_client(documents_network):
    """Create Alice client with documents adapter."""
    network, config, grpc_port, http_port = documents_network

    # Create client
    client = AgentClient(agent_id="alice")

    # Add documents adapter
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)

    # Connect to network using HTTP (like other tests) with timeout
    try:
        await asyncio.wait_for(
            client.connect("localhost", http_port),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        pytest.fail("Alice client connection timed out after 5 seconds")

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client, documents_adapter

    # Cleanup
    try:
        await asyncio.wait_for(client.disconnect(), timeout=3.0)
    except asyncio.TimeoutError:
        print("Warning: Alice client disconnect timed out")


@pytest.fixture
async def bob_client(documents_network):
    """Create Bob client with documents adapter."""
    network, config, grpc_port, http_port = documents_network

    # Create client
    client = AgentClient(agent_id="bob")

    # Add documents adapter
    documents_adapter = SharedDocumentAgentAdapter()
    client.register_mod_adapter(documents_adapter)

    # Connect to network using HTTP (like other tests) with timeout
    try:
        await asyncio.wait_for(
            client.connect("localhost", http_port),
            timeout=5.0
        )
    except asyncio.TimeoutError:
        pytest.fail("Bob client connection timed out after 5 seconds")

    # Give client time to connect and register
    await asyncio.sleep(1.0)

    yield client, documents_adapter

    # Cleanup
    try:
        await asyncio.wait_for(client.disconnect(), timeout=3.0)
    except asyncio.TimeoutError:
        print("Warning: Bob client disconnect timed out")


@pytest.mark.asyncio
async def test_document_creation(alice_client):
    """Test basic document creation functionality."""
    client, adapter = alice_client

    # Create a document
    result = await adapter.create_document(
        document_name="Test Document",
        initial_content="# Test Document\n\nThis is a test document.",
        access_permissions={"bob": "read_write"},
    )

    # Verify creation was successful
    assert result["status"] == "success"
    assert "document_id" in result.get("data", {})

    document_id = result["data"]["document_id"]
    assert document_id is not None


@pytest.mark.asyncio
async def test_document_collaboration(alice_client, bob_client):
    """Test document sharing and access between two agents."""
    alice, alice_adapter = alice_client
    bob, bob_adapter = bob_client

    # Alice creates a document
    create_result = await alice_adapter.create_document(
        document_name="Collaborative Doc",
        initial_content="Initial content by Alice",
        access_permissions={"bob": "read_write"},
    )

    assert create_result["status"] == "success", f"Create failed: {create_result}"
    assert "document_id" in create_result.get("data", {}), f"No document_id in response: {create_result}"
    document_id = create_result["data"]["document_id"]

    # Give a small delay for propagation
    await asyncio.sleep(0.1)

    # Bob gets the document
    get_result = await bob_adapter.get_document(document_id)
    assert get_result["status"] == "success", f"Bob get failed: {get_result}"
    assert "content" in get_result.get("data", {}), f"No content in response: {get_result}"
    assert "Initial content by Alice" in get_result["data"]["content"], \
        f"Expected content not found: {get_result['data']['content']}"

    # Bob saves updated content
    save_result = await bob_adapter.save_document(
        document_id=document_id,
        content="Initial content by Alice\n\nUpdated by Bob"
    )
    assert save_result["status"] == "success", f"Bob save failed: {save_result}"

    # Give a small delay for propagation
    await asyncio.sleep(0.1)

    # Alice gets the document to verify Bob's changes
    content_result = await alice_adapter.get_document(document_id)
    assert content_result["status"] == "success", f"Alice get failed: {content_result}"
    assert "Updated by Bob" in content_result["data"]["content"], \
        f"Bob's update not found: {content_result['data']['content']}"


@pytest.mark.asyncio
async def test_document_operations(alice_client):
    """Test various document operations (save and rename)."""
    client, adapter = alice_client

    # Create a document
    create_result = await adapter.create_document(
        document_name="Operations Test",
        initial_content="Original content",
    )

    assert create_result["status"] == "success", f"Create failed: {create_result}"
    document_id = create_result["data"]["document_id"]

    # Test saving content
    save_result = await adapter.save_document(
        document_id=document_id,
        content="Updated content v1"
    )
    assert save_result["status"] == "success", f"Save failed: {save_result}"

    # Give a small delay for propagation
    await asyncio.sleep(0.1)

    # Verify content was saved
    get_result = await adapter.get_document(document_id)
    assert get_result["status"] == "success", f"Get after save failed: {get_result}"
    actual_content = get_result["data"].get("content", "")
    assert actual_content == "Updated content v1", \
        f"Expected 'Updated content v1', got '{actual_content}'"

    # Test renaming
    rename_result = await adapter.rename_document(
        document_id=document_id,
        new_name="Renamed Operations Test"
    )
    assert rename_result["status"] == "success", f"Rename failed: {rename_result}"

    # Give a small delay for propagation
    await asyncio.sleep(0.1)

    # Verify rename
    get_result = await adapter.get_document(document_id)
    assert get_result["status"] == "success", f"Get after rename failed: {get_result}"
    actual_name = get_result["data"].get("document_name", "")
    assert actual_name == "Renamed Operations Test", \
        f"Expected 'Renamed Operations Test', got '{actual_name}'"


@pytest.mark.asyncio
async def test_document_comments(alice_client, bob_client):
    """Test document history tracking (replaces comment functionality)."""
    alice, alice_adapter = alice_client
    bob, bob_adapter = bob_client

    # Create a document
    create_result = await alice_adapter.create_document(
        document_name="History Test",
        initial_content="Initial content",
        access_permissions={"bob": "read_write"},
    )

    assert create_result["status"] == "success", f"Create failed: {create_result}"
    document_id = create_result["data"]["document_id"]

    # Alice saves the document
    save_result_alice = await alice_adapter.save_document(
        document_id=document_id,
        content="Content updated by Alice"
    )
    assert save_result_alice["status"] == "success", f"Alice save failed: {save_result_alice}"

    # Bob saves the document
    save_result_bob = await bob_adapter.save_document(
        document_id=document_id,
        content="Content updated by Bob"
    )
    assert save_result_bob["status"] == "success", f"Bob save failed: {save_result_bob}"

    # Get document history with retry for robustness
    max_retries = 3
    for attempt in range(max_retries):
        history_result = await alice_adapter.get_document_history(document_id)
        if history_result["status"] == "success":
            break
        if attempt < max_retries - 1:
            await asyncio.sleep(0.5)

    assert history_result["status"] == "success", f"History retrieval failed: {history_result}"

    # Verify operations are tracked
    operations = history_result["data"]["operations"]
    assert len(operations) >= 3, f"Expected at least 3 operations, got {len(operations)}: {operations}"

    operation_types = [op.get("operation_type") for op in operations]
    assert "create" in operation_types, f"'create' not found in operation types: {operation_types}"
    assert "save" in operation_types, f"'save' not found in operation types: {operation_types}"


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
    """Test version tracking (replaces presence functionality)."""
    alice, alice_adapter = alice_client
    bob, bob_adapter = bob_client

    # Create a document
    create_result = await alice_adapter.create_document(
        document_name="Version Test",
        initial_content="Test content",
        access_permissions={"bob": "read_write"},
    )

    assert create_result["status"] == "success", f"Create failed: {create_result}"
    document_id = create_result["data"]["document_id"]

    # Give a small delay for propagation
    await asyncio.sleep(0.1)

    # Get initial version
    get_result = await alice_adapter.get_document(document_id)
    assert get_result["status"] == "success", f"Initial get failed: {get_result}"
    initial_version = get_result["data"]["version"]

    # Alice saves - version should increment
    save_result = await alice_adapter.save_document(document_id, "Updated by Alice")
    assert save_result["status"] == "success", f"Alice save failed: {save_result}"

    await asyncio.sleep(0.1)

    get_result = await alice_adapter.get_document(document_id)
    assert get_result["status"] == "success", f"Get after Alice save failed: {get_result}"
    version_after_alice = get_result["data"]["version"]
    assert version_after_alice > initial_version, \
        f"Version did not increment: initial={initial_version}, after_alice={version_after_alice}"

    # Bob saves - version should increment again
    save_result = await bob_adapter.save_document(document_id, "Updated by Bob")
    assert save_result["status"] == "success", f"Bob save failed: {save_result}"

    await asyncio.sleep(0.1)

    get_result = await bob_adapter.get_document(document_id)
    assert get_result["status"] == "success", f"Get after Bob save failed: {get_result}"
    version_after_bob = get_result["data"]["version"]
    assert version_after_bob > version_after_alice, \
        f"Version did not increment: after_alice={version_after_alice}, after_bob={version_after_bob}"


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])
