"""
Network-level Kanban board mod for OpenAgents.

This mod provides a visual task board with:
- Customizable columns/stages (TODO, IN_PROGRESS, REVIEW, DONE, etc.)
- Cards with title, description, assignee, labels, priority
- Card movement between columns with event notifications
- Board-level access control via agent groups
- Persistence to workspace storage
"""

import json
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)

# Default columns for new boards
DEFAULT_COLUMNS = [
    {"column_id": "todo", "name": "To Do", "position": 0},
    {"column_id": "in_progress", "name": "In Progress", "position": 1},
    {"column_id": "review", "name": "Review", "position": 2},
    {"column_id": "done", "name": "Done", "position": 3},
]

# Card priority levels
PRIORITY_LOW = "low"
PRIORITY_MEDIUM = "medium"
PRIORITY_HIGH = "high"
PRIORITY_URGENT = "urgent"


@dataclass
class KanbanCard:
    """Represents a card on the Kanban board."""

    card_id: str
    board_id: str
    column_id: str
    title: str
    description: str
    assignee_id: Optional[str]
    labels: List[str]
    priority: str
    position: int
    created_by: str
    created_at: float
    updated_at: float
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Convert card to dictionary for JSON serialization."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KanbanCard":
        """Create a Card from a dictionary."""
        return cls(
            card_id=data["card_id"],
            board_id=data["board_id"],
            column_id=data["column_id"],
            title=data["title"],
            description=data.get("description", ""),
            assignee_id=data.get("assignee_id"),
            labels=data.get("labels", []),
            priority=data.get("priority", PRIORITY_MEDIUM),
            position=data.get("position", 0),
            created_by=data["created_by"],
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            metadata=data.get("metadata", {}),
        )


