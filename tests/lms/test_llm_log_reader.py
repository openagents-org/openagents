"""
Test cases for the LLM Log Reader.

This module contains tests for the LLM log reading functionality,
including filtering, pagination, and search.
"""

import json
import os
import pytest
import tempfile
import time
import uuid
from pathlib import Path

from openagents.lms.llm_log_reader import LLMLogReader
from openagents.models.llm_log import LLMLogEntry


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def log_reader(temp_workspace):
    """Create an LLM log reader instance for testing."""
    return LLMLogReader(temp_workspace)


def create_log_entry(
    agent_id: str = "test_agent",
    model_name: str = "gpt-4o",
    provider: str = "openai",
    timestamp: float = None,
    error: str = None,
    messages: list = None,
    completion: str = "Test response",
    tool_calls: list = None,
    input_tokens: int = 10,
    output_tokens: int = 5,
) -> dict:
    """Helper function to create a log entry dictionary."""
    return {
        "log_id": str(uuid.uuid4()),
        "agent_id": agent_id,
        "timestamp": timestamp or time.time(),
        "model_name": model_name,
        "provider": provider,
        "messages": messages or [{"role": "user", "content": "Test message"}],
        "tools": None,
        "completion": completion,
        "tool_calls": tool_calls,
        "latency_ms": 100,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
        "error": error,
    }


