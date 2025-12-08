"""
Test cases for the LLM Logs HTTP API endpoints.

This module contains tests for the LLM logs API,
including access control and endpoint functionality.
"""

import json
import os
import pytest
import tempfile
import time
import uuid
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch
from aiohttp import web
from aiohttp.test_utils import AioHTTPTestCase, unittest_run_loop

from openagents.core.transports.http import HttpTransport
from openagents.core.workspace_manager import WorkspaceManager


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


def write_log_entries(workspace_path: Path, agent_id: str, entries: list):
    """Helper function to write log entries to a file."""
    log_dir = workspace_path / "logs" / "llm"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{agent_id}.jsonl"

    with open(log_file, "w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry) + "\n")


class TestLLMLogsAPI(AioHTTPTestCase):
    """Test cases for LLM Logs HTTP API."""

    async def get_application(self):
        """Create the aiohttp application for testing."""
        self.temp_dir = tempfile.mkdtemp()
        self.workspace_path = Path(self.temp_dir)

        # Create workspace manager
        self.workspace_manager = WorkspaceManager(self.workspace_path)
        self.workspace_manager.initialize_workspace()

        # Create HTTP transport with workspace path
        self.http_transport = HttpTransport(workspace_path=str(self.workspace_path))

        return self.http_transport.app

    async def tearDownAsync(self):
        """Clean up after tests."""
        import shutil
        if hasattr(self, 'temp_dir') and os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)

    @unittest_run_loop
    async def test_get_llm_logs_empty(self):
        """Test getting logs when no logs exist."""
        resp = await self.client.request("GET", "/api/agents/service/test_agent/llm-logs")

        assert resp.status == 200
        data = await resp.json()
        assert data["agent_id"] == "test_agent"
        assert data["logs"] == []
        assert data["total_count"] == 0

    @unittest_run_loop
    async def test_get_llm_logs_with_entries(self):
        """Test getting logs with existing entries."""
        entries = [
            create_log_entry(timestamp=time.time() - 100),
            create_log_entry(timestamp=time.time() - 50),
            create_log_entry(timestamp=time.time()),
        ]
        write_log_entries(self.workspace_path, "test_agent", entries)

        resp = await self.client.request("GET", "/api/agents/service/test_agent/llm-logs")

        assert resp.status == 200
        data = await resp.json()
        assert data["agent_id"] == "test_agent"
        assert len(data["logs"]) == 3
        assert data["total_count"] == 3

    @unittest_run_loop
    async def test_get_llm_logs_pagination(self):
        """Test pagination of logs."""
        entries = [create_log_entry(timestamp=time.time() - i * 10) for i in range(10)]
        write_log_entries(self.workspace_path, "test_agent", entries)

        # Get first page
        resp = await self.client.request(
            "GET", "/api/agents/service/test_agent/llm-logs?limit=3&offset=0"
        )
        assert resp.status == 200
        data = await resp.json()
        assert len(data["logs"]) == 3
        assert data["total_count"] == 10
        assert data["has_more"] is True

        # Get second page
        resp = await self.client.request(
            "GET", "/api/agents/service/test_agent/llm-logs?limit=3&offset=3"
        )
        assert resp.status == 200
        data = await resp.json()
        assert len(data["logs"]) == 3
        assert data["has_more"] is True

    @unittest_run_loop
    async def test_get_llm_logs_filter_by_model(self):
        """Test filtering logs by model."""
        entries = [
            create_log_entry(model_name="gpt-4o"),
            create_log_entry(model_name="claude-3"),
            create_log_entry(model_name="gpt-4o"),
        ]
        write_log_entries(self.workspace_path, "test_agent", entries)

        resp = await self.client.request(
            "GET", "/api/agents/service/test_agent/llm-logs?model=gpt-4o"
        )

        assert resp.status == 200
        data = await resp.json()
        assert data["total_count"] == 2
        assert all(log["model_name"] == "gpt-4o" for log in data["logs"])

    @unittest_run_loop
    async def test_get_llm_logs_filter_by_error(self):
        """Test filtering logs by error status."""
        entries = [
            create_log_entry(error=None),
            create_log_entry(error="Error occurred"),
            create_log_entry(error=None),
        ]
        write_log_entries(self.workspace_path, "test_agent", entries)

        # Get only error logs
        resp = await self.client.request(
            "GET", "/api/agents/service/test_agent/llm-logs?has_error=true"
        )
        assert resp.status == 200
        data = await resp.json()
        assert data["total_count"] == 1

        # Get only successful logs
        resp = await self.client.request(
            "GET", "/api/agents/service/test_agent/llm-logs?has_error=false"
        )
        assert resp.status == 200
        data = await resp.json()
        assert data["total_count"] == 2

    @unittest_run_loop
    async def test_get_llm_logs_search(self):
        """Test searching in logs."""
        entries = [
            create_log_entry(
                messages=[{"role": "user", "content": "Tell me about Python"}]
            ),
            create_log_entry(
                messages=[{"role": "user", "content": "What is JavaScript?"}]
            ),
        ]
        write_log_entries(self.workspace_path, "test_agent", entries)

        resp = await self.client.request(
            "GET", "/api/agents/service/test_agent/llm-logs?search=python"
        )

        assert resp.status == 200
        data = await resp.json()
        assert data["total_count"] == 1

    @unittest_run_loop
    async def test_get_llm_log_entry(self):
        """Test getting a specific log entry."""
        entry = create_log_entry()
        log_id = entry["log_id"]
        write_log_entries(self.workspace_path, "test_agent", [entry])

        resp = await self.client.request(
            "GET", f"/api/agents/service/test_agent/llm-logs/{log_id}"
        )

        assert resp.status == 200
        data = await resp.json()
        assert data["log_id"] == log_id
        assert data["model_name"] == entry["model_name"]

    @unittest_run_loop
    async def test_get_llm_log_entry_not_found(self):
        """Test getting a non-existent log entry."""
        entry = create_log_entry()
        write_log_entries(self.workspace_path, "test_agent", [entry])

        resp = await self.client.request(
            "GET", "/api/agents/service/test_agent/llm-logs/nonexistent-id"
        )

        assert resp.status == 404
        data = await resp.json()
        assert data["success"] is False
        assert "not found" in data["error"].lower()


class TestLLMLogsAPINoWorkspace:
    """Test cases for LLM Logs API when workspace is not configured."""

    @pytest.fixture
    def http_transport(self):
        """Create HTTP transport without workspace path."""
        return HttpTransport()

    @pytest.mark.asyncio
    async def test_get_llm_logs_no_workspace(self, http_transport):
        """Test that API returns error when workspace is not configured."""
        # Create a mock request
        request = MagicMock()
        request.match_info.get = MagicMock(return_value="test_agent")
        request.query = {}

        response = await http_transport.get_llm_logs(request)

        assert response.status == 500
        data = json.loads(response.body)
        assert data["success"] is False
        assert "Workspace not configured" in data["error"]

    @pytest.mark.asyncio
    async def test_get_llm_log_entry_no_workspace(self, http_transport):
        """Test that API returns error when workspace is not configured."""
        request = MagicMock()
        request.match_info.get = MagicMock(side_effect=lambda k: "test_agent" if k == "agent_id" else "log-123")

        response = await http_transport.get_llm_log_entry(request)

        assert response.status == 500
        data = json.loads(response.body)
        assert data["success"] is False
        assert "Workspace not configured" in data["error"]
