"""
Workspace management for OpenAgents networks.

This module provides persistent storage for network data including events,
agent registry, and mod-specific storage using SQLite and structured directories.
"""

import logging
import os
import json
import sqlite3
import tempfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional, Union
from contextlib import contextmanager

from openagents.models.event import Event

logger = logging.getLogger(__name__)


class WorkspaceManager:
    """
    Manages persistent storage for OpenAgents networks using workspace directories.

    Provides SQLite database for events and network state, plus structured
    directory storage for mod-specific data.
    """

    def __init__(self, workspace_path: Union[str, Path]):
        """Initialize workspace manager.

        Args:
            workspace_path: Path to workspace directory
        """
        self.workspace_path = Path(workspace_path)
        self.db_path = self.workspace_path / "network.db"
        self.mods_path = self.workspace_path / "mods"
        self.logs_path = self.workspace_path / "logs"

        # Track initialization state
        self._initialized = False

        logger.info(f"Initializing WorkspaceManager at {self.workspace_path}")

    def initialize_workspace(self) -> bool:
        """Initialize the workspace directory structure and database.

        Returns:
            bool: True if initialization successful, False otherwise
        """
        try:
            # Create directory structure
            self.workspace_path.mkdir(parents=True, exist_ok=True)
            self.mods_path.mkdir(parents=True, exist_ok=True)
            self.logs_path.mkdir(parents=True, exist_ok=True)

            # Initialize SQLite database
            self._initialize_database()

            self._initialized = True
            logger.info(f"Workspace initialized successfully at {self.workspace_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to initialize workspace: {e}")
            return False

    def _initialize_database(self) -> None:
        """Initialize SQLite database with required tables."""
        with self._get_db_connection() as conn:
            cursor = conn.cursor()

            # Events table for persistent event storage
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS events (
                    event_id TEXT PRIMARY KEY,
                    event_name TEXT NOT NULL,
                    source_id TEXT,
                    destination_id TEXT,
                    payload TEXT,
                    timestamp REAL NOT NULL,
                    processed BOOLEAN DEFAULT FALSE,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

            # Agent registry table
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS agents (
                    agent_id TEXT PRIMARY KEY,
                    metadata TEXT,
                    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

            # Network state table for arbitrary key-value storage
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS network_state (
                    key TEXT PRIMARY KEY,
                    value TEXT,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """
            )

            # Event queue table for unprocessed events
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS event_queue (
                    queue_id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL,
                    priority INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    status TEXT DEFAULT 'pending',
                    FOREIGN KEY (event_id) REFERENCES events (event_id)
                )
            """
            )

            # Create indexes for performance
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_id)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_events_processed ON events(processed)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_agents_last_seen ON agents(last_seen)"
            )
            cursor.execute(
                "CREATE INDEX IF NOT EXISTS idx_queue_status ON event_queue(status)"
            )

            conn.commit()
            logger.debug("Database schema initialized successfully")

    @contextmanager
    def _get_db_connection(self):
        """Get database connection with proper cleanup."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row  # Enable column access by name
        try:
            yield conn
        finally:
            conn.close()

    def get_mod_storage_path(self, mod_name: str) -> Path:
        """Get storage path for a specific mod.

        Args:
            mod_name: Full mod name (e.g., 'openagents.mods.workspace.messaging')

        Returns:
            Path: Directory path for mod storage
        """
        mod_dir = self.mods_path / mod_name
        mod_dir.mkdir(parents=True, exist_ok=True)
        return mod_dir

    def store_event(self, event: Event) -> bool:
        """Store an event in the database.

        Args:
            event: Event to store

        Returns:
            bool: True if stored successfully, False otherwise
        """
        if not self._initialized:
            logger.warning("Workspace not initialized, cannot store event")
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()

                # Serialize payload to JSON
                payload_json = json.dumps(event.payload) if event.payload else None

                cursor.execute(
                    """
                    INSERT OR REPLACE INTO events 
                    (event_id, event_name, source_id, destination_id, payload, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?)
                """,
                    (
                        event.event_id,
                        event.event_name,
                        event.source_id,
                        event.destination_id,
                        payload_json,
                        event.timestamp,
                    ),
                )

                conn.commit()
                logger.debug(f"Stored event {event.event_id} in database")
                return True

        except Exception as e:
            logger.error(f"Failed to store event {event.event_id}: {e}")
            return False

    def get_events(
        self,
        source_id: Optional[str] = None,
        destination_id: Optional[str] = None,
        event_name: Optional[str] = None,
        processed: Optional[bool] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Retrieve events from database with filtering.

        Args:
            source_id: Filter by source agent ID
            destination_id: Filter by destination agent ID
            event_name: Filter by event name
            processed: Filter by processed status
            limit: Maximum number of events to return
            offset: Number of events to skip

        Returns:
            List of event dictionaries
        """
        if not self._initialized:
            logger.warning("Workspace not initialized, cannot retrieve events")
            return []

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()

                # Build query with filters
                query = "SELECT * FROM events WHERE 1=1"
                params = []

                if source_id:
                    query += " AND source_id = ?"
                    params.append(source_id)

                if destination_id:
                    query += " AND destination_id = ?"
                    params.append(destination_id)

                if event_name:
                    query += " AND event_name = ?"
                    params.append(event_name)

                if processed is not None:
                    query += " AND processed = ?"
                    params.append(processed)

                query += " ORDER BY timestamp DESC LIMIT ? OFFSET ?"
                params.extend([limit, offset])

                cursor.execute(query, params)
                rows = cursor.fetchall()

                # Convert to dictionaries and parse JSON payloads
                events = []
                for row in rows:
                    event_dict = dict(row)
                    if event_dict["payload"]:
                        try:
                            event_dict["payload"] = json.loads(event_dict["payload"])
                        except json.JSONDecodeError:
                            event_dict["payload"] = {}
                    events.append(event_dict)

                return events

        except Exception as e:
            logger.error(f"Failed to retrieve events: {e}")
            return []

    def mark_event_processed(self, event_id: str) -> bool:
        """Mark an event as processed.

        Args:
            event_id: ID of the event to mark as processed

        Returns:
            bool: True if marked successfully, False otherwise
        """
        if not self._initialized:
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE events SET processed = TRUE WHERE event_id = ?", (event_id,)
                )
                conn.commit()
                return cursor.rowcount > 0

        except Exception as e:
            logger.error(f"Failed to mark event {event_id} as processed: {e}")
            return False

    def register_agent(self, agent_id: str, metadata: Dict[str, Any]) -> bool:
        """Register an agent in the workspace.

        Args:
            agent_id: Unique agent identifier
            metadata: Agent metadata dictionary

        Returns:
            bool: True if registered successfully, False otherwise
        """
        if not self._initialized:
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()

                metadata_json = json.dumps(metadata) if metadata else None

                cursor.execute(
                    """
                    INSERT OR REPLACE INTO agents 
                    (agent_id, metadata, last_seen)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                """,
                    (agent_id, metadata_json),
                )

                conn.commit()
                logger.debug(f"Registered agent {agent_id} in workspace")
                return True

        except Exception as e:
            logger.error(f"Failed to register agent {agent_id}: {e}")
            return False

    def unregister_agent(self, agent_id: str) -> bool:
        """Unregister an agent from the workspace.

        Args:
            agent_id: Agent identifier to unregister

        Returns:
            bool: True if unregistered successfully, False otherwise
        """
        if not self._initialized:
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("DELETE FROM agents WHERE agent_id = ?", (agent_id,))
                conn.commit()
                logger.debug(f"Unregistered agent {agent_id} from workspace")
                return cursor.rowcount > 0

        except Exception as e:
            logger.error(f"Failed to unregister agent {agent_id}: {e}")
            return False

    def get_agents(self) -> List[Dict[str, Any]]:
        """Get all registered agents.

        Returns:
            List of agent dictionaries with metadata
        """
        if not self._initialized:
            return []

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM agents ORDER BY registered_at")
                rows = cursor.fetchall()

                agents = []
                for row in rows:
                    agent_dict = dict(row)
                    if agent_dict["metadata"]:
                        try:
                            agent_dict["metadata"] = json.loads(agent_dict["metadata"])
                        except json.JSONDecodeError:
                            agent_dict["metadata"] = {}
                    agents.append(agent_dict)

                return agents

        except Exception as e:
            logger.error(f"Failed to retrieve agents: {e}")
            return []

    def update_agent_last_seen(self, agent_id: str) -> bool:
        """Update the last seen timestamp for an agent.

        Args:
            agent_id: Agent identifier

        Returns:
            bool: True if updated successfully, False otherwise
        """
        if not self._initialized:
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE agents SET last_seen = CURRENT_TIMESTAMP WHERE agent_id = ?",
                    (agent_id,),
                )
                conn.commit()
                return cursor.rowcount > 0

        except Exception as e:
            logger.error(f"Failed to update last seen for agent {agent_id}: {e}")
            return False

    def set_network_state(self, key: str, value: Any) -> bool:
        """Set a network state value.

        Args:
            key: State key
            value: State value (will be JSON serialized)

        Returns:
            bool: True if set successfully, False otherwise
        """
        if not self._initialized:
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()

                value_json = json.dumps(value) if value is not None else None

                cursor.execute(
                    """
                    INSERT OR REPLACE INTO network_state 
                    (key, value, updated_at)
                    VALUES (?, ?, CURRENT_TIMESTAMP)
                """,
                    (key, value_json),
                )

                conn.commit()
                return True

        except Exception as e:
            logger.error(f"Failed to set network state {key}: {e}")
            return False

    def get_network_state(self, key: str, default: Any = None) -> Any:
        """Get a network state value.

        Args:
            key: State key
            default: Default value if key not found

        Returns:
            State value or default
        """
        if not self._initialized:
            return default

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT value FROM network_state WHERE key = ?", (key,))
                row = cursor.fetchone()

                if row and row[0]:
                    try:
                        return json.loads(row[0])
                    except json.JSONDecodeError:
                        return default

                return default

        except Exception as e:
            logger.error(f"Failed to get network state {key}: {e}")
            return default

    def queue_event(self, event_id: str, priority: int = 0) -> bool:
        """Add an event to the processing queue.

        Args:
            event_id: ID of the event to queue
            priority: Event priority (higher = more important)

        Returns:
            bool: True if queued successfully, False otherwise
        """
        if not self._initialized:
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()

                queue_id = str(uuid.uuid4())
                cursor.execute(
                    """
                    INSERT INTO event_queue 
                    (queue_id, event_id, priority)
                    VALUES (?, ?, ?)
                """,
                    (queue_id, event_id, priority),
                )

                conn.commit()
                return True

        except Exception as e:
            logger.error(f"Failed to queue event {event_id}: {e}")
            return False

    def get_queued_events(self, limit: int = 100) -> List[Dict[str, Any]]:
        """Get pending events from the queue.

        Args:
            limit: Maximum number of events to return

        Returns:
            List of queued event dictionaries
        """
        if not self._initialized:
            return []

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    """
                    SELECT eq.*, e.* FROM event_queue eq
                    JOIN events e ON eq.event_id = e.event_id
                    WHERE eq.status = 'pending'
                    ORDER BY eq.priority DESC, eq.created_at ASC
                    LIMIT ?
                """,
                    (limit,),
                )

                rows = cursor.fetchall()
                events = []
                for row in rows:
                    event_dict = dict(row)
                    if event_dict["payload"]:
                        try:
                            event_dict["payload"] = json.loads(event_dict["payload"])
                        except json.JSONDecodeError:
                            event_dict["payload"] = {}
                    events.append(event_dict)

                return events

        except Exception as e:
            logger.error(f"Failed to get queued events: {e}")
            return []

    def mark_queue_event_processed(self, queue_id: str) -> bool:
        """Mark a queued event as processed.

        Args:
            queue_id: Queue entry ID

        Returns:
            bool: True if marked successfully, False otherwise
        """
        if not self._initialized:
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "UPDATE event_queue SET status = 'completed' WHERE queue_id = ?",
                    (queue_id,),
                )
                conn.commit()
                return cursor.rowcount > 0

        except Exception as e:
            logger.error(f"Failed to mark queue event {queue_id} as processed: {e}")
            return False

    def cleanup_old_events(self, days: int = 30) -> bool:
        """Clean up old events from the database.

        Args:
            days: Number of days of events to keep

        Returns:
            bool: True if cleanup successful, False otherwise
        """
        if not self._initialized:
            return False

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()

                # Delete old processed events
                cursor.execute(
                    """
                    DELETE FROM events 
                    WHERE processed = TRUE 
                    AND datetime(created_at) < datetime('now', '-? days')
                """,
                    (days,),
                )

                # Delete old completed queue entries
                cursor.execute(
                    """
                    DELETE FROM event_queue 
                    WHERE status = 'completed' 
                    AND datetime(created_at) < datetime('now', '-? days')
                """,
                    (days,),
                )

                conn.commit()
                logger.info(f"Cleaned up old events older than {days} days")
                return True

        except Exception as e:
            logger.error(f"Failed to cleanup old events: {e}")
            return False

    def get_workspace_stats(self) -> Dict[str, Any]:
        """Get workspace statistics.

        Returns:
            Dictionary with workspace statistics
        """
        if not self._initialized:
            return {}

        try:
            with self._get_db_connection() as conn:
                cursor = conn.cursor()

                stats = {}

                # Event counts
                cursor.execute("SELECT COUNT(*) FROM events")
                stats["total_events"] = cursor.fetchone()[0]

                cursor.execute("SELECT COUNT(*) FROM events WHERE processed = TRUE")
                stats["processed_events"] = cursor.fetchone()[0]

                # Agent counts
                cursor.execute("SELECT COUNT(*) FROM agents")
                stats["total_agents"] = cursor.fetchone()[0]

                # Queue stats
                cursor.execute(
                    "SELECT COUNT(*) FROM event_queue WHERE status = 'pending'"
                )
                stats["pending_queue_events"] = cursor.fetchone()[0]

                # Storage stats
                stats["workspace_path"] = str(self.workspace_path)
                stats["database_size"] = (
                    self.db_path.stat().st_size if self.db_path.exists() else 0
                )

                # Mod directories
                if self.mods_path.exists():
                    stats["mod_directories"] = [
                        d.name for d in self.mods_path.iterdir() if d.is_dir()
                    ]
                else:
                    stats["mod_directories"] = []

                return stats

        except Exception as e:
            logger.error(f"Failed to get workspace stats: {e}")
            return {}


def create_temporary_workspace() -> WorkspaceManager:
    """Create a temporary workspace for networks without persistent storage.

    Returns:
        WorkspaceManager: Initialized temporary workspace manager
    """
    temp_dir = tempfile.mkdtemp(prefix="openagents_workspace_")
    workspace = WorkspaceManager(temp_dir)

    if workspace.initialize_workspace():
        logger.info(f"Created temporary workspace at {temp_dir}")
        return workspace
    else:
        raise RuntimeError(f"Failed to initialize temporary workspace at {temp_dir}")


def discover_workspace_config(workspace_path: Path) -> Optional[Path]:
    """Discover network configuration file in workspace directory.

    Args:
        workspace_path: Path to workspace directory

    Returns:
        Path to network.yaml if found, None otherwise
    """
    config_file = workspace_path / "network.yaml"
    if config_file.exists():
        logger.info(f"Discovered network configuration at {config_file}")
        return config_file

    logger.debug(f"No network.yaml found in workspace {workspace_path}")
    return None
