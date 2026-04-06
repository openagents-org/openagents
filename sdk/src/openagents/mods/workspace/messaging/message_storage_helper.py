"""
Message Storage Helper for Messaging Mod

This helper class extracts the storage complexity from the messaging mod, providing:
- Memory management with configurable limits
- Periodic dumps to prevent data loss
- Daily archiving of old messages
- Automatic cleanup of expired archives
- Comprehensive error handling and logging
"""

import logging
import json
import gzip
import time
from datetime import datetime
from typing import Dict, Any, List, Optional
from pathlib import Path

from openagents.models.event import Event

logger = logging.getLogger(__name__)


class MessageStorageConfig:
    """Configuration for message storage behavior."""

    def __init__(
        self,
        max_memory_messages: int = 1000,
        memory_cleanup_minutes: int = 30,
        dump_interval_minutes: int = 10,
        hot_storage_days: int = 7,
        archive_retention_days: int = 180,
    ):
        self.max_memory_messages = max_memory_messages
        self.memory_cleanup_interval = memory_cleanup_minutes * 60  # Convert to seconds
        self.dump_interval = dump_interval_minutes * 60
        self.hot_storage_days = hot_storage_days
        self.archive_retention_days = archive_retention_days

        # Timing state
        self.last_dump_time = time.time()
        self.last_cleanup_time = time.time()
        self.last_archive_cleanup_time = time.time()


