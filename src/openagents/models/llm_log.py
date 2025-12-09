"""LLM Log data models for OpenAgents.

This module defines the data structures for logging LLM (Language Model) calls,
including prompts, completions, token usage, and metadata.
"""

from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any
import json


@dataclass
class LLMLogEntry:
    """A single LLM call log entry.

    Captures all information about a single call to an LLM provider,
    including the request, response, and metadata.
    """

    # Identifiers
    log_id: str                           # UUID for this log entry
    agent_id: str                         # Service agent that made the call
    timestamp: float                      # Unix timestamp

    # Request
    model_name: str                       # e.g., "gpt-4o", "claude-sonnet-4-20250514"
    provider: str                         # e.g., "openai", "anthropic"
    messages: List[Dict[str, Any]]        # Full messages array sent to LLM
    tools: Optional[List[Dict[str, Any]]] = None  # Tool definitions if any

    # Response
    completion: str = ""                  # Text response from LLM
    tool_calls: Optional[List[Dict[str, Any]]] = None  # Tool calls if any

    # Metadata
    latency_ms: int = 0                   # Response time in milliseconds
    input_tokens: Optional[int] = None    # Tokens in prompt (if available)
    output_tokens: Optional[int] = None   # Tokens in completion (if available)
    total_tokens: Optional[int] = None    # Total tokens used
    error: Optional[str] = None           # Error message if call failed

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)

    def to_json(self) -> str:
        """Convert to JSON string."""
        return json.dumps(self.to_dict())

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "LLMLogEntry":
        """Create an LLMLogEntry from a dictionary."""
        return cls(**data)

    @classmethod
    def from_json(cls, json_str: str) -> "LLMLogEntry":
        """Create an LLMLogEntry from a JSON string."""
        return cls.from_dict(json.loads(json_str))

    def to_summary(self, preview_length: int = 100) -> Dict[str, Any]:
        """Convert to a summary dict for list views.

        Returns a lighter representation suitable for listing logs,
        with a preview of the messages instead of full content.
        """
        # Create preview from first user message or system message
        preview = ""
        for msg in self.messages:
            content = msg.get("content", "")
            if content and isinstance(content, str):
                preview = content[:preview_length]
                if len(content) > preview_length:
                    preview += "..."
                break

        return {
            "log_id": self.log_id,
            "timestamp": self.timestamp,
            "model_name": self.model_name,
            "provider": self.provider,
            "latency_ms": self.latency_ms,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "has_tool_calls": bool(self.tool_calls),
            "error": self.error,
            "preview": preview,
        }


@dataclass
class LLMLogStats:
    """Statistics for LLM logs of an agent.

    Provides aggregated statistics about LLM usage for an agent.
    """

    agent_id: str
    total_calls: int = 0
    total_tokens: int = 0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_errors: int = 0
    avg_latency_ms: float = 0.0
    models_used: Dict[str, int] = field(default_factory=dict)  # model_name -> call count

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)
