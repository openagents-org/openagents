"""
Tests for the Kanban board mod.

This test suite verifies the Kanban mod functionality:
- Board creation and management
- Column operations
- Card CRUD operations
- Card movement between columns
- Access control
- WIP limits
- Notifications
"""

import pytest
import time
from unittest.mock import AsyncMock, MagicMock

from openagents.mods.coordination.kanban.mod import (
    KanbanMod,
    KanbanBoard,
    KanbanColumn,
    KanbanCard,
    DEFAULT_COLUMNS,
    PRIORITY_LOW,
    PRIORITY_MEDIUM,
    PRIORITY_HIGH,
    PRIORITY_URGENT,
)
from openagents.mods.coordination.kanban.adapter import KanbanAdapter
from openagents.models.event import Event


@pytest.fixture
def mock_network():
    """Create a mock network for testing."""
    network = MagicMock()
    network.network_id = "test-network"
    network.process_event = AsyncMock(return_value=None)
    network.topology = MagicMock()
    network.topology.agent_group_membership = {
        "agent_alice": "researchers",
        "agent_bob": "researchers",
        "agent_charlie": "guests",
    }
    network.topology.agent_registry = {
        "agent_alice": {},
        "agent_bob": {},
        "agent_charlie": {},
    }
    return network


@pytest.fixture
def kanban_mod(mock_network, tmp_path):
    """Create a KanbanMod instance for testing."""
    mod = KanbanMod()

    # Mock get_storage_path to use tmp directory
    mod.get_storage_path = lambda: tmp_path / "kanban"
    (tmp_path / "kanban").mkdir(parents=True, exist_ok=True)

    mod.bind_network(mock_network)

    yield mod

    mod.shutdown()


@pytest.fixture
def kanban_adapter():
    """Create a KanbanAdapter instance for testing."""
    adapter = KanbanAdapter()
    adapter._agent_id = "test-agent"
    return adapter