class MessageStorageHelper:
    """Helper class for managing message persistence and memory cleanup."""

    def __init__(self, storage_path_provider, config: MessageStorageConfig):
        """
        Initialize the storage helper.

        Args:
            storage_path_provider: Function that returns the storage path (e.g., mod.get_storage_path)
            config: Storage configuration object
        """
        self.get_storage_path = storage_path_provider
        self.config = config

    def should_perform_dump(self) -> bool:
        """Check if periodic dump should be performed."""
        now = time.time()
        return now - self.config.last_dump_time > self.config.dump_interval

    def should_perform_memory_cleanup(self) -> bool:
        """Check if memory cleanup should be performed."""
        now = time.time()
        return now - self.config.last_cleanup_time > self.config.memory_cleanup_interval

    def should_perform_archive_cleanup(self) -> bool:
        """Check if archive cleanup should be performed."""
        now = time.time()
        return now - self.config.last_archive_cleanup_time > (24 * 3600)  # Daily

    def periodic_dump(self, message_history: Dict[str, Event]):
        """
        Dump current in-memory data periodically to prevent data loss.

        Args:
            message_history: Current message history dictionary
        """
        try:
            storage_path = self.get_storage_path()

            # Create timestamped dump for safety
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

            # Save main message history (existing logic from mod)
            self.save_message_history(message_history)

            # Also create a backup dump with timestamp
            backup_file = storage_path / f"message_dump_{timestamp}.json"
            history_data = self._serialize_message_history(message_history)

            with open(backup_file, "w") as f:
                json.dump(history_data, f, indent=2, default=str)

            logger.info(f"Periodic dump completed: {len(history_data)} messages dumped")

            # Cleanup old backup dumps (keep only last 24 hours)
            self.cleanup_old_dumps()

            # Update timing
            self.config.last_dump_time = time.time()

        except Exception as e:
            logger.error(f"Periodic dump failed: {e}")

    def save_message_history(self, message_history: Dict[str, Event]):
        """
        Save message history to the main storage file.

        Args:
            message_history: Current message history dictionary
        """
        try:
            storage_path = self.get_storage_path()
            history_file = storage_path / "message_history.json"

            # Serialize message history
            history_data = self._serialize_message_history(message_history)

            # Write to file
            with open(history_file, "w") as f:
                json.dump(history_data, f, indent=2, default=str)

        except Exception as e:
            logger.error(f"Failed to save message history: {e}")

    def load_message_history(self) -> Dict[str, Event]:
        """
        Load message history from storage.

        Returns:
            Dictionary of message_id -> Event objects
        """
        message_history = {}

        try:
            storage_path = self.get_storage_path()
            history_file = storage_path / "message_history.json"

            if history_file.exists():
                with open(history_file, "r") as f:
                    history_data = json.load(f)

                # Reconstruct Event objects
                for message_id, message_data in history_data.items():
                    try:
                        event = Event(**message_data)
                        message_history[message_id] = event
                    except Exception as e:
                        logger.warning(
                            f"Failed to deserialize message {message_id}: {e}"
                        )

                logger.info(f"Loaded {len(message_history)} messages from storage")

        except Exception as e:
            logger.error(f"Failed to load message history: {e}")

        return message_history

    def cleanup_old_memory(
        self,
        message_history: Dict[str, Event],
        message_to_thread: Dict[str, str],
        threads: Dict[str, Any],
    ) -> List[str]:
        """
        Clean up old messages from memory based on time and count.

        Args:
            message_history: Current message history dictionary
            message_to_thread: Message to thread mapping
            threads: Thread dictionary

        Returns:
            List of message IDs that were removed
        """
        removed_ids = []

        try:
            now = time.time()

            # Remove messages older than hot storage days
            hot_cutoff = now - (self.config.hot_storage_days * 24 * 3600)
            old_message_ids = []

            for message_id, event in message_history.items():
                if event.timestamp < hot_cutoff:
                    old_message_ids.append(message_id)

            # Archive old messages before removing from memory
            if old_message_ids:
                self.archive_messages_by_date(old_message_ids, message_history)

                # Remove from memory
                for msg_id in old_message_ids:
                    if msg_id in message_history:
                        del message_history[msg_id]
                        removed_ids.append(msg_id)

                    # Also clean up thread references
                    if msg_id in message_to_thread:
                        thread_id = message_to_thread[msg_id]
                        del message_to_thread[msg_id]

                        # Clean up empty threads
                        if thread_id in threads:
                            thread = threads[thread_id]
                            if (
                                hasattr(thread, "root_message_id")
                                and msg_id == thread.root_message_id
                            ):
                                del threads[thread_id]

                logger.info(
                    f"Cleaned up {len(old_message_ids)} old messages from memory"
                )

            # Update timing
            self.config.last_cleanup_time = time.time()

        except Exception as e:
            logger.error(f"Memory cleanup failed: {e}")

        return removed_ids

    def cleanup_excess_messages(self, message_history: Dict[str, Event]) -> List[str]:
        """
        Emergency cleanup when memory limit is exceeded.

        Args:
            message_history: Current message history dictionary

        Returns:
            List of message IDs that were removed
        """
        removed_ids = []

        try:
            if len(message_history) <= self.config.max_memory_messages:
                return removed_ids

            # Sort by timestamp and remove oldest messages
            sorted_messages = sorted(
                message_history.items(), key=lambda x: x[1].timestamp
            )

            # Calculate how many to remove (remove to 80% of limit)
            excess_count = len(message_history) - int(
                self.config.max_memory_messages * 0.8
            )
            messages_to_remove = sorted_messages[:excess_count]

            # Archive before removing
            old_message_ids = [msg_id for msg_id, _ in messages_to_remove]
            self.archive_messages_by_date(old_message_ids, message_history)

            # Remove from memory
            for msg_id, _ in messages_to_remove:
                if msg_id in message_history:
                    del message_history[msg_id]
                    removed_ids.append(msg_id)

            logger.info(
                f"Emergency cleanup: removed {excess_count} excess messages from memory"
            )

        except Exception as e:
            logger.error(f"Emergency cleanup failed: {e}")

        return removed_ids

    def archive_messages_by_date(
        self, message_ids: List[str], message_history: Dict[str, Event]
    ):
        """
        Archive specific messages to daily files before removing from memory.

        Args:
            message_ids: List of message IDs to archive
            message_history: Current message history dictionary
        """
        try:
            storage_path = self.get_storage_path()
            archives_dir = storage_path / "daily_archives"
            archives_dir.mkdir(exist_ok=True)

            # Group messages by date
            messages_by_date = {}
            for msg_id in message_ids:
                if msg_id not in message_history:
                    continue

                event = message_history[msg_id]
                message_date = (
                    datetime.fromtimestamp(event.timestamp).date().isoformat()
                )

                if message_date not in messages_by_date:
                    messages_by_date[message_date] = {}

                try:
                    serialized = self._serialize_event(event)
                    messages_by_date[message_date][msg_id] = serialized
                except Exception as e:
                    logger.warning(
                        f"Failed to serialize message {msg_id} for archiving: {e}"
                    )

            # Save/append to daily archive files
            for date_str, daily_messages in messages_by_date.items():
                archive_file = archives_dir / f"{date_str}.json.gz"

                existing_messages = {}
                if archive_file.exists():
                    # Load existing messages for this date
                    try:
                        with gzip.open(archive_file, "rt") as f:
                            existing_messages = json.load(f)
                    except Exception as e:
                        logger.warning(
                            f"Could not load existing archive {archive_file}: {e}"
                        )

                # Merge with new messages
                existing_messages.update(daily_messages)

                # Save back to compressed file
                with gzip.open(archive_file, "wt") as f:
                    json.dump(existing_messages, f, indent=2, default=str)

                logger.info(
                    f"Archived {len(daily_messages)} messages to {date_str}.json.gz"
                )

        except Exception as e:
            logger.error(f"Archiving failed: {e}")

    def cleanup_expired_archives(self):
        """Remove archived files older than retention policy."""
        try:
            storage_path = self.get_storage_path()
            archives_dir = storage_path / "daily_archives"

            if not archives_dir.exists():
                return

            cutoff_timestamp = time.time() - (
                self.config.archive_retention_days * 24 * 3600
            )
            cutoff_date = datetime.fromtimestamp(cutoff_timestamp).date()

            deleted_count = 0
            for archive_file in archives_dir.glob("*.json.gz"):
                try:
                    # Extract date from filename (YYYY-MM-DD.json.gz)
                    date_str = archive_file.stem  # Remove .gz extension
                    if date_str.endswith(".json"):
                        date_str = date_str[:-5]  # Remove .json extension

                    archive_date = datetime.fromisoformat(date_str).date()

                    if archive_date < cutoff_date:
                        archive_file.unlink()
                        deleted_count += 1
                        logger.debug(f"Deleted expired archive: {archive_file}")
                except Exception as e:
                    logger.warning(
                        f"Could not process archive file {archive_file}: {e}"
                    )

            if deleted_count > 0:
                logger.info(f"Cleaned up {deleted_count} expired archive files")

            # Update timing
            self.config.last_archive_cleanup_time = time.time()

        except Exception as e:
            logger.error(f"Archive cleanup failed: {e}")

    def cleanup_old_dumps(self):
        """Remove dump files older than 24 hours."""
        try:
            storage_path = self.get_storage_path()
            cutoff_time = time.time() - (24 * 3600)  # 24 hours ago

            for dump_file in storage_path.glob("message_dump_*.json"):
                if dump_file.stat().st_mtime < cutoff_time:
                    dump_file.unlink()
                    logger.debug(f"Removed old dump: {dump_file}")
        except Exception as e:
            logger.warning(f"Failed to cleanup old dumps: {e}")

    def _serialize_message_history(
        self, message_history: Dict[str, Event]
    ) -> Dict[str, Any]:
        """Serialize message history to JSON-compatible format."""
        history_data = {}
        for message_id, event in message_history.items():
            try:
                history_data[message_id] = self._serialize_event(event)
            except Exception as e:
                logger.warning(f"Failed to serialize message {message_id}: {e}")
        return history_data

    def _serialize_event(self, event: Event) -> Dict[str, Any]:
        """Serialize a single event to JSON-compatible format."""
        if hasattr(event, "model_dump"):
            return event.model_dump()
        elif hasattr(event, "dict"):
            return event.dict()
        else:
            # Fallback for older Event objects
            return {
                "event_id": getattr(event, "event_id", ""),
                "event_name": getattr(event, "event_name", ""),
                "source_id": getattr(event, "source_id", ""),
                "destination_id": getattr(event, "destination_id", ""),
                "timestamp": getattr(event, "timestamp", 0),
                "payload": getattr(event, "payload", {}),
            }

    def get_storage_stats(self) -> Dict[str, Any]:
        """Get comprehensive storage statistics."""
        try:
            storage_path = self.get_storage_path()

            stats = {
                "storage_path": str(storage_path),
                "main_file_exists": (storage_path / "message_history.json").exists(),
                "main_file_size_mb": 0,
                "daily_archives_count": 0,
                "daily_archives_size_mb": 0,
                "dump_files_count": 0,
                "dump_files_size_mb": 0,
            }

            # Main file stats
            main_file = storage_path / "message_history.json"
            if main_file.exists():
                stats["main_file_size_mb"] = main_file.stat().st_size / (1024 * 1024)

            # Archive stats
            archives_dir = storage_path / "daily_archives"
            if archives_dir.exists():
                archive_files = list(archives_dir.glob("*.json.gz"))
                stats["daily_archives_count"] = len(archive_files)
                total_size = sum(f.stat().st_size for f in archive_files)
                stats["daily_archives_size_mb"] = total_size / (1024 * 1024)

            # Dump file stats
            dump_files = list(storage_path.glob("message_dump_*.json"))
            stats["dump_files_count"] = len(dump_files)
            total_size = sum(f.stat().st_size for f in dump_files)
            stats["dump_files_size_mb"] = total_size / (1024 * 1024)

            return stats

        except Exception as e:
            logger.error(f"Failed to get storage stats: {e}")
            return {"error": str(e)}
