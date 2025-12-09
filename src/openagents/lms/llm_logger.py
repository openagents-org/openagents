"""LLM Call Logger for OpenAgents.

This module provides logging functionality for LLM (Language Model) calls,
storing prompts, completions, token usage, and metadata to JSONL files.

Two logger implementations are provided:
- LLMCallLogger: Writes logs directly to workspace files (for network/embedded use)
- EventBasedLLMLogger: Sends logs via system events (for external agents)
"""

import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Any, TYPE_CHECKING
from datetime import datetime, timedelta

from openagents.models.llm_log import LLMLogEntry

if TYPE_CHECKING:
    from openagents.core.client import AgentClient

logger = logging.getLogger(__name__)

# Constants for log management
MAX_LOG_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50MB
LOG_RETENTION_DAYS = 7


class LLMCallLogger:
    """Logger for LLM calls.

    Records LLM calls to JSONL files organized by agent ID.
    Handles log rotation and cleanup automatically.
    """

    def __init__(self, workspace_path: Path, agent_id: str):
        """Initialize the LLM call logger.

        Args:
            workspace_path: Base path for the workspace
            agent_id: ID of the service agent making the calls
        """
        self.workspace = Path(workspace_path)
        self.agent_id = agent_id
        self.log_dir = self.workspace / "logs" / "llm"
        self.log_file = self.log_dir / f"{agent_id}.jsonl"

    def _ensure_log_dir(self) -> None:
        """Ensure the log directory exists."""
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def _should_rotate(self) -> bool:
        """Check if the log file should be rotated based on size."""
        if not self.log_file.exists():
            return False
        return self.log_file.stat().st_size >= MAX_LOG_FILE_SIZE_BYTES

    def _rotate_log(self) -> None:
        """Rotate the log file by renaming it with a timestamp."""
        if not self.log_file.exists():
            return

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        rotated_name = f"{self.agent_id}_{timestamp}.jsonl"
        rotated_path = self.log_dir / rotated_name

        try:
            self.log_file.rename(rotated_path)
            logger.info(f"Rotated LLM log file to: {rotated_path}")
        except Exception as e:
            logger.error(f"Failed to rotate LLM log file: {e}")

    def _cleanup_old_logs(self) -> None:
        """Remove log files older than the retention period."""
        if not self.log_dir.exists():
            return

        cutoff_time = datetime.now() - timedelta(days=LOG_RETENTION_DAYS)
        cutoff_timestamp = cutoff_time.timestamp()

        try:
            for log_file in self.log_dir.glob(f"{self.agent_id}*.jsonl"):
                if log_file.stat().st_mtime < cutoff_timestamp:
                    log_file.unlink()
                    logger.info(f"Deleted old LLM log file: {log_file}")
        except Exception as e:
            logger.error(f"Failed to cleanup old LLM logs: {e}")

    async def log_call(
        self,
        model_name: str,
        provider: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        response: Dict[str, Any],
        latency_ms: int,
        error: Optional[str] = None,
    ) -> str:
        """Log an LLM call to the agent's log file.

        Args:
            model_name: Name of the model used
            provider: LLM provider name (e.g., "openai", "anthropic")
            messages: Messages sent to the LLM
            tools: Tool definitions if any
            response: Response from the LLM (standardized format)
            latency_ms: Response time in milliseconds
            error: Error message if the call failed

        Returns:
            The log_id of the created entry
        """
        log_id = str(uuid.uuid4())

        # Extract token usage from response
        usage = response.get("usage", {})

        entry = LLMLogEntry(
            log_id=log_id,
            agent_id=self.agent_id,
            timestamp=time.time(),
            model_name=model_name,
            provider=provider,
            messages=messages,
            tools=tools,
            completion=response.get("content", "") or "",
            tool_calls=response.get("tool_calls") if response.get("tool_calls") else None,
            latency_ms=latency_ms,
            input_tokens=usage.get("prompt_tokens") or usage.get("input_tokens"),
            output_tokens=usage.get("completion_tokens") or usage.get("output_tokens"),
            total_tokens=usage.get("total_tokens"),
            error=error,
        )

        # Ensure directory exists
        self._ensure_log_dir()

        # Check if rotation is needed
        if self._should_rotate():
            self._rotate_log()

        # Periodically cleanup old logs (approximately every 100 calls)
        if hasattr(self, "_call_count"):
            self._call_count += 1
        else:
            self._call_count = 1

        if self._call_count % 100 == 0:
            self._cleanup_old_logs()

        # Write entry to file
        self._write_log_entry(entry)

        return log_id

    def _write_log_entry(self, entry: LLMLogEntry) -> None:
        """Write a log entry to the log file.

        This method is also used by the network's system command handler
        to write logs received from external agents.

        Args:
            entry: The LLMLogEntry to write
        """
        # Ensure directory exists
        self._ensure_log_dir()

        # Check if rotation is needed
        if self._should_rotate():
            self._rotate_log()

        # Append to log file
        try:
            with open(self.log_file, "a", encoding="utf-8") as f:
                f.write(entry.to_json() + "\n")
            logger.debug(f"Wrote LLM log entry: {entry.log_id} for agent {self.agent_id}")
        except Exception as e:
            logger.error(f"Failed to write LLM log entry: {e}")

    def log_call_sync(
        self,
        model_name: str,
        provider: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        response: Dict[str, Any],
        latency_ms: int,
        error: Optional[str] = None,
    ) -> str:
        """Synchronous version of log_call for non-async contexts.

        Args:
            Same as log_call

        Returns:
            The log_id of the created entry
        """
        import asyncio

        # Check if we're in an async context
        try:
            loop = asyncio.get_running_loop()
            # If we're in an async context, we can't use run_until_complete
            # So we do the logging directly
            return self._log_call_internal(
                model_name, provider, messages, tools, response, latency_ms, error
            )
        except RuntimeError:
            # No running loop, we can use asyncio.run
            return asyncio.run(
                self.log_call(
                    model_name, provider, messages, tools, response, latency_ms, error
                )
            )

    def _log_call_internal(
        self,
        model_name: str,
        provider: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        response: Dict[str, Any],
        latency_ms: int,
        error: Optional[str] = None,
    ) -> str:
        """Internal synchronous implementation of log_call."""
        log_id = str(uuid.uuid4())

        # Extract token usage from response
        usage = response.get("usage", {})

        entry = LLMLogEntry(
            log_id=log_id,
            agent_id=self.agent_id,
            timestamp=time.time(),
            model_name=model_name,
            provider=provider,
            messages=messages,
            tools=tools,
            completion=response.get("content", "") or "",
            tool_calls=response.get("tool_calls") if response.get("tool_calls") else None,
            latency_ms=latency_ms,
            input_tokens=usage.get("prompt_tokens") or usage.get("input_tokens"),
            output_tokens=usage.get("completion_tokens") or usage.get("output_tokens"),
            total_tokens=usage.get("total_tokens"),
            error=error,
        )

        # Write entry to file
        self._write_log_entry(entry)

        return log_id


