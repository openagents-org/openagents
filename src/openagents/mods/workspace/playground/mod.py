"""
Network-level Interactive Playground mod for OpenAgents.

This mod provides a unified workspace that combines:
- Real-time chat (channel-based messaging)
- Kanban board for task tracking
- Shared artifacts for collaborative outputs

The playground is designed for research sessions, collaborative work,
and interactive demos where humans and agents work together.
"""

import json
import logging
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional
from enum import Enum

from openagents.core.base_mod import BaseMod, mod_event_handler
from openagents.models.event import Event
from openagents.models.event_response import EventResponse

logger = logging.getLogger(__name__)


class PlaygroundStatus(str, Enum):
    """Status of a playground session."""
    CREATED = "created"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    ARCHIVED = "archived"


@dataclass
class PlaygroundSession:
    """Represents an interactive playground session."""

    session_id: str
    name: str
    description: str
    owner_id: str
    status: str

    # Component IDs
    channel_id: str  # Chat channel
    board_id: Optional[str]  # Kanban board (created on demand)

    # Configuration
    allowed_agent_groups: List[str]
    participants: List[str]  # Agent IDs

    # Artifacts
    artifacts: Dict[str, Any]

    # Timestamps
    created_at: float
    updated_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None

    # Research session specific
    goal: Optional[str] = None
    context: Optional[str] = None
    summary: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PlaygroundSession":
        return cls(**data)