class TestKanbanMod:
    """Tests for the KanbanMod network-level mod."""

    # ============ Board Tests ============

    @pytest.mark.asyncio
    async def test_create_board_success(self, kanban_mod):
        """Test successful board creation."""
        event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={
                "name": "Research Board",
                "description": "Board for research tasks",
            },
        )

        response = await kanban_mod._handle_board_create(event)

        assert response is not None
        assert response.success is True
        assert response.message == "Board created successfully"
        assert "board_id" in response.data
        assert "board" in response.data

        board = response.data["board"]
        assert board["name"] == "Research Board"
        assert board["owner_id"] == "agent_alice"
        assert len(board["columns"]) == 4  # Default columns

    @pytest.mark.asyncio
    async def test_create_board_custom_columns(self, kanban_mod):
        """Test board creation with custom columns."""
        custom_columns = [
            {"column_id": "backlog", "name": "Backlog", "position": 0},
            {"column_id": "doing", "name": "Doing", "position": 1},
            {"column_id": "done", "name": "Done", "position": 2},
        ]

        event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={
                "name": "Custom Board",
                "columns": custom_columns,
            },
        )

        response = await kanban_mod._handle_board_create(event)

        assert response.success is True
        board = response.data["board"]
        assert len(board["columns"]) == 3
        assert board["columns"][0]["column_id"] == "backlog"

    @pytest.mark.asyncio
    async def test_create_board_missing_name(self, kanban_mod):
        """Test board creation without name fails."""
        event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={
                "description": "Missing name board",
            },
        )

        response = await kanban_mod._handle_board_create(event)

        assert response.success is False
        assert "name" in response.message.lower()

    @pytest.mark.asyncio
    async def test_get_board_success(self, kanban_mod):
        """Test getting a board with cards."""
        # Create a board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Create a card
        card_event = Event(
            event_name="kanban.card.create",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "title": "Test Card",
            },
        )
        await kanban_mod._handle_card_create(card_event)

        # Get board
        get_event = Event(
            event_name="kanban.board.get",
            source_id="agent_alice",
            payload={"board_id": board_id},
        )

        response = await kanban_mod._handle_board_get(get_event)

        assert response.success is True
        assert response.data["board"]["board_id"] == board_id
        assert len(response.data["cards"]) == 1

    @pytest.mark.asyncio
    async def test_get_board_not_found(self, kanban_mod):
        """Test getting non-existent board."""
        event = Event(
            event_name="kanban.board.get",
            source_id="agent_alice",
            payload={"board_id": "non-existent"},
        )

        response = await kanban_mod._handle_board_get(event)

        assert response.success is False
        assert "not found" in response.message.lower()

    @pytest.mark.asyncio
    async def test_list_boards(self, kanban_mod):
        """Test listing accessible boards."""
        # Create multiple boards
        for i in range(3):
            event = Event(
                event_name="kanban.board.create",
                source_id="agent_alice",
                payload={"name": f"Board {i}"},
            )
            await kanban_mod._handle_board_create(event)

        # List boards
        list_event = Event(
            event_name="kanban.board.list",
            source_id="agent_alice",
            payload={},
        )

        response = await kanban_mod._handle_board_list(list_event)

        assert response.success is True
        assert len(response.data["boards"]) == 3

    @pytest.mark.asyncio
    async def test_update_board(self, kanban_mod):
        """Test updating a board."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Original Name"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Update board
        update_event = Event(
            event_name="kanban.board.update",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "name": "Updated Name",
                "description": "New description",
            },
        )

        response = await kanban_mod._handle_board_update(update_event)

        assert response.success is True
        assert response.data["board"]["name"] == "Updated Name"
        assert response.data["board"]["description"] == "New description"

    @pytest.mark.asyncio
    async def test_delete_board(self, kanban_mod):
        """Test deleting a board."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Delete Me"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Delete board
        delete_event = Event(
            event_name="kanban.board.delete",
            source_id="agent_alice",  # Owner
            payload={"board_id": board_id},
        )

        response = await kanban_mod._handle_board_delete(delete_event)

        assert response.success is True
        assert board_id not in kanban_mod.boards

    @pytest.mark.asyncio
    async def test_delete_board_non_owner_fails(self, kanban_mod):
        """Test that non-owner cannot delete board."""
        # Create board as Alice
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Alice's Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Try to delete as Bob
        delete_event = Event(
            event_name="kanban.board.delete",
            source_id="agent_bob",
            payload={"board_id": board_id},
        )

        response = await kanban_mod._handle_board_delete(delete_event)

        assert response.success is False
        assert "owner" in response.message.lower()

    # ============ Column Tests ============

    @pytest.mark.asyncio
    async def test_add_column(self, kanban_mod):
        """Test adding a column to a board."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]
        initial_columns = len(create_response.data["board"]["columns"])

        # Add column
        add_event = Event(
            event_name="kanban.column.add",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "name": "Testing",
                "position": 2,
                "wip_limit": 3,
            },
        )

        response = await kanban_mod._handle_column_add(add_event)

        assert response.success is True
        assert response.data["column"]["name"] == "Testing"
        assert response.data["column"]["wip_limit"] == 3

        # Verify column was added
        board = kanban_mod.boards[board_id]
        assert len(board.columns) == initial_columns + 1

    @pytest.mark.asyncio
    async def test_update_column(self, kanban_mod):
        """Test updating a column."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]
        column_id = create_response.data["board"]["columns"][0]["column_id"]

        # Update column
        update_event = Event(
            event_name="kanban.column.update",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "column_id": column_id,
                "name": "Updated Column",
                "wip_limit": 5,
            },
        )

        response = await kanban_mod._handle_column_update(update_event)

        assert response.success is True
        assert response.data["column"]["name"] == "Updated Column"
        assert response.data["column"]["wip_limit"] == 5

    @pytest.mark.asyncio
    async def test_delete_column(self, kanban_mod):
        """Test deleting a column."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]
        initial_columns = len(create_response.data["board"]["columns"])
        column_id = create_response.data["board"]["columns"][0]["column_id"]

        # Delete column
        delete_event = Event(
            event_name="kanban.column.delete",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "column_id": column_id,
            },
        )

        response = await kanban_mod._handle_column_delete(delete_event)

        assert response.success is True
        board = kanban_mod.boards[board_id]
        assert len(board.columns) == initial_columns - 1

    # ============ Card Tests ============

    @pytest.mark.asyncio
    async def test_create_card_success(self, kanban_mod):
        """Test successful card creation."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Create card
        card_event = Event(
            event_name="kanban.card.create",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "title": "Research AI Trends",
                "description": "Look into latest AI developments",
                "priority": PRIORITY_HIGH,
                "labels": ["research", "ai"],
            },
        )

        response = await kanban_mod._handle_card_create(card_event)

        assert response.success is True
        assert "card_id" in response.data
        card = response.data["card"]
        assert card["title"] == "Research AI Trends"
        assert card["priority"] == PRIORITY_HIGH
        assert "research" in card["labels"]

    @pytest.mark.asyncio
    async def test_create_card_with_assignee(self, kanban_mod):
        """Test card creation with assignee."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Create card with assignee
        card_event = Event(
            event_name="kanban.card.create",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "title": "Assigned Task",
                "assignee_id": "agent_bob",
            },
        )

        response = await kanban_mod._handle_card_create(card_event)

        assert response.success is True
        assert response.data["card"]["assignee_id"] == "agent_bob"

    @pytest.mark.asyncio
    async def test_update_card(self, kanban_mod):
        """Test updating a card."""
        # Create board and card
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        card_event = Event(
            event_name="kanban.card.create",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "title": "Original Title",
            },
        )
        card_response = await kanban_mod._handle_card_create(card_event)
        card_id = card_response.data["card_id"]

        # Update card
        update_event = Event(
            event_name="kanban.card.update",
            source_id="agent_alice",
            payload={
                "card_id": card_id,
                "title": "Updated Title",
                "description": "New description",
                "priority": PRIORITY_URGENT,
            },
        )

        response = await kanban_mod._handle_card_update(update_event)

        assert response.success is True
        assert response.data["card"]["title"] == "Updated Title"
        assert response.data["card"]["priority"] == PRIORITY_URGENT

    @pytest.mark.asyncio
    async def test_move_card_between_columns(self, kanban_mod):
        """Test moving a card between columns."""
        # Create board and card
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]
        columns = create_response.data["board"]["columns"]

        card_event = Event(
            event_name="kanban.card.create",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "title": "Move Me",
                "column_id": columns[0]["column_id"],  # Start in first column
            },
        )
        card_response = await kanban_mod._handle_card_create(card_event)
        card_id = card_response.data["card_id"]

        # Move to second column
        move_event = Event(
            event_name="kanban.card.move",
            source_id="agent_alice",
            payload={
                "card_id": card_id,
                "column_id": columns[1]["column_id"],
            },
        )

        response = await kanban_mod._handle_card_move(move_event)

        assert response.success is True
        assert response.data["from_column"] == columns[0]["column_id"]
        assert response.data["to_column"] == columns[1]["column_id"]
        assert response.data["card"]["column_id"] == columns[1]["column_id"]

    @pytest.mark.asyncio
    async def test_move_card_wip_limit_exceeded(self, kanban_mod):
        """Test that WIP limit prevents card movement."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Add column with WIP limit of 1
        add_column_event = Event(
            event_name="kanban.column.add",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "name": "Limited Column",
                "column_id": "limited",
                "position": 10,
                "wip_limit": 1,
            },
        )
        await kanban_mod._handle_column_add(add_column_event)

        # Create first card in limited column
        card1_event = Event(
            event_name="kanban.card.create",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "title": "Card 1",
                "column_id": "limited",
            },
        )
        await kanban_mod._handle_card_create(card1_event)

        # Create second card in different column
        card2_event = Event(
            event_name="kanban.card.create",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "title": "Card 2",
                "column_id": "todo",
            },
        )
        card2_response = await kanban_mod._handle_card_create(card2_event)
        card2_id = card2_response.data["card_id"]

        # Try to move second card to limited column
        move_event = Event(
            event_name="kanban.card.move",
            source_id="agent_alice",
            payload={
                "card_id": card2_id,
                "column_id": "limited",
            },
        )

        response = await kanban_mod._handle_card_move(move_event)

        assert response.success is False
        assert "wip limit" in response.message.lower()

    @pytest.mark.asyncio
    async def test_delete_card(self, kanban_mod):
        """Test deleting a card."""
        # Create board and card
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        card_event = Event(
            event_name="kanban.card.create",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "title": "Delete Me",
            },
        )
        card_response = await kanban_mod._handle_card_create(card_event)
        card_id = card_response.data["card_id"]

        # Delete card
        delete_event = Event(
            event_name="kanban.card.delete",
            source_id="agent_alice",
            payload={"card_id": card_id},
        )

        response = await kanban_mod._handle_card_delete(delete_event)

        assert response.success is True
        assert card_id not in kanban_mod.cards

    @pytest.mark.asyncio
    async def test_list_cards(self, kanban_mod):
        """Test listing cards on a board."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Create multiple cards
        for i in range(3):
            card_event = Event(
                event_name="kanban.card.create",
                source_id="agent_alice",
                payload={
                    "board_id": board_id,
                    "title": f"Card {i}",
                },
            )
            await kanban_mod._handle_card_create(card_event)

        # List cards
        list_event = Event(
            event_name="kanban.card.list",
            source_id="agent_alice",
            payload={"board_id": board_id},
        )

        response = await kanban_mod._handle_card_list(list_event)

        assert response.success is True
        assert len(response.data["cards"]) == 3

    @pytest.mark.asyncio
    async def test_list_cards_filter_by_column(self, kanban_mod):
        """Test listing cards filtered by column."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]
        columns = create_response.data["board"]["columns"]

        # Create cards in different columns
        for i, col in enumerate(columns[:2]):
            card_event = Event(
                event_name="kanban.card.create",
                source_id="agent_alice",
                payload={
                    "board_id": board_id,
                    "title": f"Card in {col['name']}",
                    "column_id": col["column_id"],
                },
            )
            await kanban_mod._handle_card_create(card_event)

        # List cards in first column only
        list_event = Event(
            event_name="kanban.card.list",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "column_id": columns[0]["column_id"],
            },
        )

        response = await kanban_mod._handle_card_list(list_event)

        assert response.success is True
        assert len(response.data["cards"]) == 1
        assert response.data["cards"][0]["column_id"] == columns[0]["column_id"]

    @pytest.mark.asyncio
    async def test_list_cards_filter_by_assignee(self, kanban_mod):
        """Test listing cards filtered by assignee."""
        # Create board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Test Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Create cards with different assignees
        for assignee in ["agent_alice", "agent_bob", "agent_bob"]:
            card_event = Event(
                event_name="kanban.card.create",
                source_id="agent_alice",
                payload={
                    "board_id": board_id,
                    "title": f"Card for {assignee}",
                    "assignee_id": assignee,
                },
            )
            await kanban_mod._handle_card_create(card_event)

        # List cards assigned to Bob
        list_event = Event(
            event_name="kanban.card.list",
            source_id="agent_alice",
            payload={
                "board_id": board_id,
                "assignee_id": "agent_bob",
            },
        )

        response = await kanban_mod._handle_card_list(list_event)

        assert response.success is True
        assert len(response.data["cards"]) == 2
        for card in response.data["cards"]:
            assert card["assignee_id"] == "agent_bob"

    # ============ Access Control Tests ============

    @pytest.mark.asyncio
    async def test_board_access_control_by_agent_group(self, kanban_mod):
        """Test board access control based on agent groups."""
        # Create board with restricted access
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={
                "name": "Researchers Only",
                "allowed_agent_groups": ["researchers"],
            },
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Bob (researcher) should have access
        get_event_bob = Event(
            event_name="kanban.board.get",
            source_id="agent_bob",
            payload={"board_id": board_id},
        )
        response_bob = await kanban_mod._handle_board_get(get_event_bob)
        assert response_bob.success is True

        # Charlie (guest) should not have access
        get_event_charlie = Event(
            event_name="kanban.board.get",
            source_id="agent_charlie",
            payload={"board_id": board_id},
        )
        response_charlie = await kanban_mod._handle_board_get(get_event_charlie)
        assert response_charlie.success is False
        assert "access denied" in response_charlie.message.lower()

    # ============ State Tests ============

    def test_get_state(self, kanban_mod):
        """Test getting mod state."""
        state = kanban_mod.get_state()

        assert "total_boards" in state
        assert "total_cards" in state
        assert "storage_path" in state

    # ============ Persistence Tests ============

    @pytest.mark.asyncio
    async def test_board_persistence(self, kanban_mod, tmp_path):
        """Test that boards are persisted and loaded correctly."""
        # Create a board
        create_event = Event(
            event_name="kanban.board.create",
            source_id="agent_alice",
            payload={"name": "Persistent Board"},
        )
        create_response = await kanban_mod._handle_board_create(create_event)
        board_id = create_response.data["board_id"]

        # Manually save and reload
        kanban_mod._save_boards()
        kanban_mod.boards.clear()
        kanban_mod._load_data()

        # Verify board was reloaded
        assert board_id in kanban_mod.boards
        assert kanban_mod.boards[board_id].name == "Persistent Board"


