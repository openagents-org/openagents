"""
Tests for the Shared Document mod.

This module contains comprehensive unit and integration tests for the shared document
functionality including:
- All 13 tools (create_document, open_document, insert_lines, etc.)
- Document operations (insert, remove, replace lines)
- Commenting system with line-specific comments
- Agent presence tracking and cursor positions
- Conflict resolution and version control
- Permission management (read_only, read_write, admin)
- Real-time synchronization and event handling
"""

import pytest
import asyncio
import uuid
import json
from datetime import datetime
from unittest.mock import Mock, AsyncMock, patch
from typing import Dict, Any, List

from openagents.mods.communication.shared_document import (
    SharedDocumentAgentAdapter,
    SharedDocumentNetworkMod,
    SharedDocument
)
from openagents.mods.communication.shared_document.document_messages import (
    CreateDocumentMessage,
    OpenDocumentMessage,
    CloseDocumentMessage,
    InsertLinesMessage,
    RemoveLinesMessage,
    ReplaceLinesMessage,
    AddCommentMessage,
    RemoveCommentMessage,
    UpdateCursorPositionMessage,
    GetDocumentContentMessage,
    GetDocumentHistoryMessage,
    ListDocumentsMessage,
    GetAgentPresenceMessage,
    DocumentOperationResponse,
    DocumentContentResponse,
    DocumentListResponse,
    DocumentHistoryResponse,
    AgentPresenceResponse,
    CursorPosition,
    DocumentComment
)
from openagents.models.messages import ModMessage


def wrap_message_for_mod(inner_message) -> ModMessage:
    """Helper function to wrap inner messages in ModMessage for testing."""
    return ModMessage(
        mod_name="shared_document",
        content=inner_message.model_dump(),
        source_agent_id=inner_message.source_agent_id,
        target_agent_id=getattr(inner_message, 'target_agent_id', None)
    )


