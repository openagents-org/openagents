"""
Comprehensive integration tests for the Wiki mod.

This test suite verifies the wiki mod functionality using real gRPC clients
and network infrastructure. Tests include:

1. Wiki page creation and ownership
2. Direct editing by page owners
3. Edit proposals by non-owners
4. Proposal approval and rejection
5. Page search and discovery
6. Version history and reversion

Uses mod_test_workspace_wiki.yaml configuration with wiki mod enabled.
"""

import pytest
import asyncio
import random
import tempfile
from pathlib import Path
from typing import List, Dict, Any
from unittest.mock import AsyncMock

from openagents.core.client import AgentClient
from openagents.core.network import create_network
from openagents.launchers.network_launcher import load_network_config
from openagents.models.event import Event
from openagents.mods.workspace.wiki import WikiAgentAdapter, WikiNetworkMod


@pytest.fixture
async def wiki_network():
    """Create and start a network with wiki mod using mod_test_workspace_wiki.yaml config."""
    config_path = Path(__file__).parent.parent.parent / "examples" / "mod_test_workspace_wiki.yaml"
    
    # Load config and use random port to avoid conflicts
    config = load_network_config(str(config_path))
    
    # Update the gRPC transport port to avoid conflicts - Wiki test range: 28000-29999
    grpc_port = random.randint(28000, 29999)
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
async def alice_client(wiki_network):
    """Create Alice client for wiki tests."""
    network, config, grpc_port, http_port = wiki_network
    
    client = AgentClient(agent_id="alice")
    await client.connect("localhost", http_port)
    
    # Give client time to connect and register with wiki mod
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting alice: {e}")


@pytest.fixture
async def bob_client(wiki_network):
    """Create Bob client for wiki tests."""
    network, config, grpc_port, http_port = wiki_network
    
    client = AgentClient(agent_id="bob")
    await client.connect("localhost", http_port)
    
    # Give client time to connect and register with wiki mod
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting bob: {e}")


@pytest.fixture
async def charlie_client(wiki_network):
    """Create Charlie client for wiki tests."""
    network, config, grpc_port, http_port = wiki_network
    
    client = AgentClient(agent_id="charlie")
    await client.connect("localhost", http_port)
    
    # Give client time to connect and register with wiki mod
    await asyncio.sleep(1.0)
    
    yield client
    
    # Cleanup
    try:
        await client.disconnect()
    except Exception as e:
        print(f"Error disconnecting charlie: {e}")