class TestKanbanAdapter:
    """Tests for the KanbanAdapter agent-level adapter."""

    def test_get_tools(self, kanban_adapter):
        """Test that adapter provides expected tools."""
        tools = kanban_adapter.get_tools()

        tool_names = [tool.name for tool in tools]
        expected_tools = [
            "kanban_create_board",
            "kanban_get_board",
            "kanban_list_boards",
            "kanban_create_card",
            "kanban_update_card",
            "kanban_move_card",
            "kanban_delete_card",
            "kanban_list_cards",
            "kanban_add_column",
        ]

        for expected in expected_tools:
            assert expected in tool_names, f"Missing tool: {expected}"

    def test_tool_schemas(self, kanban_adapter):
        """Test that tool schemas are correctly defined."""
        tools = kanban_adapter.get_tools()

        # Check create_board tool
        create_board_tool = next(t for t in tools if t.name == "kanban_create_board")
        assert "name" in create_board_tool.input_schema["properties"]
        assert "name" in create_board_tool.input_schema["required"]

        # Check create_card tool
        create_card_tool = next(t for t in tools if t.name == "kanban_create_card")
        assert "board_id" in create_card_tool.input_schema["properties"]
        assert "title" in create_card_tool.input_schema["properties"]
        assert "board_id" in create_card_tool.input_schema["required"]
        assert "title" in create_card_tool.input_schema["required"]

        # Check move_card tool
        move_card_tool = next(t for t in tools if t.name == "kanban_move_card")
        assert "card_id" in move_card_tool.input_schema["properties"]
        assert "column_id" in move_card_tool.input_schema["properties"]