class TestSharedDocumentNetworkMod:
    """Test cases for the SharedDocumentNetworkMod."""

    @pytest.fixture
    def network_mod(self):
        """Create a SharedDocumentNetworkMod instance for testing."""
        mod = SharedDocumentNetworkMod()
        mock_network = Mock()
        mock_network.node_id = "network_node"
        mock_network.send_message = AsyncMock()
        mod.bind_network(mock_network)
        return mod

    @pytest.fixture
    def sample_document(self):
        """Create a sample document for testing."""
        return SharedDocument(
            document_id="test-doc-123",
            name="Test Document",
            creator_agent_id="creator_agent",
            initial_content="Line 1\nLine 2\nLine 3"
        )

    def test_shared_document_creation(self, sample_document):
        """Test SharedDocument class initialization."""
        assert sample_document.document_id == "test-doc-123"
        assert sample_document.name == "Test Document"
        assert sample_document.creator_agent_id == "creator_agent"
        assert sample_document.content == ["Line 1", "Line 2", "Line 3"]
        assert sample_document.version == 1
        assert len(sample_document.comments) == 0
        assert len(sample_document.agent_presence) == 0

    def test_document_add_agent(self, sample_document):
        """Test adding an agent to a document."""
        result = sample_document.add_agent("test_agent", "read_write")
        
        assert result is True
        assert "test_agent" in sample_document.access_permissions
        assert sample_document.access_permissions["test_agent"] == "read_write"
        assert "test_agent" in sample_document.active_agents
        assert "test_agent" in sample_document.agent_presence

    def test_document_permissions(self, sample_document):
        """Test permission checking."""
        sample_document.add_agent("reader", "read_only")
        sample_document.add_agent("writer", "read_write")
        sample_document.add_agent("admin", "admin")

        # Read-only permissions
        assert sample_document.has_permission("reader", "read") is True
        assert sample_document.has_permission("reader", "comment") is True
        assert sample_document.has_permission("reader", "write") is False

        # Read-write permissions
        assert sample_document.has_permission("writer", "read") is True
        assert sample_document.has_permission("writer", "write") is True

        # Admin permissions
        assert sample_document.has_permission("admin", "read") is True
        assert sample_document.has_permission("admin", "write") is True

        # No permission
        assert sample_document.has_permission("unknown", "read") is False

    def test_document_insert_lines(self, sample_document):
        """Test inserting lines into a document."""
        sample_document.add_agent("test_agent", "read_write")
        
        operation = sample_document.insert_lines(
            agent_id="test_agent",
            line_number=2,
            content=["New line 1", "New line 2"]
        )

        assert operation.operation_type == "insert_lines"
        assert operation.agent_id == "test_agent"
        assert sample_document.content == [
            "Line 1", "New line 1", "New line 2", "Line 2", "Line 3"
        ]
        assert sample_document.version == 2
        assert len(sample_document.operation_history) == 1

    def test_document_remove_lines(self, sample_document):
        """Test removing lines from a document."""
        sample_document.add_agent("test_agent", "read_write")
        
        operation = sample_document.remove_lines(
            agent_id="test_agent",
            start_line=2,
            end_line=2
        )

        assert operation.operation_type == "remove_lines"
        assert sample_document.content == ["Line 1", "Line 3"]
        assert sample_document.version == 2

    def test_document_replace_lines(self, sample_document):
        """Test replacing lines in a document."""
        sample_document.add_agent("test_agent", "read_write")
        
        operation = sample_document.replace_lines(
            agent_id="test_agent",
            start_line=2,
            end_line=3,
            content=["Replaced line", "Another replaced line"]
        )

        assert operation.operation_type == "replace_lines"
        assert sample_document.content == ["Line 1", "Replaced line", "Another replaced line"]
        assert sample_document.version == 2

    def test_document_add_comment(self, sample_document):
        """Test adding comments to a document."""
        sample_document.add_agent("test_agent", "read_write")
        
        comment = sample_document.add_comment(
            agent_id="test_agent",
            line_number=1,
            comment_text="This is a test comment"
        )

        assert comment.line_number == 1
        assert comment.agent_id == "test_agent"
        assert comment.comment_text == "This is a test comment"
        assert 1 in sample_document.comments
        assert len(sample_document.comments[1]) == 1

    def test_document_remove_comment(self, sample_document):
        """Test removing comments from a document."""
        sample_document.add_agent("test_agent", "read_write")
        
        # Add a comment first
        comment = sample_document.add_comment(
            agent_id="test_agent",
            line_number=1,
            comment_text="Test comment"
        )

        # Remove the comment
        result = sample_document.remove_comment("test_agent", comment.comment_id)
        
        assert result is True
        assert 1 not in sample_document.comments

    def test_comment_line_adjustment(self, sample_document):
        """Test that comments are adjusted when lines are inserted/removed."""
        sample_document.add_agent("test_agent", "read_write")
        
        # Add comments to lines 2 and 3
        comment1 = sample_document.add_comment("test_agent", 2, "Comment on line 2")
        comment2 = sample_document.add_comment("test_agent", 3, "Comment on line 3")

        # Insert a line at position 1
        sample_document.insert_lines("test_agent", 1, ["New first line"])

        # Comments should be shifted down
        assert 3 in sample_document.comments  # Original line 2 -> line 3
        assert 4 in sample_document.comments  # Original line 3 -> line 4
        assert sample_document.comments[3][0].line_number == 3
        assert sample_document.comments[4][0].line_number == 4

    @pytest.mark.asyncio
    async def test_create_document_message_handling(self, network_mod):
        """Test handling of create document messages."""
        message = CreateDocumentMessage(
            document_name="Test Doc",
            initial_content="Hello World",
            access_permissions={"agent2": "read_write"},
            sender_id="agent1"
        )

        await network_mod._handle_create_document(message, "agent1")

        # Check that document was created
        assert len(network_mod.documents) == 1
        doc_id = list(network_mod.documents.keys())[0]
        document = network_mod.documents[doc_id]
        
        assert document.name == "Test Doc"
        assert document.content == ["Hello World"]
        assert document.creator_agent_id == "agent1"
        assert "agent1" in document.access_permissions
        assert document.access_permissions["agent1"] == "admin"

    @pytest.mark.asyncio
    async def test_insert_lines_message_handling(self, network_mod):
        """Test handling of insert lines messages."""
        # First create a document
        document = SharedDocument("doc-123", "Test", "agent1", "Line 1\nLine 2")
        document.add_agent("agent1", "admin")
        network_mod.documents["doc-123"] = document

        message = InsertLinesMessage(
            document_id="doc-123",
            line_number=2,
            content=["Inserted line"],
            sender_id="agent1"
        )

        await network_mod._handle_insert_lines(message, "agent1")

        # Check that lines were inserted
        assert document.content == ["Line 1", "Inserted line", "Line 2"]
        assert document.version == 2

    @pytest.mark.asyncio
    async def test_add_comment_message_handling(self, network_mod):
        """Test handling of add comment messages."""
        # Create a document
        document = SharedDocument("doc-123", "Test", "agent1", "Line 1\nLine 2")
        document.add_agent("agent1", "admin")
        network_mod.documents["doc-123"] = document

        message = AddCommentMessage(
            document_id="doc-123",
            line_number=1,
            comment_text="Test comment",
            sender_id="agent1"
        )

        await network_mod._handle_add_comment(message, "agent1")

        # Check that comment was added
        assert 1 in document.comments
        assert len(document.comments[1]) == 1
        assert document.comments[1][0].comment_text == "Test comment"