def write_log_entries(workspace: Path, agent_id: str, entries: list):
    """Helper function to write log entries to a file."""
    log_dir = workspace / "logs" / "llm"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{agent_id}.jsonl"

    with open(log_file, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")


class TestLLMLogReader:
    """Test cases for LLMLogReader class."""

    def test_get_logs_empty(self, log_reader):
        """Test getting logs when no log file exists."""
        logs, total = log_reader.get_logs("nonexistent_agent")

        assert logs == []
        assert total == 0

    def test_get_logs_basic(self, temp_workspace, log_reader):
        """Test basic log retrieval."""
        entries = [
            create_log_entry(timestamp=time.time() - 100),
            create_log_entry(timestamp=time.time() - 50),
            create_log_entry(timestamp=time.time()),
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        logs, total = log_reader.get_logs("test_agent")

        assert total == 3
        assert len(logs) == 3
        # Should be sorted by timestamp descending (most recent first)
        assert logs[0]["timestamp"] >= logs[1]["timestamp"]

    def test_get_logs_pagination(self, temp_workspace, log_reader):
        """Test log pagination with limit and offset."""
        entries = [create_log_entry(timestamp=time.time() - i * 10) for i in range(10)]
        write_log_entries(temp_workspace, "test_agent", entries)

        # Get first page
        logs_page1, total = log_reader.get_logs("test_agent", limit=3, offset=0)
        assert len(logs_page1) == 3
        assert total == 10

        # Get second page
        logs_page2, _ = log_reader.get_logs("test_agent", limit=3, offset=3)
        assert len(logs_page2) == 3

        # Verify no overlap
        page1_ids = {log["log_id"] for log in logs_page1}
        page2_ids = {log["log_id"] for log in logs_page2}
        assert page1_ids.isdisjoint(page2_ids)

    def test_get_logs_max_limit(self, temp_workspace, log_reader):
        """Test that limit is capped at 200."""
        entries = [create_log_entry(timestamp=time.time() - i) for i in range(250)]
        write_log_entries(temp_workspace, "test_agent", entries)

        logs, total = log_reader.get_logs("test_agent", limit=500)

        assert len(logs) == 200  # Should be capped at 200
        assert total == 250

    def test_get_logs_filter_by_model(self, temp_workspace, log_reader):
        """Test filtering logs by model name."""
        entries = [
            create_log_entry(model_name="gpt-4o", timestamp=time.time() - 100),
            create_log_entry(model_name="claude-3-sonnet", timestamp=time.time() - 50),
            create_log_entry(model_name="gpt-4o", timestamp=time.time()),
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        logs, total = log_reader.get_logs("test_agent", model="gpt-4o")

        assert total == 2
        assert all(log["model_name"] == "gpt-4o" for log in logs)

    def test_get_logs_filter_by_since(self, temp_workspace, log_reader):
        """Test filtering logs by timestamp."""
        now = time.time()
        entries = [
            create_log_entry(timestamp=now - 3600),  # 1 hour ago
            create_log_entry(timestamp=now - 1800),  # 30 min ago
            create_log_entry(timestamp=now - 600),   # 10 min ago
            create_log_entry(timestamp=now),         # now
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        # Get logs from last 20 minutes
        logs, total = log_reader.get_logs("test_agent", since=now - 1200)

        assert total == 2  # Only the last two entries

    def test_get_logs_filter_by_has_error(self, temp_workspace, log_reader):
        """Test filtering logs by error status."""
        entries = [
            create_log_entry(error=None),
            create_log_entry(error="Rate limit exceeded"),
            create_log_entry(error=None),
            create_log_entry(error="Connection timeout"),
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        # Get only error logs
        error_logs, error_total = log_reader.get_logs("test_agent", has_error=True)
        assert error_total == 2
        assert all(log["error"] is not None for log in error_logs)

        # Get only successful logs
        success_logs, success_total = log_reader.get_logs("test_agent", has_error=False)
        assert success_total == 2
        assert all(log["error"] is None for log in success_logs)

    def test_get_logs_search_in_messages(self, temp_workspace, log_reader):
        """Test searching in message content."""
        entries = [
            create_log_entry(
                messages=[{"role": "user", "content": "What is Python?"}],
                completion="Python is a programming language.",
            ),
            create_log_entry(
                messages=[{"role": "user", "content": "Tell me about JavaScript"}],
                completion="JavaScript is used for web development.",
            ),
            create_log_entry(
                messages=[{"role": "user", "content": "Hello"}],
                completion="Hi there!",
            ),
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        logs, total = log_reader.get_logs("test_agent", search="python")

        assert total == 1
        # Search should be case-insensitive
        assert "Python" in logs[0]["preview"] or "python" in str(logs[0])

    def test_get_logs_search_in_completion(self, temp_workspace, log_reader):
        """Test searching in completion content."""
        entries = [
            create_log_entry(
                messages=[{"role": "user", "content": "Hi"}],
                completion="Hello, I am an AI assistant.",
            ),
            create_log_entry(
                messages=[{"role": "user", "content": "Help"}],
                completion="I can help you with various tasks.",
            ),
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        logs, total = log_reader.get_logs("test_agent", search="assistant")

        assert total == 1

    def test_get_logs_combined_filters(self, temp_workspace, log_reader):
        """Test combining multiple filters."""
        now = time.time()
        entries = [
            create_log_entry(model_name="gpt-4o", timestamp=now - 3600, error=None),
            create_log_entry(model_name="gpt-4o", timestamp=now - 100, error="Error"),
            create_log_entry(model_name="claude-3", timestamp=now - 50, error=None),
            create_log_entry(model_name="gpt-4o", timestamp=now, error=None),
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        # Filter: gpt-4o, no errors, last 30 minutes
        logs, total = log_reader.get_logs(
            "test_agent",
            model="gpt-4o",
            has_error=False,
            since=now - 1800,
        )

        assert total == 1


class TestLLMLogReaderGetEntry:
    """Test cases for get_log_entry method."""

    def test_get_log_entry_found(self, temp_workspace, log_reader):
        """Test getting a specific log entry by ID."""
        entry = create_log_entry()
        log_id = entry["log_id"]
        write_log_entries(temp_workspace, "test_agent", [entry])

        result = log_reader.get_log_entry("test_agent", log_id)

        assert result is not None
        assert result["log_id"] == log_id

    def test_get_log_entry_not_found(self, temp_workspace, log_reader):
        """Test getting a non-existent log entry."""
        entry = create_log_entry()
        write_log_entries(temp_workspace, "test_agent", [entry])

        result = log_reader.get_log_entry("test_agent", "nonexistent-id")

        assert result is None

    def test_get_log_entry_wrong_agent(self, temp_workspace, log_reader):
        """Test getting a log entry from wrong agent."""
        entry = create_log_entry()
        log_id = entry["log_id"]
        write_log_entries(temp_workspace, "test_agent", [entry])

        result = log_reader.get_log_entry("other_agent", log_id)

        assert result is None


class TestLLMLogReaderStats:
    """Test cases for get_stats method."""

    def test_get_stats_empty(self, log_reader):
        """Test getting stats when no logs exist."""
        stats = log_reader.get_stats("nonexistent_agent")

        assert stats.agent_id == "nonexistent_agent"
        assert stats.total_calls == 0
        assert stats.total_tokens == 0

    def test_get_stats_with_logs(self, temp_workspace, log_reader):
        """Test getting statistics from logs."""
        entries = [
            create_log_entry(
                model_name="gpt-4o",
                input_tokens=100,
                output_tokens=50,
                error=None,
            ),
            create_log_entry(
                model_name="gpt-4o",
                input_tokens=200,
                output_tokens=100,
                error=None,
            ),
            create_log_entry(
                model_name="claude-3",
                input_tokens=150,
                output_tokens=75,
                error="Error",
            ),
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        stats = log_reader.get_stats("test_agent")

        assert stats.total_calls == 3
        assert stats.total_input_tokens == 450  # 100 + 200 + 150
        assert stats.total_output_tokens == 225  # 50 + 100 + 75
        assert stats.total_errors == 1
        assert stats.models_used["gpt-4o"] == 2
        assert stats.models_used["claude-3"] == 1


class TestLLMLogReaderListAgents:
    """Test cases for list_agents method."""

    def test_list_agents_empty(self, log_reader):
        """Test listing agents when no logs exist."""
        agents = log_reader.list_agents()

        assert agents == []

    def test_list_agents(self, temp_workspace, log_reader):
        """Test listing all agents with logs."""
        # Create logs for multiple agents
        write_log_entries(temp_workspace, "agent_a", [create_log_entry(agent_id="agent_a")])
        write_log_entries(temp_workspace, "agent_b", [create_log_entry(agent_id="agent_b")])
        write_log_entries(temp_workspace, "agent_c", [create_log_entry(agent_id="agent_c")])

        agents = log_reader.list_agents()

        assert len(agents) == 3
        assert "agent_a" in agents
        assert "agent_b" in agents
        assert "agent_c" in agents


class TestLLMLogReaderGetModels:
    """Test cases for get_models_used method."""

    def test_get_models_used_empty(self, log_reader):
        """Test getting models when no logs exist."""
        models = log_reader.get_models_used("nonexistent_agent")

        assert models == []

    def test_get_models_used(self, temp_workspace, log_reader):
        """Test getting all models used by an agent."""
        entries = [
            create_log_entry(model_name="gpt-4o"),
            create_log_entry(model_name="gpt-4o"),
            create_log_entry(model_name="claude-3-sonnet"),
            create_log_entry(model_name="gemini-pro"),
        ]
        write_log_entries(temp_workspace, "test_agent", entries)

        models = log_reader.get_models_used("test_agent")

        assert len(models) == 3
        assert "gpt-4o" in models
        assert "claude-3-sonnet" in models
        assert "gemini-pro" in models