@dataclass
class KanbanColumn:
    """Represents a column on the Kanban board."""

    column_id: str
    name: str
    position: int
    wip_limit: Optional[int] = None  # Work-in-progress limit

    def to_dict(self) -> Dict[str, Any]:
        """Convert column to dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KanbanColumn":
        """Create a Column from a dictionary."""
        return cls(
            column_id=data["column_id"],
            name=data["name"],
            position=data.get("position", 0),
            wip_limit=data.get("wip_limit"),
        )


@dataclass
class KanbanBoard:
    """Represents a Kanban board."""

    board_id: str
    name: str
    description: str
    columns: List[KanbanColumn]
    owner_id: str
    allowed_agent_groups: List[str]
    created_at: float
    updated_at: float
    project_id: Optional[str] = None  # Link to project for playground integration

    def to_dict(self) -> Dict[str, Any]:
        """Convert board to dictionary."""
        return {
            "board_id": self.board_id,
            "name": self.name,
            "description": self.description,
            "columns": [col.to_dict() for col in self.columns],
            "owner_id": self.owner_id,
            "allowed_agent_groups": self.allowed_agent_groups,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "project_id": self.project_id,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "KanbanBoard":
        """Create a Board from a dictionary."""
        columns = [KanbanColumn.from_dict(col) for col in data.get("columns", [])]
        return cls(
            board_id=data["board_id"],
            name=data["name"],
            description=data.get("description", ""),
            columns=columns,
            owner_id=data["owner_id"],
            allowed_agent_groups=data.get("allowed_agent_groups", []),
            created_at=data["created_at"],
            updated_at=data["updated_at"],
            project_id=data.get("project_id"),
        )


class KanbanMod(BaseMod):
    """
    Network-level mod for Kanban board functionality.

    This mod manages Kanban boards at the network level, including:
    - Board creation and configuration
    - Column management
    - Card CRUD operations
    - Card movement between columns
    - Event notifications for real-time updates
    """

    def __init__(self, mod_name: str = "openagents.mods.coordination.kanban"):
        """Initialize the Kanban mod."""
        super().__init__(mod_name)
        self.boards: Dict[str, KanbanBoard] = {}
        self.cards: Dict[str, KanbanCard] = {}  # card_id -> card
        self.board_cards: Dict[str, List[str]] = {}  # board_id -> [card_ids]
        self.storage_path: Optional[Path] = None
        logger.info("Initializing Kanban network mod")

    def bind_network(self, network) -> bool:
        """Bind the mod to a network and load persisted data."""
        result = super().bind_network(network)
        self._setup_storage()
        self._load_data()
        return result

    def _setup_storage(self):
        """Set up storage path."""
        storage_path = self.get_storage_path()
        self.storage_path = storage_path / "kanban"
        self.storage_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Kanban storage path: {self.storage_path}")

    def _load_data(self):
        """Load boards and cards from persistent storage."""
        try:
            # Load boards
            boards_file = self.storage_path / "boards.json"
            if boards_file.exists():
                with open(boards_file, "r") as f:
                    boards_data = json.load(f)
                    for board_id, board_dict in boards_data.items():
                        self.boards[board_id] = KanbanBoard.from_dict(board_dict)
                logger.info(f"Loaded {len(self.boards)} boards from storage")

            # Load cards
            cards_file = self.storage_path / "cards.json"
            if cards_file.exists():
                with open(cards_file, "r") as f:
                    cards_data = json.load(f)
                    for card_id, card_dict in cards_data.items():
                        card = KanbanCard.from_dict(card_dict)
                        self.cards[card_id] = card
                        # Build board_cards index
                        if card.board_id not in self.board_cards:
                            self.board_cards[card.board_id] = []
                        self.board_cards[card.board_id].append(card_id)
                logger.info(f"Loaded {len(self.cards)} cards from storage")

        except Exception as e:
            logger.error(f"Failed to load Kanban data: {e}")

    def _save_boards(self):
        """Save boards to persistent storage."""
        try:
            boards_file = self.storage_path / "boards.json"
            data = {board_id: board.to_dict() for board_id, board in self.boards.items()}
            with open(boards_file, "w") as f:
                json.dump(data, f, indent=2)
            logger.debug(f"Saved {len(self.boards)} boards to storage")
        except Exception as e:
            logger.error(f"Failed to save boards: {e}")

    def _save_cards(self):
        """Save cards to persistent storage."""
        try:
            cards_file = self.storage_path / "cards.json"
            data = {card_id: card.to_dict() for card_id, card in self.cards.items()}
            with open(cards_file, "w") as f:
                json.dump(data, f, indent=2)
            logger.debug(f"Saved {len(self.cards)} cards to storage")
        except Exception as e:
            logger.error(f"Failed to save cards: {e}")

    def _check_board_access(self, agent_id: str, board: KanbanBoard) -> bool:
        """Check if an agent has access to a board."""
        # Owner always has access
        if agent_id == board.owner_id:
            return True

        # Empty allowed_groups means everyone has access
        if not board.allowed_agent_groups:
            return True

        # Check agent group membership
        if hasattr(self, 'network') and self.network:
            agent_group = self.network.topology.agent_group_membership.get(agent_id)
            if agent_group in board.allowed_agent_groups:
                return True

        return False

    def _create_response(
        self, success: bool, message: str, data: Optional[Dict[str, Any]] = None
    ) -> EventResponse:
        """Create a standardized event response."""
        return EventResponse(success=success, message=message, data=data or {})

    async def _send_notification(
        self, event_name: str, board: KanbanBoard, payload: Dict[str, Any], exclude_agent: Optional[str] = None
    ):
        """Send notification to agents with access to the board."""
        if not hasattr(self, 'network') or not self.network:
            return

        notify_agents = set()

        if board.allowed_agent_groups:
            for agent_id, group in self.network.topology.agent_group_membership.items():
                if group in board.allowed_agent_groups:
                    notify_agents.add(agent_id)
        else:
            notify_agents = set(self.network.topology.agent_registry.keys())

        # Always include board owner
        notify_agents.add(board.owner_id)

        if exclude_agent:
            notify_agents.discard(exclude_agent)

        for agent_id in notify_agents:
            notification = Event(
                event_name=event_name,
                source_id=self.network.network_id,
                destination_id=agent_id,
                payload=payload,
            )
            try:
                await self.network.process_event(notification)
                logger.debug(f"Sent {event_name} notification to {agent_id}")
            except Exception as e:
                logger.error(f"Failed to send notification to {agent_id}: {e}")

    # ============ Board Operations ============

    @mod_event_handler("kanban.board.create")
    async def _handle_board_create(self, event: Event) -> Optional[EventResponse]:
        """Handle board creation request."""
        payload = event.payload or {}
        name = payload.get("name")

        if not name:
            return self._create_response(False, "Board name is required")

        board_id = str(uuid.uuid4())
        current_time = time.time()

        # Create default columns or use provided ones
        columns_data = payload.get("columns", DEFAULT_COLUMNS)
        columns = [KanbanColumn.from_dict(col) for col in columns_data]

        board = KanbanBoard(
            board_id=board_id,
            name=name,
            description=payload.get("description", ""),
            columns=columns,
            owner_id=event.source_id,
            allowed_agent_groups=payload.get("allowed_agent_groups", []),
            created_at=current_time,
            updated_at=current_time,
            project_id=payload.get("project_id"),
        )

        self.boards[board_id] = board
        self.board_cards[board_id] = []
        self._save_boards()

        logger.info(f"Created board {board_id}: {name} by {event.source_id}")

        # Send notification
        await self._send_notification(
            "kanban.notification.board_created",
            board,
            {"board_id": board_id, "name": name, "created_by": event.source_id},
            exclude_agent=event.source_id,
        )

        return self._create_response(
            True,
            "Board created successfully",
            {"board_id": board_id, "board": board.to_dict()},
        )

    @mod_event_handler("kanban.board.get")
    async def _handle_board_get(self, event: Event) -> Optional[EventResponse]:
        """Handle board retrieval request."""
        payload = event.payload or {}
        board_id = payload.get("board_id")

        if not board_id:
            return self._create_response(False, "board_id is required")

        board = self.boards.get(board_id)
        if not board:
            return self._create_response(False, f"Board {board_id} not found")

        if not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to board")

        # Get cards for this board
        card_ids = self.board_cards.get(board_id, [])
        cards = [self.cards[cid].to_dict() for cid in card_ids if cid in self.cards]

        return self._create_response(
            True,
            "Board retrieved",
            {"board": board.to_dict(), "cards": cards},
        )

    @mod_event_handler("kanban.board.list")
    async def _handle_board_list(self, event: Event) -> Optional[EventResponse]:
        """Handle board listing request."""
        payload = event.payload or {}
        project_id = payload.get("project_id")  # Optional filter

        accessible_boards = []
        for board in self.boards.values():
            if self._check_board_access(event.source_id, board):
                if project_id is None or board.project_id == project_id:
                    accessible_boards.append(board.to_dict())

        return self._create_response(
            True,
            f"Found {len(accessible_boards)} boards",
            {"boards": accessible_boards},
        )

    @mod_event_handler("kanban.board.update")
    async def _handle_board_update(self, event: Event) -> Optional[EventResponse]:
        """Handle board update request."""
        payload = event.payload or {}
        board_id = payload.get("board_id")

        if not board_id:
            return self._create_response(False, "board_id is required")

        board = self.boards.get(board_id)
        if not board:
            return self._create_response(False, f"Board {board_id} not found")

        if not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to board")

        # Update allowed fields
        if "name" in payload:
            board.name = payload["name"]
        if "description" in payload:
            board.description = payload["description"]
        if "allowed_agent_groups" in payload:
            board.allowed_agent_groups = payload["allowed_agent_groups"]

        board.updated_at = time.time()
        self._save_boards()

        logger.info(f"Updated board {board_id} by {event.source_id}")

        await self._send_notification(
            "kanban.notification.board_updated",
            board,
            {"board_id": board_id, "updated_by": event.source_id},
            exclude_agent=event.source_id,
        )

        return self._create_response(True, "Board updated", {"board": board.to_dict()})

    @mod_event_handler("kanban.board.delete")
    async def _handle_board_delete(self, event: Event) -> Optional[EventResponse]:
        """Handle board deletion request."""
        payload = event.payload or {}
        board_id = payload.get("board_id")

        if not board_id:
            return self._create_response(False, "board_id is required")

        board = self.boards.get(board_id)
        if not board:
            return self._create_response(False, f"Board {board_id} not found")

        # Only owner can delete
        if event.source_id != board.owner_id:
            return self._create_response(False, "Only board owner can delete the board")

        # Delete all cards on this board
        card_ids = self.board_cards.get(board_id, [])
        for card_id in card_ids:
            if card_id in self.cards:
                del self.cards[card_id]

        del self.boards[board_id]
        if board_id in self.board_cards:
            del self.board_cards[board_id]

        self._save_boards()
        self._save_cards()

        logger.info(f"Deleted board {board_id} by {event.source_id}")

        await self._send_notification(
            "kanban.notification.board_deleted",
            board,
            {"board_id": board_id, "deleted_by": event.source_id},
            exclude_agent=event.source_id,
        )

        return self._create_response(True, "Board deleted", {"board_id": board_id})

    # ============ Column Operations ============

    @mod_event_handler("kanban.column.add")
    async def _handle_column_add(self, event: Event) -> Optional[EventResponse]:
        """Handle adding a column to a board."""
        payload = event.payload or {}
        board_id = payload.get("board_id")
        name = payload.get("name")

        if not board_id or not name:
            return self._create_response(False, "board_id and name are required")

        board = self.boards.get(board_id)
        if not board:
            return self._create_response(False, f"Board {board_id} not found")

        if not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to board")

        column_id = payload.get("column_id", str(uuid.uuid4()))
        position = payload.get("position", len(board.columns))
        wip_limit = payload.get("wip_limit")

        column = KanbanColumn(
            column_id=column_id,
            name=name,
            position=position,
            wip_limit=wip_limit,
        )

        board.columns.append(column)
        board.columns.sort(key=lambda c: c.position)
        board.updated_at = time.time()
        self._save_boards()

        logger.info(f"Added column {column_id} to board {board_id}")

        await self._send_notification(
            "kanban.notification.column_added",
            board,
            {"board_id": board_id, "column": column.to_dict(), "added_by": event.source_id},
            exclude_agent=event.source_id,
        )

        return self._create_response(True, "Column added", {"column": column.to_dict()})

    @mod_event_handler("kanban.column.update")
    async def _handle_column_update(self, event: Event) -> Optional[EventResponse]:
        """Handle updating a column."""
        payload = event.payload or {}
        board_id = payload.get("board_id")
        column_id = payload.get("column_id")

        if not board_id or not column_id:
            return self._create_response(False, "board_id and column_id are required")

        board = self.boards.get(board_id)
        if not board:
            return self._create_response(False, f"Board {board_id} not found")

        if not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to board")

        column = next((c for c in board.columns if c.column_id == column_id), None)
        if not column:
            return self._create_response(False, f"Column {column_id} not found")

        if "name" in payload:
            column.name = payload["name"]
        if "position" in payload:
            column.position = payload["position"]
        if "wip_limit" in payload:
            column.wip_limit = payload["wip_limit"]

        board.columns.sort(key=lambda c: c.position)
        board.updated_at = time.time()
        self._save_boards()

        return self._create_response(True, "Column updated", {"column": column.to_dict()})

    @mod_event_handler("kanban.column.delete")
    async def _handle_column_delete(self, event: Event) -> Optional[EventResponse]:
        """Handle deleting a column."""
        payload = event.payload or {}
        board_id = payload.get("board_id")
        column_id = payload.get("column_id")
        move_cards_to = payload.get("move_cards_to")  # Column to move cards to

        if not board_id or not column_id:
            return self._create_response(False, "board_id and column_id are required")

        board = self.boards.get(board_id)
        if not board:
            return self._create_response(False, f"Board {board_id} not found")

        if not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to board")

        column = next((c for c in board.columns if c.column_id == column_id), None)
        if not column:
            return self._create_response(False, f"Column {column_id} not found")

        # Move or delete cards in this column
        card_ids = self.board_cards.get(board_id, [])
        for card_id in card_ids:
            card = self.cards.get(card_id)
            if card and card.column_id == column_id:
                if move_cards_to:
                    card.column_id = move_cards_to
                    card.updated_at = time.time()
                else:
                    del self.cards[card_id]
                    self.board_cards[board_id].remove(card_id)

        board.columns = [c for c in board.columns if c.column_id != column_id]
        board.updated_at = time.time()
        self._save_boards()
        self._save_cards()

        return self._create_response(True, "Column deleted", {"column_id": column_id})

    # ============ Card Operations ============

    @mod_event_handler("kanban.card.create")
    async def _handle_card_create(self, event: Event) -> Optional[EventResponse]:
        """Handle card creation request."""
        payload = event.payload or {}
        board_id = payload.get("board_id")
        title = payload.get("title")

        if not board_id or not title:
            return self._create_response(False, "board_id and title are required")

        board = self.boards.get(board_id)
        if not board:
            return self._create_response(False, f"Board {board_id} not found")

        if not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to board")

        # Default to first column if not specified
        column_id = payload.get("column_id")
        if not column_id and board.columns:
            column_id = board.columns[0].column_id

        if not column_id:
            return self._create_response(False, "No column specified and board has no columns")

        # Validate column exists
        if not any(c.column_id == column_id for c in board.columns):
            return self._create_response(False, f"Column {column_id} not found on board")

        card_id = str(uuid.uuid4())
        current_time = time.time()

        # Calculate position (add to end of column)
        cards_in_column = [
            c for c in self.cards.values()
            if c.board_id == board_id and c.column_id == column_id
        ]
        position = max([c.position for c in cards_in_column], default=-1) + 1

        card = KanbanCard(
            card_id=card_id,
            board_id=board_id,
            column_id=column_id,
            title=title,
            description=payload.get("description", ""),
            assignee_id=payload.get("assignee_id"),
            labels=payload.get("labels", []),
            priority=payload.get("priority", PRIORITY_MEDIUM),
            position=position,
            created_by=event.source_id,
            created_at=current_time,
            updated_at=current_time,
            metadata=payload.get("metadata", {}),
        )

        self.cards[card_id] = card
        if board_id not in self.board_cards:
            self.board_cards[board_id] = []
        self.board_cards[board_id].append(card_id)
        self._save_cards()

        logger.info(f"Created card {card_id}: {title} on board {board_id}")

        await self._send_notification(
            "kanban.notification.card_created",
            board,
            {
                "board_id": board_id,
                "card": card.to_dict(),
                "created_by": event.source_id,
            },
            exclude_agent=event.source_id,
        )

        return self._create_response(
            True,
            "Card created",
            {"card_id": card_id, "card": card.to_dict()},
        )

    @mod_event_handler("kanban.card.get")
    async def _handle_card_get(self, event: Event) -> Optional[EventResponse]:
        """Handle card retrieval request."""
        payload = event.payload or {}
        card_id = payload.get("card_id")

        if not card_id:
            return self._create_response(False, "card_id is required")

        card = self.cards.get(card_id)
        if not card:
            return self._create_response(False, f"Card {card_id} not found")

        board = self.boards.get(card.board_id)
        if board and not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to card")

        return self._create_response(True, "Card retrieved", {"card": card.to_dict()})

    @mod_event_handler("kanban.card.update")
    async def _handle_card_update(self, event: Event) -> Optional[EventResponse]:
        """Handle card update request."""
        payload = event.payload or {}
        card_id = payload.get("card_id")

        if not card_id:
            return self._create_response(False, "card_id is required")

        card = self.cards.get(card_id)
        if not card:
            return self._create_response(False, f"Card {card_id} not found")

        board = self.boards.get(card.board_id)
        if board and not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to card")

        # Update allowed fields
        if "title" in payload:
            card.title = payload["title"]
        if "description" in payload:
            card.description = payload["description"]
        if "assignee_id" in payload:
            card.assignee_id = payload["assignee_id"]
        if "labels" in payload:
            card.labels = payload["labels"]
        if "priority" in payload:
            card.priority = payload["priority"]
        if "metadata" in payload:
            card.metadata.update(payload["metadata"])

        card.updated_at = time.time()
        self._save_cards()

        logger.info(f"Updated card {card_id} by {event.source_id}")

        if board:
            await self._send_notification(
                "kanban.notification.card_updated",
                board,
                {"board_id": card.board_id, "card": card.to_dict(), "updated_by": event.source_id},
                exclude_agent=event.source_id,
            )

        return self._create_response(True, "Card updated", {"card": card.to_dict()})

    @mod_event_handler("kanban.card.move")
    async def _handle_card_move(self, event: Event) -> Optional[EventResponse]:
        """Handle card movement between columns."""
        payload = event.payload or {}
        card_id = payload.get("card_id")
        target_column_id = payload.get("column_id")
        target_position = payload.get("position")

        if not card_id or not target_column_id:
            return self._create_response(False, "card_id and column_id are required")

        card = self.cards.get(card_id)
        if not card:
            return self._create_response(False, f"Card {card_id} not found")

        board = self.boards.get(card.board_id)
        if not board:
            return self._create_response(False, "Board not found")

        if not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to card")

        # Validate target column exists
        target_column = next((c for c in board.columns if c.column_id == target_column_id), None)
        if not target_column:
            return self._create_response(False, f"Column {target_column_id} not found")

        # Check WIP limit
        if target_column.wip_limit is not None:
            cards_in_target = sum(
                1 for c in self.cards.values()
                if c.board_id == card.board_id and c.column_id == target_column_id
            )
            if cards_in_target >= target_column.wip_limit and card.column_id != target_column_id:
                return self._create_response(
                    False,
                    f"Column {target_column.name} has reached WIP limit ({target_column.wip_limit})",
                )

        old_column_id = card.column_id
        card.column_id = target_column_id

        if target_position is not None:
            card.position = target_position
        else:
            # Move to end of column
            cards_in_column = [
                c for c in self.cards.values()
                if c.board_id == card.board_id and c.column_id == target_column_id and c.card_id != card_id
            ]
            card.position = max([c.position for c in cards_in_column], default=-1) + 1

        card.updated_at = time.time()
        self._save_cards()

        logger.info(f"Moved card {card_id} from {old_column_id} to {target_column_id}")

        await self._send_notification(
            "kanban.notification.card_moved",
            board,
            {
                "board_id": card.board_id,
                "card_id": card_id,
                "from_column": old_column_id,
                "to_column": target_column_id,
                "position": card.position,
                "moved_by": event.source_id,
            },
            exclude_agent=event.source_id,
        )

        return self._create_response(
            True,
            "Card moved",
            {"card": card.to_dict(), "from_column": old_column_id, "to_column": target_column_id},
        )

    @mod_event_handler("kanban.card.delete")
    async def _handle_card_delete(self, event: Event) -> Optional[EventResponse]:
        """Handle card deletion request."""
        payload = event.payload or {}
        card_id = payload.get("card_id")

        if not card_id:
            return self._create_response(False, "card_id is required")

        card = self.cards.get(card_id)
        if not card:
            return self._create_response(False, f"Card {card_id} not found")

        board = self.boards.get(card.board_id)
        if board and not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to card")

        board_id = card.board_id
        del self.cards[card_id]
        if board_id in self.board_cards and card_id in self.board_cards[board_id]:
            self.board_cards[board_id].remove(card_id)
        self._save_cards()

        logger.info(f"Deleted card {card_id} by {event.source_id}")

        if board:
            await self._send_notification(
                "kanban.notification.card_deleted",
                board,
                {"board_id": board_id, "card_id": card_id, "deleted_by": event.source_id},
                exclude_agent=event.source_id,
            )

        return self._create_response(True, "Card deleted", {"card_id": card_id})

    @mod_event_handler("kanban.card.list")
    async def _handle_card_list(self, event: Event) -> Optional[EventResponse]:
        """Handle card listing for a board."""
        payload = event.payload or {}
        board_id = payload.get("board_id")
        column_id = payload.get("column_id")  # Optional filter
        assignee_id = payload.get("assignee_id")  # Optional filter

        if not board_id:
            return self._create_response(False, "board_id is required")

        board = self.boards.get(board_id)
        if not board:
            return self._create_response(False, f"Board {board_id} not found")

        if not self._check_board_access(event.source_id, board):
            return self._create_response(False, "Access denied to board")

        card_ids = self.board_cards.get(board_id, [])
        cards = []
        for card_id in card_ids:
            card = self.cards.get(card_id)
            if card:
                if column_id and card.column_id != column_id:
                    continue
                if assignee_id and card.assignee_id != assignee_id:
                    continue
                cards.append(card.to_dict())

        # Sort by column position, then card position
        column_order = {c.column_id: c.position for c in board.columns}
        cards.sort(key=lambda c: (column_order.get(c["column_id"], 999), c["position"]))

        return self._create_response(
            True,
            f"Found {len(cards)} cards",
            {"cards": cards},
        )

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the Kanban mod."""
        return {
            "total_boards": len(self.boards),
            "total_cards": len(self.cards),
            "storage_path": str(self.storage_path) if self.storage_path else None,
        }

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully."""
        logger.info("Shutting down Kanban mod")
        self._save_boards()
        self._save_cards()
        self.boards.clear()
        self.cards.clear()
        self.board_cards.clear()
        return super().shutdown()
