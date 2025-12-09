"""LLM Log Reader for OpenAgents.

This module provides functionality for reading, filtering, and querying
LLM call logs stored in JSONL files.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

from openagents.models.llm_log import LLMLogEntry, LLMLogStats

logger = logging.getLogger(__name__)


class LLMLogReader:
    """Reader for LLM call logs.

    Provides methods to read, filter, and search through LLM logs
    stored in JSONL format.
    """

    def __init__(self, workspace_path: Path):
        """Initialize the LLM log reader.

        Args:
            workspace_path: Base path for the workspace
        """
        self.workspace = Path(workspace_path)
        self.log_dir = self.workspace / "logs" / "llm"

    def _get_log_files(self, agent_id: str) -> List[Path]:
        """Get all log files for an agent, sorted by modification time (newest first).

        Args:
            agent_id: ID of the agent

        Returns:
            List of log file paths, newest first
        """
        if not self.log_dir.exists():
            return []

        # Get both current and rotated log files
        log_files = list(self.log_dir.glob(f"{agent_id}*.jsonl"))
        # Sort by modification time, newest first
        log_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
        return log_files

    def get_logs(
        self,
        agent_id: str,
        limit: int = 50,
        offset: int = 0,
        model: Optional[str] = None,
        since: Optional[float] = None,
        has_error: Optional[bool] = None,
        search: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Read and filter LLM logs for an agent.

        Args:
            agent_id: ID of the agent
            limit: Maximum number of entries to return (max: 200)
            offset: Number of entries to skip
            model: Filter by model name
            since: Only return entries after this Unix timestamp
            has_error: Filter by error status (True for errors only, False for no errors)
            search: Search string to match in messages or completion

        Returns:
            Tuple of (list of log entries as summaries, total count matching filters)
        """
        # Enforce max limit
        limit = min(limit, 200)

        log_files = self._get_log_files(agent_id)
        if not log_files:
            return [], 0

        entries = []
        search_lower = search.lower() if search else None

        # Read entries from all log files (newest first)
        for log_file in log_files:
            try:
                with open(log_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue

                        try:
                            entry_data = json.loads(line)
                        except json.JSONDecodeError as e:
                            logger.warning(f"Failed to parse log entry: {e}")
                            continue

                        # Apply filters
                        if model and entry_data.get("model_name") != model:
                            continue

                        if since and entry_data.get("timestamp", 0) < since:
                            continue

                        if has_error is not None:
                            entry_has_error = bool(entry_data.get("error"))
                            if has_error != entry_has_error:
                                continue

                        if search_lower:
                            # Search in messages and completion
                            text_to_search = ""
                            messages = entry_data.get("messages", [])
                            for msg in messages:
                                content = msg.get("content", "")
                                if isinstance(content, str):
                                    text_to_search += content + " "
                            text_to_search += entry_data.get("completion", "") or ""

                            if search_lower not in text_to_search.lower():
                                continue

                        entries.append(entry_data)

            except Exception as e:
                logger.error(f"Failed to read log file {log_file}: {e}")

        # Sort by timestamp descending (most recent first)
        entries.sort(key=lambda x: x.get("timestamp", 0), reverse=True)

        total_count = len(entries)

        # Apply pagination
        paginated_entries = entries[offset : offset + limit]

        # Convert to summary format
        summaries = []
        for entry_data in paginated_entries:
            try:
                entry = LLMLogEntry.from_dict(entry_data)
                summaries.append(entry.to_summary())
            except Exception as e:
                logger.warning(f"Failed to convert entry to summary: {e}")
                # Fallback to raw data with minimal transformation
                summaries.append({
                    "log_id": entry_data.get("log_id", ""),
                    "timestamp": entry_data.get("timestamp", 0),
                    "model_name": entry_data.get("model_name", ""),
                    "provider": entry_data.get("provider", ""),
                    "latency_ms": entry_data.get("latency_ms", 0),
                    "input_tokens": entry_data.get("input_tokens"),
                    "output_tokens": entry_data.get("output_tokens"),
                    "total_tokens": entry_data.get("total_tokens"),
                    "has_tool_calls": bool(entry_data.get("tool_calls")),
                    "error": entry_data.get("error"),
                    "preview": "",
                })

        return summaries, total_count

    def get_log_entry(self, agent_id: str, log_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific log entry by ID.

        Args:
            agent_id: ID of the agent
            log_id: ID of the log entry

        Returns:
            Full log entry as a dictionary, or None if not found
        """
        log_files = self._get_log_files(agent_id)

        for log_file in log_files:
            try:
                with open(log_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue

                        try:
                            entry_data = json.loads(line)
                            if entry_data.get("log_id") == log_id:
                                return entry_data
                        except json.JSONDecodeError:
                            continue

            except Exception as e:
                logger.error(f"Failed to read log file {log_file}: {e}")

        return None

    def get_stats(self, agent_id: str) -> LLMLogStats:
        """Get statistics for an agent's LLM usage.

        Args:
            agent_id: ID of the agent

        Returns:
            LLMLogStats object with aggregated statistics
        """
        stats = LLMLogStats(agent_id=agent_id)
        log_files = self._get_log_files(agent_id)

        total_latency = 0

        for log_file in log_files:
            try:
                with open(log_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue

                        try:
                            entry_data = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        stats.total_calls += 1

                        # Token counts
                        input_tokens = entry_data.get("input_tokens") or 0
                        output_tokens = entry_data.get("output_tokens") or 0
                        total_tokens = entry_data.get("total_tokens") or (input_tokens + output_tokens)

                        stats.total_input_tokens += input_tokens
                        stats.total_output_tokens += output_tokens
                        stats.total_tokens += total_tokens

                        # Latency
                        total_latency += entry_data.get("latency_ms", 0)

                        # Errors
                        if entry_data.get("error"):
                            stats.total_errors += 1

                        # Models used
                        model_name = entry_data.get("model_name", "unknown")
                        stats.models_used[model_name] = stats.models_used.get(model_name, 0) + 1

            except Exception as e:
                logger.error(f"Failed to read log file {log_file}: {e}")

        # Calculate average latency
        if stats.total_calls > 0:
            stats.avg_latency_ms = total_latency / stats.total_calls

        return stats

    def list_agents(self) -> List[str]:
        """List all agents that have LLM logs.

        Returns:
            List of agent IDs that have log files
        """
        if not self.log_dir.exists():
            return []

        agent_ids = set()
        for log_file in self.log_dir.glob("*.jsonl"):
            # Extract agent_id from filename
            # Format: {agent_id}.jsonl or {agent_id}_{YYYYMMDD}_{HHMMSS}.jsonl (rotated)
            name = log_file.stem

            # Check if this is a rotated log file (ends with _YYYYMMDD_HHMMSS pattern)
            import re
            rotated_pattern = r'^(.+)_\d{8}_\d{6}$'
            match = re.match(rotated_pattern, name)
            if match:
                agent_id = match.group(1)
            else:
                agent_id = name
            agent_ids.add(agent_id)

        return sorted(list(agent_ids))

    def get_models_used(self, agent_id: str) -> List[str]:
        """Get list of models used by an agent.

        Args:
            agent_id: ID of the agent

        Returns:
            List of unique model names
        """
        models = set()
        log_files = self._get_log_files(agent_id)

        for log_file in log_files:
            try:
                with open(log_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue

                        try:
                            entry_data = json.loads(line)
                            model_name = entry_data.get("model_name")
                            if model_name:
                                models.add(model_name)
                        except json.JSONDecodeError:
                            continue

            except Exception as e:
                logger.error(f"Failed to read log file {log_file}: {e}")

        return sorted(list(models))