class TestSharedDocumentAgentAdapter:
    """Test cases for the SharedDocumentAgentAdapter."""

    @pytest.fixture
    def agent_adapter(self):
        """Create a SharedDocumentAgentAdapter instance for testing."""
        adapter = SharedDocumentAgentAdapter()
        adapter.bind_agent("test_agent")
        adapter.network_interface = Mock()
        adapter.network_interface.send_mod_message = AsyncMock()
        return adapter

    def test_adapter_initialization(self, agent_adapter):
        """Test adapter initialization."""
        assert agent_adapter.mod_name == "shared_document"
        assert agent_adapter.agent_id == "test_agent"
        assert len(agent_adapter.document_handlers) == 0
        assert len(agent_adapter.operation_handlers) == 0
        assert len(agent_adapter.presence_handlers) == 0

    def test_get_tools(self, agent_adapter):
        """Test that all expected tools are provided."""
        tools = agent_adapter.get_tools()
        tool_names = [tool.name for tool in tools]
        
        expected_tools = [
            "create_document", "open_document", "close_document",
            "insert_lines", "remove_lines", "replace_lines",
            "add_comment", "remove_comment", "update_cursor_position",
            "get_document_content", "get_document_history",
            "list_documents", "get_agent_presence"
        ]
        
        assert len(tools) == 13
        for expected_tool in expected_tools:
            assert expected_tool in tool_names

    @pytest.mark.asyncio
    async def test_create_document_tool(self, agent_adapter):
        """Test the create_document tool."""
        result = await agent_adapter.create_document(
            document_name="Test Document",
            initial_content="Hello World",
            access_permissions={"agent2": "read_write"}
        )

        assert result["status"] == "success"
        assert "Document creation request sent" in result["message"]
        
        # Check that message was sent
        agent_adapter.network_interface.send_mod_message.assert_called_once()
        call_args = agent_adapter.network_interface.send_mod_message.call_args[0][0]
        assert call_args.mod == "shared_document"
        content = call_args.content
        assert content["message_type"] == "create_document"
        assert content["document_name"] == "Test Document"

    @pytest.mark.asyncio
    async def test_insert_lines_tool(self, agent_adapter):
        """Test the insert_lines tool."""
        result = await agent_adapter.insert_lines(
            document_id="doc-123",
            line_number=5,
            content=["Line 1", "Line 2"]
        )

        assert result["status"] == "success"
        assert "Insert operation sent" in result["message"]
        
        # Check message content
        call_args = agent_adapter.network_interface.send_mod_message.call_args[0][0]
        content = call_args.content
        assert content["message_type"] == "insert_lines"
        assert content["document_id"] == "doc-123"
        assert content["line_number"] == 5
        assert content["content"] == ["Line 1", "Line 2"]

    @pytest.mark.asyncio
    async def test_add_comment_tool(self, agent_adapter):
        """Test the add_comment tool."""
        result = await agent_adapter.add_comment(
            document_id="doc-123",
            line_number=3,
            comment_text="This is a comment"
        )

        assert result["status"] == "success"
        assert "Comment added to line 3" in result["message"]

    @pytest.mark.asyncio
    async def test_update_cursor_position_tool(self, agent_adapter):
        """Test the update_cursor_position tool."""
        result = await agent_adapter.update_cursor_position(
            document_id="doc-123",
            line_number=10,
            column_number=25
        )

        assert result["status"] == "success"
        assert "Cursor position updated" in result["message"]
        
        # Check local tracking
        assert "doc-123" in agent_adapter.agent_cursors
        cursor = agent_adapter.agent_cursors["doc-123"]
        assert cursor.line_number == 10
        assert cursor.column_number == 25

    def test_event_handler_registration(self, agent_adapter):
        """Test registering event handlers."""
        def mock_document_handler(event_data):
            pass
        
        def mock_operation_handler(op_type, op_data):
            pass
        
        def mock_presence_handler(doc_id, presence_list):
            pass

        agent_adapter.register_document_handler("doc_handler", mock_document_handler)
        agent_adapter.register_operation_handler("op_handler", mock_operation_handler)
        agent_adapter.register_presence_handler("presence_handler", mock_presence_handler)

        assert "doc_handler" in agent_adapter.document_handlers
        assert "op_handler" in agent_adapter.operation_handlers
        assert "presence_handler" in agent_adapter.presence_handlers

    @pytest.mark.asyncio
    async def test_incoming_message_processing(self, agent_adapter):
        """Test processing of incoming messages."""
        # Mock handlers
        doc_handler = Mock()
        op_handler = Mock()
        
        agent_adapter.register_document_handler("test", doc_handler)
        agent_adapter.register_operation_handler("test", op_handler)

        # Test document content response
        content_response = {
            "message_type": "document_content_response",
            "document_id": "doc-123",
            "content": ["line 1", "line 2"],
            "comments": [],
            "agent_presence": [],
            "version": 1
        }

        await agent_adapter.process_incoming_message(content_response, "network")
        
        # Check that document handler was called
        doc_handler.assert_called_once()
        call_args = doc_handler.call_args[0][0]
        assert call_args["event"] == "content_updated"
        assert call_args["document_id"] == "doc-123"

        # Check local state was updated
        assert "doc-123" in agent_adapter.open_documents
        doc_state = agent_adapter.open_documents["doc-123"]
        assert doc_state["content"] == ["line 1", "line 2"]
        assert doc_state["version"] == 1