def extract_token_usage(provider: str, raw_response: Any) -> Dict[str, Optional[int]]:
    """Extract token usage from provider-specific response.

    Args:
        provider: Name of the LLM provider
        raw_response: Raw response object from the provider

    Returns:
        Dictionary with input_tokens, output_tokens, and total_tokens
    """
    result: Dict[str, Optional[int]] = {
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
    }

    try:
        if provider == "openai" or provider == "azure":
            # OpenAI/Azure returns usage in response.usage
            if hasattr(raw_response, "usage") and raw_response.usage:
                usage = raw_response.usage
                result["input_tokens"] = getattr(usage, "prompt_tokens", None)
                result["output_tokens"] = getattr(usage, "completion_tokens", None)
                result["total_tokens"] = getattr(usage, "total_tokens", None)

        elif provider == "anthropic":
            # Anthropic returns usage in response.usage
            if hasattr(raw_response, "usage") and raw_response.usage:
                usage = raw_response.usage
                result["input_tokens"] = getattr(usage, "input_tokens", None)
                result["output_tokens"] = getattr(usage, "output_tokens", None)
                # Calculate total if not provided
                if result["input_tokens"] is not None and result["output_tokens"] is not None:
                    result["total_tokens"] = result["input_tokens"] + result["output_tokens"]

        elif provider == "bedrock":
            # Bedrock response is usually a dict
            if isinstance(raw_response, dict):
                usage = raw_response.get("usage", {})
                result["input_tokens"] = usage.get("input_tokens")
                result["output_tokens"] = usage.get("output_tokens")
                if result["input_tokens"] is not None and result["output_tokens"] is not None:
                    result["total_tokens"] = result["input_tokens"] + result["output_tokens"]

        elif provider == "gemini":
            # Gemini may return usage metadata
            if hasattr(raw_response, "usage_metadata"):
                usage = raw_response.usage_metadata
                result["input_tokens"] = getattr(usage, "prompt_token_count", None)
                result["output_tokens"] = getattr(usage, "candidates_token_count", None)
                result["total_tokens"] = getattr(usage, "total_token_count", None)

        else:
            # Generic provider - try common patterns
            if hasattr(raw_response, "usage"):
                usage = raw_response.usage
                # Try OpenAI-style first
                result["input_tokens"] = getattr(usage, "prompt_tokens", None)
                result["output_tokens"] = getattr(usage, "completion_tokens", None)
                result["total_tokens"] = getattr(usage, "total_tokens", None)

    except Exception as e:
        logger.warning(f"Failed to extract token usage from {provider} response: {e}")

    return result