class PlaygroundMod(BaseMod):
    """
    Network-level mod for Interactive Playground functionality.

    This mod manages playground sessions that combine:
    - Chat channel for real-time discussion
    - Kanban board for task organization
    - Shared artifacts for outputs

    Events:
    - playground.create: Create a new playground session
    - playground.get: Get session details
    - playground.list: List accessible sessions
    - playground.join: Join a session
    - playground.leave: Leave a session
    - playground.complete: Complete a session
    - playground.artifact.set/get/list/delete: Manage artifacts
    - playground.task.create: Create a task (card) from chat
    """

    def __init__(self, mod_name: str = "openagents.mods.workspace.playground"):
        """Initialize the Playground mod."""
        super().__init__(mod_name)
        self.sessions: Dict[str, PlaygroundSession] = {}
        self.storage_path: Optional[Path] = None
        logger.info("Initializing Interactive Playground mod")

    def bind_network(self, network) -> bool:
        """Bind the mod to a network and load persisted data."""
        result = super().bind_network(network)
        self._setup_storage()
        self._load_sessions()
        return result

    def _setup_storage(self):
        """Set up storage path."""
        storage_path = self.get_storage_path()
        self.storage_path = storage_path / "playground"
        self.storage_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Playground storage path: {self.storage_path}")

    def _load_sessions(self):
        """Load sessions from persistent storage."""
        try:
            sessions_file = self.storage_path / "sessions.json"
            if sessions_file.exists():
                with open(sessions_file, "r") as f:
                    data = json.load(f)
                    for session_id, session_dict in data.items():
                        self.sessions[session_id] = PlaygroundSession.from_dict(session_dict)
                logger.info(f"Loaded {len(self.sessions)} playground sessions")
        except Exception as e:
            logger.error(f"Failed to load playground sessions: {e}")

    def _save_sessions(self):
        """Save sessions to persistent storage."""
        try:
            sessions_file = self.storage_path / "sessions.json"
            data = {sid: s.to_dict() for sid, s in self.sessions.items()}
            with open(sessions_file, "w") as f:
                json.dump(data, f, indent=2)
            logger.debug(f"Saved {len(self.sessions)} sessions")
        except Exception as e:
            logger.error(f"Failed to save sessions: {e}")

    def _check_access(self, agent_id: str, session: PlaygroundSession) -> bool:
        """Check if agent has access to session."""
        if agent_id == session.owner_id:
            return True
        if agent_id in session.participants:
            return True
        if not session.allowed_agent_groups:
            return True
        if hasattr(self, 'network') and self.network:
            agent_group = self.network.topology.agent_group_membership.get(agent_id)
            if agent_group in session.allowed_agent_groups:
                return True
        return False

    def _create_response(
        self, success: bool, message: str, data: Optional[Dict[str, Any]] = None
    ) -> EventResponse:
        return EventResponse(success=success, message=message, data=data or {})

    async def _send_notification(
        self, event_name: str, session: PlaygroundSession,
        payload: Dict[str, Any], exclude_agent: Optional[str] = None
    ):
        """Send notification to session participants."""
        if not hasattr(self, 'network') or not self.network:
            return

        notify_agents = set(session.participants)
        notify_agents.add(session.owner_id)

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
            except Exception as e:
                logger.error(f"Failed to send notification to {agent_id}: {e}")

    async def _create_kanban_board(self, session: PlaygroundSession, source_id: str) -> Optional[str]:
        """Create a Kanban board for the session."""
        if not hasattr(self, 'network') or not self.network:
            return None

        # Create board via kanban mod
        board_event = Event(
            event_name="kanban.board.create",
            source_id=source_id,
            payload={
                "name": f"{session.name} - Tasks",
                "description": f"Task board for playground: {session.description}",
                "project_id": session.session_id,
                "allowed_agent_groups": session.allowed_agent_groups,
            },
            relevant_mod="openagents.mods.coordination.kanban",
        )

        try:
            response = await self.network.process_event(board_event)
            if response and response.success:
                return response.data.get("board_id")
        except Exception as e:
            logger.error(f"Failed to create Kanban board: {e}")

        return None

    # ============ Session Management ============

    @mod_event_handler("playground.create")
    async def _handle_create(self, event: Event) -> Optional[EventResponse]:
        """Create a new playground session."""
        payload = event.payload or {}
        name = payload.get("name")

        if not name:
            return self._create_response(False, "Session name is required")

        session_id = str(uuid.uuid4())
        channel_id = f"playground-{session_id[:8]}"
        current_time = time.time()

        session = PlaygroundSession(
            session_id=session_id,
            name=name,
            description=payload.get("description", ""),
            owner_id=event.source_id,
            status=PlaygroundStatus.CREATED.value,
            channel_id=channel_id,
            board_id=None,  # Created on demand
            allowed_agent_groups=payload.get("allowed_agent_groups", []),
            participants=[event.source_id],
            artifacts={},
            created_at=current_time,
            updated_at=current_time,
            goal=payload.get("goal"),
            context=payload.get("context"),
        )

        # Create Kanban board if requested
        if payload.get("create_board", True):
            board_id = await self._create_kanban_board(session, event.source_id)
            session.board_id = board_id

        self.sessions[session_id] = session
        self._save_sessions()

        logger.info(f"Created playground session {session_id}: {name}")

        return self._create_response(
            True,
            "Playground session created",
            {
                "session_id": session_id,
                "session": session.to_dict(),
            },
        )

    @mod_event_handler("playground.start")
    async def _handle_start(self, event: Event) -> Optional[EventResponse]:
        """Start a playground session."""
        payload = event.payload or {}
        session_id = payload.get("session_id")

        if not session_id:
            return self._create_response(False, "session_id is required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if not self._check_access(event.source_id, session):
            return self._create_response(False, "Access denied")

        session.status = PlaygroundStatus.ACTIVE.value
        session.started_at = time.time()
        session.updated_at = time.time()
        self._save_sessions()

        # Send notification
        await self._send_notification(
            "playground.notification.started",
            session,
            {"session_id": session_id, "started_by": event.source_id},
            exclude_agent=event.source_id,
        )

        return self._create_response(
            True,
            "Playground session started",
            {"session": session.to_dict()},
        )

    @mod_event_handler("playground.get")
    async def _handle_get(self, event: Event) -> Optional[EventResponse]:
        """Get playground session details."""
        payload = event.payload or {}
        session_id = payload.get("session_id")

        if not session_id:
            return self._create_response(False, "session_id is required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if not self._check_access(event.source_id, session):
            return self._create_response(False, "Access denied")

        return self._create_response(
            True,
            "Session retrieved",
            {"session": session.to_dict()},
        )

    @mod_event_handler("playground.list")
    async def _handle_list(self, event: Event) -> Optional[EventResponse]:
        """List accessible playground sessions."""
        payload = event.payload or {}
        status_filter = payload.get("status")

        accessible = []
        for session in self.sessions.values():
            if self._check_access(event.source_id, session):
                if status_filter and session.status != status_filter:
                    continue
                accessible.append(session.to_dict())

        # Sort by updated_at descending
        accessible.sort(key=lambda s: s["updated_at"], reverse=True)

        return self._create_response(
            True,
            f"Found {len(accessible)} sessions",
            {"sessions": accessible},
        )

    @mod_event_handler("playground.join")
    async def _handle_join(self, event: Event) -> Optional[EventResponse]:
        """Join a playground session."""
        payload = event.payload or {}
        session_id = payload.get("session_id")

        if not session_id:
            return self._create_response(False, "session_id is required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if not self._check_access(event.source_id, session):
            return self._create_response(False, "Access denied")

        if event.source_id not in session.participants:
            session.participants.append(event.source_id)
            session.updated_at = time.time()
            self._save_sessions()

            # Notify others
            await self._send_notification(
                "playground.notification.joined",
                session,
                {"session_id": session_id, "agent_id": event.source_id},
                exclude_agent=event.source_id,
            )

        return self._create_response(
            True,
            "Joined session",
            {"session": session.to_dict()},
        )

    @mod_event_handler("playground.leave")
    async def _handle_leave(self, event: Event) -> Optional[EventResponse]:
        """Leave a playground session."""
        payload = event.payload or {}
        session_id = payload.get("session_id")

        if not session_id:
            return self._create_response(False, "session_id is required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if event.source_id in session.participants:
            session.participants.remove(event.source_id)
            session.updated_at = time.time()
            self._save_sessions()

            await self._send_notification(
                "playground.notification.left",
                session,
                {"session_id": session_id, "agent_id": event.source_id},
            )

        return self._create_response(True, "Left session", {"session_id": session_id})

    @mod_event_handler("playground.complete")
    async def _handle_complete(self, event: Event) -> Optional[EventResponse]:
        """Complete a playground session."""
        payload = event.payload or {}
        session_id = payload.get("session_id")

        if not session_id:
            return self._create_response(False, "session_id is required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        # Only owner can complete
        if event.source_id != session.owner_id:
            return self._create_response(False, "Only session owner can complete")

        session.status = PlaygroundStatus.COMPLETED.value
        session.completed_at = time.time()
        session.updated_at = time.time()
        session.summary = payload.get("summary")
        self._save_sessions()

        await self._send_notification(
            "playground.notification.completed",
            session,
            {
                "session_id": session_id,
                "completed_by": event.source_id,
                "summary": session.summary,
            },
            exclude_agent=event.source_id,
        )

        return self._create_response(
            True,
            "Session completed",
            {"session": session.to_dict()},
        )

    # ============ Artifact Management ============

    @mod_event_handler("playground.artifact.set")
    async def _handle_artifact_set(self, event: Event) -> Optional[EventResponse]:
        """Set an artifact in the session."""
        payload = event.payload or {}
        session_id = payload.get("session_id")
        key = payload.get("key")
        value = payload.get("value")

        if not session_id or not key:
            return self._create_response(False, "session_id and key are required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if not self._check_access(event.source_id, session):
            return self._create_response(False, "Access denied")

        previous = session.artifacts.get(key)
        session.artifacts[key] = value
        session.updated_at = time.time()
        self._save_sessions()

        # Notify participants
        await self._send_notification(
            "playground.notification.artifact_updated",
            session,
            {
                "session_id": session_id,
                "key": key,
                "updated_by": event.source_id,
                "action": "update" if previous else "create",
            },
            exclude_agent=event.source_id,
        )

        return self._create_response(
            True,
            "Artifact set",
            {"key": key, "previous": previous},
        )

    @mod_event_handler("playground.artifact.get")
    async def _handle_artifact_get(self, event: Event) -> Optional[EventResponse]:
        """Get an artifact from the session."""
        payload = event.payload or {}
        session_id = payload.get("session_id")
        key = payload.get("key")

        if not session_id or not key:
            return self._create_response(False, "session_id and key are required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if not self._check_access(event.source_id, session):
            return self._create_response(False, "Access denied")

        value = session.artifacts.get(key)

        return self._create_response(
            True,
            "Artifact retrieved" if value else "Artifact not found",
            {"key": key, "value": value},
        )

    @mod_event_handler("playground.artifact.list")
    async def _handle_artifact_list(self, event: Event) -> Optional[EventResponse]:
        """List all artifacts in the session."""
        payload = event.payload or {}
        session_id = payload.get("session_id")

        if not session_id:
            return self._create_response(False, "session_id is required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if not self._check_access(event.source_id, session):
            return self._create_response(False, "Access denied")

        return self._create_response(
            True,
            f"Found {len(session.artifacts)} artifacts",
            {"artifacts": list(session.artifacts.keys())},
        )

    @mod_event_handler("playground.artifact.delete")
    async def _handle_artifact_delete(self, event: Event) -> Optional[EventResponse]:
        """Delete an artifact from the session."""
        payload = event.payload or {}
        session_id = payload.get("session_id")
        key = payload.get("key")

        if not session_id or not key:
            return self._create_response(False, "session_id and key are required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if not self._check_access(event.source_id, session):
            return self._create_response(False, "Access denied")

        deleted = session.artifacts.pop(key, None)
        if deleted:
            session.updated_at = time.time()
            self._save_sessions()

            await self._send_notification(
                "playground.notification.artifact_updated",
                session,
                {
                    "session_id": session_id,
                    "key": key,
                    "updated_by": event.source_id,
                    "action": "delete",
                },
                exclude_agent=event.source_id,
            )

        return self._create_response(
            True,
            "Artifact deleted" if deleted else "Artifact not found",
            {"key": key, "deleted": deleted is not None},
        )

    # ============ Task Integration ============

    @mod_event_handler("playground.task.create")
    async def _handle_task_create(self, event: Event) -> Optional[EventResponse]:
        """Create a task (Kanban card) from the playground."""
        payload = event.payload or {}
        session_id = payload.get("session_id")
        title = payload.get("title")

        if not session_id or not title:
            return self._create_response(False, "session_id and title are required")

        session = self.sessions.get(session_id)
        if not session:
            return self._create_response(False, f"Session {session_id} not found")

        if not self._check_access(event.source_id, session):
            return self._create_response(False, "Access denied")

        # Create board if it doesn't exist
        if not session.board_id:
            board_id = await self._create_kanban_board(session, event.source_id)
            if board_id:
                session.board_id = board_id
                self._save_sessions()
            else:
                return self._create_response(False, "Failed to create Kanban board")

        # Create card via kanban mod
        card_event = Event(
            event_name="kanban.card.create",
            source_id=event.source_id,
            payload={
                "board_id": session.board_id,
                "title": title,
                "description": payload.get("description", ""),
                "assignee_id": payload.get("assignee_id"),
                "labels": payload.get("labels", []),
                "priority": payload.get("priority", "medium"),
            },
            relevant_mod="openagents.mods.coordination.kanban",
        )

        if hasattr(self, 'network') and self.network:
            try:
                response = await self.network.process_event(card_event)
                if response and response.success:
                    return self._create_response(
                        True,
                        "Task created",
                        {
                            "card_id": response.data.get("card_id"),
                            "board_id": session.board_id,
                        },
                    )
            except Exception as e:
                logger.error(f"Failed to create task: {e}")

        return self._create_response(False, "Failed to create task")

    # ============ State ============

    def get_state(self) -> Dict[str, Any]:
        """Get the current state of the Playground mod."""
        active = sum(1 for s in self.sessions.values() if s.status == PlaygroundStatus.ACTIVE.value)
        completed = sum(1 for s in self.sessions.values() if s.status == PlaygroundStatus.COMPLETED.value)

        return {
            "total_sessions": len(self.sessions),
            "active_sessions": active,
            "completed_sessions": completed,
            "storage_path": str(self.storage_path) if self.storage_path else None,
        }

    def shutdown(self) -> bool:
        """Shutdown the mod gracefully."""
        logger.info("Shutting down Interactive Playground mod")
        self._save_sessions()
        self.sessions.clear()
        return super().shutdown()