class TestMessageValidation:
    """Test message validation and data models."""

    def test_cursor_position_validation(self):
        """Test CursorPosition validation."""
        # Valid cursor position
        cursor = CursorPosition(line_number=5, column_number=10)
        assert cursor.line_number == 5
        assert cursor.column_number == 10

        # Invalid line number
        with pytest.raises(ValueError, match="Position values must be 1 or greater"):
            CursorPosition(line_number=0, column_number=1)

    def test_document_comment_validation(self):
        """Test DocumentComment validation."""
        # Valid comment
        comment = DocumentComment(
            line_number=1,
            agent_id="test_agent",
            comment_text="Valid comment"
        )
        assert comment.line_number == 1
        assert comment.comment_text == "Valid comment"

        # Invalid line number
        with pytest.raises(ValueError, match="Line number must be 1 or greater"):
            DocumentComment(
                line_number=0,
                agent_id="test_agent",
                comment_text="Comment"
            )

        # Empty comment text
        with pytest.raises(ValueError, match="Comment text cannot be empty"):
            DocumentComment(
                line_number=1,
                agent_id="test_agent",
                comment_text=""
            )

    def test_insert_lines_message_validation(self):
        """Test InsertLinesMessage validation."""
        # Valid message
        message = InsertLinesMessage(
            document_id="doc-123",
            line_number=5,
            content=["line 1", "line 2"],
            sender_id="agent1"
        )
        assert message.line_number == 5
        assert message.content == ["line 1", "line 2"]

        # Invalid line number
        with pytest.raises(ValueError, match="Line number must be 1 or greater"):
            InsertLinesMessage(
                document_id="doc-123",
                line_number=0,
                content=["line 1"],
                sender_id="agent1"
            )

        # Empty content
        with pytest.raises(ValueError, match="Content cannot be empty"):
            InsertLinesMessage(
                document_id="doc-123",
                line_number=1,
                content=[],
                sender_id="agent1"
            )