class TestKanbanDataClasses:
    """Tests for Kanban data classes."""

    def test_kanban_card_creation(self):
        """Test creating a KanbanCard instance."""
        card = KanbanCard(
            card_id="card-123",
            board_id="board-456",
            column_id="todo",
            title="Test Card",
            description="Description",
            assignee_id="agent_bob",
            labels=["test", "urgent"],
            priority=PRIORITY_HIGH,
            position=0,
            created_by="agent_alice",
            created_at=time.time(),
            updated_at=time.time(),
        )

        assert card.card_id == "card-123"
        assert card.title == "Test Card"
        assert card.priority == PRIORITY_HIGH
        assert "urgent" in card.labels

    def test_kanban_card_to_dict(self):
        """Test KanbanCard to_dict method."""
        current_time = time.time()
        card = KanbanCard(
            card_id="card-123",
            board_id="board-456",
            column_id="todo",
            title="Test Card",
            description="Description",
            assignee_id="agent_bob",
            labels=["test"],
            priority=PRIORITY_MEDIUM,
            position=0,
            created_by="agent_alice",
            created_at=current_time,
            updated_at=current_time,
        )

        card_dict = card.to_dict()

        assert card_dict["card_id"] == "card-123"
        assert card_dict["title"] == "Test Card"
        assert card_dict["assignee_id"] == "agent_bob"

    def test_kanban_card_from_dict(self):
        """Test KanbanCard from_dict class method."""
        card_data = {
            "card_id": "card-789",
            "board_id": "board-456",
            "column_id": "done",
            "title": "Completed Card",
            "description": "All done",
            "assignee_id": None,
            "labels": ["completed"],
            "priority": PRIORITY_LOW,
            "position": 2,
            "created_by": "agent_charlie",
            "created_at": 1234567890.0,
            "updated_at": 1234567990.0,
            "metadata": {"key": "value"},
        }

        card = KanbanCard.from_dict(card_data)

        assert card.card_id == "card-789"
        assert card.column_id == "done"
        assert card.metadata["key"] == "value"

    def test_kanban_column_creation(self):
        """Test creating a KanbanColumn instance."""
        column = KanbanColumn(
            column_id="in_progress",
            name="In Progress",
            position=1,
            wip_limit=5,
        )

        assert column.column_id == "in_progress"
        assert column.name == "In Progress"
        assert column.wip_limit == 5

    def test_kanban_board_creation(self):
        """Test creating a KanbanBoard instance."""
        columns = [
            KanbanColumn(column_id="todo", name="To Do", position=0),
            KanbanColumn(column_id="done", name="Done", position=1),
        ]

        board = KanbanBoard(
            board_id="board-123",
            name="Test Board",
            description="A test board",
            columns=columns,
            owner_id="agent_alice",
            allowed_agent_groups=["researchers"],
            created_at=time.time(),
            updated_at=time.time(),
        )

        assert board.board_id == "board-123"
        assert board.name == "Test Board"
        assert len(board.columns) == 2
        assert "researchers" in board.allowed_agent_groups


if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