class EventBasedLLMLogger:
    """LLM Logger that sends logs via system events to the network.

    This logger is designed for external agents that connect to the network
    remotely and need to report their LLM calls to the network for centralized
    logging and monitoring.

    Instead of writing to local files, it sends logs via the system.report_llm_log
    event to the network, which then stores them in the workspace.
    """

    def __init__(self, agent_id: str, client: "AgentClient"):
        """Initialize the event-based LLM logger.

        Args:
            agent_id: ID of the agent making the LLM calls
            client: AgentClient for sending events to the network
        """
        self.agent_id = agent_id
        self.client = client

    async def log_call(
        self,
        model_name: str,
        provider: str,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]],
        response: Dict[str, Any],
        latency_ms: int,
        error: Optional[str] = None,
    ) -> str:
        """Log an LLM call by sending it to the network.

        Args:
            model_name: Name of the model used
            provider: LLM provider name (e.g., "openai", "anthropic")
            messages: Messages sent to the LLM
            tools: Tool definitions if any
            response: Response from the LLM (standardized format)
            latency_ms: Response time in milliseconds
            error: Error message if the call failed

        Returns:
            The log_id of the created entry
        """
        log_id = str(uuid.uuid4())

        # Extract token usage from response
        usage = response.get("usage", {})

        entry = LLMLogEntry(
            log_id=log_id,
            agent_id=self.agent_id,
            timestamp=time.time(),
            model_name=model_name,
            provider=provider,
            messages=messages,
            tools=tools,
            completion=response.get("content", "") or "",
            tool_calls=response.get("tool_calls") if response.get("tool_calls") else None,
            latency_ms=latency_ms,
            input_tokens=usage.get("prompt_tokens") or usage.get("input_tokens"),
            output_tokens=usage.get("completion_tokens") or usage.get("output_tokens"),
            total_tokens=usage.get("total_tokens"),
            error=error,
        )

        # Send the log entry to the network via system event
        try:
            from openagents.config.globals import SYSTEM_EVENT_REPORT_LLM_LOG
            from openagents.models.event import Event

            event = Event(
                event_name=SYSTEM_EVENT_REPORT_LLM_LOG,
                source_id=self.agent_id,
                destination_id="system:system",
                payload={
                    "agent_id": self.agent_id,
                    "log_entry": entry.to_dict(),
                },
            )

            response = await self.client.send_event(event)
            if response and response.success:
                logger.debug(f"Sent LLM log to network: {log_id}")
            else:
                error_msg = response.message if response else "No response"
                logger.warning(f"Failed to send LLM log to network: {error_msg}")

        except Exception as e:
            logger.error(f"Error sending LLM log event: {e}")

        return log_id