class TestIntegrationScenarios:
    """Test complete integration scenarios."""

    @pytest.fixture
    def setup_network_and_agents(self):
        """Set up network mod and multiple agent adapters."""
        network_mod = SharedDocumentNetworkMod()
        mock_network = Mock()
        mock_network.node_id = "network"
        mock_network.send_message = AsyncMock()
        network_mod.bind_network(mock_network)

        # Create multiple agents
        agents = {}
        for agent_id in ["agent1", "agent2", "agent3"]:
            adapter = SharedDocumentAgentAdapter()
            adapter.bind_agent(agent_id)
            adapter.network_interface = Mock()
            adapter.network_interface.send_mod_message = AsyncMock()
            agents[agent_id] = adapter

        return network_mod, agents

    @pytest.mark.asyncio
    async def test_collaborative_editing_scenario(self, setup_network_and_agents):
        """Test a complete collaborative editing scenario."""
        network_mod, agents = setup_network_and_agents

        # Agent1 creates a document
        create_msg = CreateDocumentMessage(
            document_name="Collaborative Doc",
            initial_content="Line 1\nLine 2",
            access_permissions={
                "agent2": "read_write",
                "agent3": "read_only"
            },
            sender_id="agent1"
        )

        await network_mod._handle_create_document(create_msg, "agent1")
        
        # Get the created document
        doc_id = list(network_mod.documents.keys())[0]
        document = network_mod.documents[doc_id]

        # Agent2 opens the document
        open_msg = OpenDocumentMessage(
            document_id=doc_id,
            sender_id="agent2"
        )
        await network_mod._handle_open_document(open_msg, "agent2")

        # Agent2 inserts lines
        insert_msg = InsertLinesMessage(
            document_id=doc_id,
            line_number=2,
            content=["Inserted by agent2"],
            sender_id="agent2"
        )
        await network_mod._handle_insert_lines(insert_msg, "agent2")

        # Agent3 adds a comment (read-only can comment)
        comment_msg = AddCommentMessage(
            document_id=doc_id,
            line_number=1,
            comment_text="Great start!",
            sender_id="agent3"
        )
        await network_mod._handle_add_comment(comment_msg, "agent3")

        # Verify final state
        assert document.content == ["Line 1", "Inserted by agent2", "Line 2"]
        assert document.version == 2  # Created (v1) + insert (v2), comments don't increment version
        assert 1 in document.comments
        assert document.comments[1][0].comment_text == "Great start!"
        assert "agent1" in document.active_agents
        assert "agent2" in document.active_agents

    @pytest.mark.asyncio
    async def test_permission_enforcement(self, setup_network_and_agents):
        """Test that permissions are properly enforced."""
        network_mod, agents = setup_network_and_agents

        # Create document with read-only access for agent2
        document = SharedDocument("doc-123", "Test", "agent1", "Content")
        document.add_agent("agent1", "admin")
        document.add_agent("agent2", "read_only")
        network_mod.documents["doc-123"] = document

        # Agent2 tries to insert lines (should fail due to permissions)
        insert_msg = InsertLinesMessage(
            document_id="doc-123",
            line_number=1,
            content=["Unauthorized edit"],
            sender_id="agent2"
        )

        # The method logs the error but doesn't raise it, so check the document unchanged
        await network_mod._handle_insert_lines(insert_msg, "agent2")

        # Document should remain unchanged
        assert document.content == ["Content"]
        assert document.version == 1

    @pytest.mark.asyncio 
    async def test_conflict_resolution(self, setup_network_and_agents):
        """Test conflict resolution with simultaneous operations."""
        network_mod, agents = setup_network_and_agents

        # Create document
        document = SharedDocument("doc-123", "Test", "agent1", "Line 1\nLine 2\nLine 3")
        document.add_agent("agent1", "admin")
        document.add_agent("agent2", "read_write")
        network_mod.documents["doc-123"] = document

        # Simulate simultaneous operations
        # Agent1 inserts at line 2
        insert_msg1 = InsertLinesMessage(
            document_id="doc-123",
            line_number=2,
            content=["Agent1 insert"],
            sender_id="agent1"
        )

        # Agent2 also inserts at line 2 (conflict)
        insert_msg2 = InsertLinesMessage(
            document_id="doc-123",
            line_number=2,
            content=["Agent2 insert"],
            sender_id="agent2"
        )

        # Apply operations in sequence (last-write-wins)
        await network_mod._handle_insert_lines(insert_msg1, "agent1")
        await network_mod._handle_insert_lines(insert_msg2, "agent2")

        # Both operations should succeed, with agent2's coming last
        assert "Agent1 insert" in document.content
        assert "Agent2 insert" in document.content
        assert document.version == 3  # Original + 2 inserts


if __name__ == "__main__":
    # Run the tests
    pytest.main([__file__, "-v"])