class TestWikiNetworkMod:
    """Test the wiki network mod using real network and gRPC clients."""
    
    @pytest.mark.asyncio
    async def test_page_creation_with_wiki_events(self, alice_client, bob_client):
        """Test creating a wiki page using real wiki events."""
        
        print("🔍 Testing wiki page creation with real events...")
        
        # Track received messages for Alice
        alice_messages = []
        
        # Set up message handler for Alice to catch wiki responses
        async def alice_message_handler(event):
            print(f"📨 Alice received event: {event.event_name} from {event.source_id}")
            print(f"   Payload: {event.payload}")
            alice_messages.append(event)
        
        # Register handler for wiki events
        alice_client.register_event_handler(alice_message_handler, ["wiki.*"])
        
        # Alice creates a wiki page using wiki.page.create event
        create_page_event = Event(
            event_name="wiki.page.create",
            source_id="alice",
            payload={
                "source_id": "alice",
                "page_path": "ai/ethics",
                "title": "AI Ethics Guidelines",
                "wiki_content": "# AI Ethics Guidelines\n\nThis page outlines ethical guidelines for AI development and deployment.",
                "category": "policy",
                "tags": ["ai", "ethics", "guidelines"]
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="create-page-001"
        )
        
        print("📤 Alice creating wiki page 'ai/ethics'...")
        response = await alice_client.send_event(create_page_event)
        assert response is not None, "Alice should receive immediate response for page creation"
        assert response.success == True, "Page creation should be successful"
        assert response.data is not None, "Response should contain data"
        
        # Extract page creation data from immediate response
        creation_data = response.data
        assert creation_data["page_path"] == "ai/ethics", "Response should contain correct page path"
        assert creation_data["version"] == 1, "New page should be version 1"
        
        print(f"✅ Page created successfully: {creation_data['page_path']} (v{creation_data['version']})")
        
        # Wait for any notifications
        await asyncio.sleep(2.0)
        
        print("✅ Wiki page creation test PASSED")
        print(f"   Alice successfully created page: ai/ethics")
        print(f"   Page version: {creation_data['version']}")
    
    @pytest.mark.asyncio
    async def test_page_edit_by_owner(self, alice_client, bob_client):
        """Test editing a page by its owner using real wiki events."""
        
        print("🔍 Testing wiki page editing by owner...")
        
        # Track received messages for Alice
        alice_messages = []
        
        # Set up message handler for Alice
        async def alice_message_handler(event):
            print(f"📨 Alice received event: {event.event_name}")
            alice_messages.append(event)
        
        alice_client.register_event_handler(alice_message_handler, ["wiki.*"])
        
        # First, Alice creates a page
        create_page_event = Event(
            event_name="wiki.page.create",
            source_id="alice",
            payload={
                "source_id": "alice",
                "page_path": "guides/setup",
                "title": "Setup Guide",
                "wiki_content": "# Setup Guide\n\nOriginal setup instructions.",
                "category": "guides"
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="create-setup-001"
        )
        
        print("📤 Alice creating setup guide page...")
        response = await alice_client.send_event(create_page_event)
        assert response.success, "Page creation should be successful"
        
        # Wait for page creation to complete
        await asyncio.sleep(1.0)
        
        # Alice edits her own page (should succeed)
        edit_page_event = Event(
            event_name="wiki.page.edit",
            source_id="alice",
            payload={
                "source_id": "alice",
                "page_path": "guides/setup",
                "wiki_content": "# Setup Guide\n\nUpdated setup instructions with more details and examples."
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="edit-setup-001"
        )
        
        print("📤 Alice editing her own page...")
        response = await alice_client.send_event(edit_page_event)
        assert response is not None, "Alice should receive immediate response for page edit"
        assert response.success == True, "Page edit should be successful"
        assert response.data is not None, "Response should contain data"
        
        # Extract edit data from immediate response
        edit_data = response.data
        assert edit_data["page_path"] == "guides/setup", "Response should contain correct page path"
        assert edit_data["version"] == 2, "Edited page should be version 2"
        
        print(f"✅ Page edited successfully: {edit_data['page_path']} (v{edit_data['version']})")
        
        # Wait for any notifications
        await asyncio.sleep(2.0)
        
        print("✅ Wiki page edit by owner test PASSED")
        print(f"   Alice successfully edited her own page: guides/setup")
        print(f"   New version: {edit_data['version']}")
    
    @pytest.mark.asyncio
    async def test_page_edit_by_non_owner_fails(self, alice_client, bob_client):
        """Test that non-owners cannot edit pages directly using real wiki events."""
        
        print("🔍 Testing wiki page edit by non-owner (should fail)...")
        
        # Track received messages for Bob
        bob_messages = []
        
        # Set up message handler for Bob
        async def bob_message_handler(event):
            print(f"📨 Bob received event: {event.event_name}")
            bob_messages.append(event)
        
        bob_client.register_event_handler(bob_message_handler, ["wiki.*"])
        
        # First, Alice creates a page
        create_page_event = Event(
            event_name="wiki.page.create",
            source_id="alice",
            payload={
                "source_id": "alice",
                "page_path": "alice/private",
                "title": "Alice's Private Page",
                "wiki_content": "# Alice's Private Page\n\nThis is Alice's private content.",
                "category": "personal"
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="create-private-001"
        )
        
        print("📤 Alice creating private page...")
        response = await alice_client.send_event(create_page_event)
        assert response.success, "Page creation should be successful"
        
        # Wait for page creation to complete
        await asyncio.sleep(1.0)
        
        # Bob tries to edit Alice's page (should fail)
        edit_page_event = Event(
            event_name="wiki.page.edit",
            source_id="bob",
            payload={
                "source_id": "bob",
                "page_path": "alice/private",
                "wiki_content": "# Alice's Private Page\n\nBob's unauthorized edit attempt."
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="edit-private-001"
        )
        
        print("📤 Bob attempting to edit Alice's page (should fail)...")
        response = await bob_client.send_event(edit_page_event)
        assert response is not None, "Bob should receive immediate response for page edit attempt"
        assert response.success == False, "Page edit should fail for non-owner"
        assert "owner" in response.message.lower(), "Error message should mention ownership"
        
        print(f"✅ Edit correctly rejected: {response.message}")
        
        # Wait for any notifications
        await asyncio.sleep(2.0)
        
        print("✅ Wiki page edit by non-owner test PASSED")
        print(f"   Bob was correctly denied access to edit Alice's page")
        print(f"   Error message: {response.message}")
    
    @pytest.mark.asyncio
    async def test_proposal_creation_and_approval(self, alice_client, bob_client):
        """Test creating and approving an edit proposal using real wiki events."""
        
        print("🔍 Testing wiki edit proposal creation and approval...")
        
        # Track received messages for both clients
        alice_messages = []
        bob_messages = []
        
        # Set up message handlers
        async def alice_message_handler(event):
            print(f"📨 Alice received event: {event.event_name}")
            alice_messages.append(event)
        
        async def bob_message_handler(event):
            print(f"📨 Bob received event: {event.event_name}")
            bob_messages.append(event)
        
        alice_client.register_event_handler(alice_message_handler, ["wiki.*"])
        bob_client.register_event_handler(bob_message_handler, ["wiki.*"])
        
        # Alice creates a page
        create_page_event = Event(
            event_name="wiki.page.create",
            source_id="alice",
            payload={
                "source_id": "alice",
                "page_path": "community/guidelines",
                "title": "Community Guidelines",
                "wiki_content": "# Community Guidelines\n\nBasic community rules and guidelines.",
                "category": "policy"
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="create-guidelines-001"
        )
        
        print("📤 Alice creating community guidelines page...")
        response = await alice_client.send_event(create_page_event)
        assert response.success, "Page creation should be successful"
        
        # Wait for page creation to complete
        await asyncio.sleep(1.0)
        
        # Bob proposes an edit to Alice's page
        propose_edit_event = Event(
            event_name="wiki.page.proposal.create",
            source_id="bob",
            payload={
                "source_id": "bob",
                "page_path": "community/guidelines",
                "wiki_content": "# Community Guidelines\n\nExpanded community rules and guidelines with detailed examples and enforcement procedures.",
                "rationale": "Adding more comprehensive guidelines with examples to help community members understand expectations better."
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="propose-guidelines-001"
        )
        
        print("📤 Bob proposing edit to Alice's page...")
        response = await bob_client.send_event(propose_edit_event)
        assert response is not None, "Bob should receive immediate response for proposal"
        assert response.success == True, "Proposal creation should be successful"
        assert response.data is not None, "Response should contain data"
        
        # Extract proposal data from immediate response
        proposal_data = response.data
        assert "proposal_id" in proposal_data, "Response should contain proposal_id"
        proposal_id = proposal_data["proposal_id"]
        
        print(f"✅ Proposal created successfully: {proposal_id}")
        
        # Wait for proposal processing
        await asyncio.sleep(1.0)
        
        # Alice approves Bob's proposal
        approve_proposal_event = Event(
            event_name="wiki.proposal.resolve",
            source_id="alice",
            payload={
                "source_id": "alice",
                "proposal_id": proposal_id,
                "action": "approve",
                "comments": "Great improvements! Thanks for the detailed guidelines."
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="approve-proposal-001"
        )
        
        print("📤 Alice approving Bob's proposal...")
        response = await alice_client.send_event(approve_proposal_event)
        assert response is not None, "Alice should receive immediate response for approval"
        assert response.success == True, "Proposal approval should be successful"
        assert response.data is not None, "Response should contain data"
        
        # Extract approval data from immediate response
        approval_data = response.data
        assert approval_data["action"] == "approve", "Response should confirm approval"
        assert approval_data["new_version"] == 2, "Approved proposal should create version 2"
        
        print(f"✅ Proposal approved successfully, new version: {approval_data['new_version']}")
        
        # Wait for any notifications
        await asyncio.sleep(2.0)
        
        print("✅ Wiki proposal creation and approval test PASSED")
        print(f"   Bob successfully proposed edit to Alice's page")
        print(f"   Alice successfully approved the proposal")
        print(f"   New page version: {approval_data['new_version']}")
    
    @pytest.mark.asyncio
    async def test_page_search_and_retrieval(self, alice_client, bob_client, charlie_client):
        """Test wiki page search and retrieval functionality using real wiki events."""
        
        print("🔍 Testing wiki page search and retrieval...")
        
        # Track received messages for Charlie
        charlie_messages = []
        
        # Set up message handler for Charlie
        async def charlie_message_handler(event):
            print(f"📨 Charlie received event: {event.event_name}")
            charlie_messages.append(event)
        
        charlie_client.register_event_handler(charlie_message_handler, ["wiki.*"])
        
        # Alice creates multiple pages for search testing
        pages_to_create = [
            {
                "page_path": "development/python",
                "title": "Python Development Guide",
                "content": "# Python Development Guide\n\nComprehensive guide for Python development best practices.",
                "category": "technical"
            },
            {
                "page_path": "development/javascript", 
                "title": "JavaScript Development Guide",
                "content": "# JavaScript Development Guide\n\nModern JavaScript development techniques and frameworks.",
                "category": "technical"
            },
            {
                "page_path": "policy/security",
                "title": "Security Policy",
                "content": "# Security Policy\n\nOrganizational security policies and procedures.",
                "category": "policy"
            }
        ]
        
        print("📤 Alice creating multiple pages for search testing...")
        for i, page_info in enumerate(pages_to_create):
            create_event = Event(
                event_name="wiki.page.create",
                source_id="alice",
                payload={
                    "source_id": "alice",
                    "page_path": page_info["page_path"],
                    "title": page_info["title"],
                    "wiki_content": page_info["content"],
                    "category": page_info["category"]
                },
                relevant_mod="openagents.mods.workspace.wiki",
                event_id=f"create-search-{i+1}"
            )
            
            response = await alice_client.send_event(create_event)
            assert response.success, f"Page creation should be successful for {page_info['page_path']}"
            await asyncio.sleep(0.5)  # Brief pause between creations
        
        print(f"✅ Created {len(pages_to_create)} pages for search testing")
        
        # Wait for all pages to be created
        await asyncio.sleep(2.0)
        
        # Charlie searches for pages containing "development"
        search_event = Event(
            event_name="wiki.pages.search",
            source_id="charlie",
            payload={
                "source_id": "charlie",
                "query": "development",
                "limit": 10
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="search-development-001"
        )
        
        print("📤 Charlie searching for pages containing 'development'...")
        response = await charlie_client.send_event(search_event)
        assert response is not None, "Charlie should receive immediate response for search"
        assert response.success == True, "Search should be successful"
        assert response.data is not None, "Response should contain data"
        
        # Extract search results from immediate response
        search_data = response.data
        assert "pages" in search_data, "Response should contain pages list"
        
        pages = search_data["pages"]
        print(f"📋 Found {len(pages)} pages matching 'development':")
        for page in pages:
            print(f"   - {page['page_path']}: {page['title']}")
        
        # Verify search results contain expected pages
        page_paths = [p["page_path"] for p in pages]
        assert "development/python" in page_paths, "Search should find Python development page"
        assert "development/javascript" in page_paths, "Search should find JavaScript development page"
        assert "policy/security" not in page_paths, "Search should not find security policy page"
        
        print(f"✅ Search returned {len(pages)} relevant pages")
        
        # Charlie retrieves a specific page
        get_page_event = Event(
            event_name="wiki.page.get",
            source_id="charlie",
            payload={
                "source_id": "charlie",
                "page_path": "development/python"
            },
            relevant_mod="openagents.mods.workspace.wiki",
            event_id="get-python-001"
        )
        
        print("📤 Charlie retrieving Python development page...")
        response = await charlie_client.send_event(get_page_event)
        assert response is not None, "Charlie should receive immediate response for page retrieval"
        assert response.success == True, "Page retrieval should be successful"
        assert response.data is not None, "Response should contain data"
        
        # Extract page data from immediate response
        page_data = response.data
        assert page_data["page_path"] == "development/python", "Retrieved page should have correct path"
        assert page_data["title"] == "Python Development Guide", "Retrieved page should have correct title"
        assert "Python development best practices" in page_data["wiki_content"], "Retrieved page should have correct content"
        assert page_data["created_by"] == "alice", "Retrieved page should show correct creator"
        assert page_data["version"] == 1, "Retrieved page should be version 1"
        
        print(f"✅ Page retrieved successfully: {page_data['page_path']} (v{page_data['version']})")
        
        # Wait for any notifications
        await asyncio.sleep(2.0)
        
        print("✅ Wiki page search and retrieval test PASSED")
        print(f"   Alice created {len(pages_to_create)} test pages")
        print(f"   Charlie successfully searched and found {len(pages)} matching pages")
        print(f"   Charlie successfully retrieved specific page: {page_data['page_path']}")


class TestWikiAgentAdapter:
    """Test the wiki agent adapter."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.adapter = WikiAgentAdapter()
        # Use the proper bind methods
        self.adapter.bind_agent("test_agent")
        
        # Mock connector
        self.mock_connector = AsyncMock()
        self.adapter.bind_connector(self.mock_connector)
    
    def test_initialization(self):
        """Test adapter initialization."""
        assert self.adapter.initialize() is True
        assert self.adapter.shutdown() is True
    
    def test_get_tools(self):
        """Test that adapter provides the expected tools."""
        tools = self.adapter.get_tools()
        
        # Verify all expected tools are present
        tool_names = [tool.name for tool in tools]
        expected_tools = [
            "create_wiki_page",
            "edit_wiki_page", 
            "get_wiki_page",
            "search_wiki_pages",
            "list_wiki_pages",
            "propose_wiki_page_edit",
            "list_wiki_edit_proposals",
            "resolve_wiki_edit_proposal",
            "get_wiki_page_history",
            "revert_wiki_page_version"
        ]
        
        for expected_tool in expected_tools:
            assert expected_tool in tool_names
        
        # Verify tool schemas
        create_tool = next(t for t in tools if t.name == "create_wiki_page")
        assert "page_path" in create_tool.input_schema["properties"]
        assert "title" in create_tool.input_schema["properties"]
        assert "content" in create_tool.input_schema["properties"]
    
    @pytest.mark.asyncio
    async def test_create_wiki_page_call(self):
        """Test calling create_wiki_page method."""
        # Mock successful response
        self.adapter.completed_requests["test_event"] = {
            "success": True,
            "page_path": "test/page"
        }
        
        # Mock the event ID generation to return predictable value
        import uuid
        original_uuid4 = uuid.uuid4
        uuid.uuid4 = lambda: type('MockUUID', (), {'__str__': lambda self: 'test_event'})()
        
        try:
            # Call the method
            result = await self.adapter.create_wiki_page(
                "test/page",
                "Test Page", 
                "# Test\n\nContent"
            )
            
            # Verify connector was called
            assert self.mock_connector.send_event.called
            
            # Verify result
            assert result == "test/page"
        finally:
            # Restore original uuid4
            uuid.uuid4 = original_uuid4
