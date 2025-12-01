"""
Test cases for the LLM Call Logger.

This module contains tests for the LLM logging functionality,
including logging calls, log rotation, and cleanup.
"""

import json
import os
import pytest
import tempfile
import time
from pathlib import Path

from openagents.lms.llm_logger import LLMCallLogger, extract_token_usage
from openagents.models.llm_log import LLMLogEntry


@pytest.fixture
def temp_workspace():
    """Create a temporary workspace directory for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def llm_logger(temp_workspace):
    """Create an LLM logger instance for testing."""
    return LLMCallLogger(temp_workspace, "test_agent")


class TestLLMCallLogger:
    """Test cases for LLMCallLogger class."""

    @pytest.mark.asyncio
    async def test_log_call_creates_log_file(self, llm_logger, temp_workspace):
        """Test that log_call creates the log file and directory."""
        response = {
            "content": "Hello, world!",
            "tool_calls": [],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 5,
                "total_tokens": 15,
            },
        }

        log_id = await llm_logger.log_call(
            model_name="gpt-4o",
            provider="openai",
            messages=[{"role": "user", "content": "Hi"}],
            tools=None,
            response=response,
            latency_ms=100,
        )

        # Verify log file was created
        log_file = temp_workspace / "logs" / "llm" / "test_agent.jsonl"
        assert log_file.exists()
        assert log_id is not None

    @pytest.mark.asyncio
    async def test_log_call_writes_correct_data(self, llm_logger, temp_workspace):
        """Test that log_call writes correct data to the log file."""
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What is 2+2?"},
        ]
        response = {
            "content": "The answer is 4.",
            "tool_calls": [],
            "usage": {
                "prompt_tokens": 20,
                "completion_tokens": 10,
                "total_tokens": 30,
            },
        }

        await llm_logger.log_call(
            model_name="gpt-4o",
            provider="openai",
            messages=messages,
            tools=None,
            response=response,
            latency_ms=250,
        )

        # Read and verify log entry
        log_file = temp_workspace / "logs" / "llm" / "test_agent.jsonl"
        with open(log_file, "r", encoding="utf-8") as f:
            entry_data = json.loads(f.readline())

        assert entry_data["agent_id"] == "test_agent"
        assert entry_data["model_name"] == "gpt-4o"
        assert entry_data["provider"] == "openai"
        assert entry_data["messages"] == messages
        assert entry_data["completion"] == "The answer is 4."
        assert entry_data["latency_ms"] == 250
        assert entry_data["input_tokens"] == 20
        assert entry_data["output_tokens"] == 10
        assert entry_data["total_tokens"] == 30
        assert entry_data["error"] is None

    @pytest.mark.asyncio
    async def test_log_call_with_error(self, llm_logger, temp_workspace):
        """Test that log_call correctly logs errors."""
        response = {"content": "", "tool_calls": []}

        await llm_logger.log_call(
            model_name="gpt-4o",
            provider="openai",
            messages=[{"role": "user", "content": "Hi"}],
            tools=None,
            response=response,
            latency_ms=500,
            error="Rate limit exceeded",
        )

        # Read and verify log entry
        log_file = temp_workspace / "logs" / "llm" / "test_agent.jsonl"
        with open(log_file, "r", encoding="utf-8") as f:
            entry_data = json.loads(f.readline())

        assert entry_data["error"] == "Rate limit exceeded"

    @pytest.mark.asyncio
    async def test_log_call_with_tool_calls(self, llm_logger, temp_workspace):
        """Test that log_call correctly logs tool calls."""
        tools = [
            {
                "name": "get_weather",
                "description": "Get weather for a location",
                "parameters": {"type": "object", "properties": {}},
            }
        ]
        response = {
            "content": "I'll check the weather for you.",
            "tool_calls": [
                {
                    "id": "call_123",
                    "name": "get_weather",
                    "arguments": '{"location": "San Francisco"}',
                }
            ],
            "usage": {
                "prompt_tokens": 50,
                "completion_tokens": 20,
                "total_tokens": 70,
            },
        }

        await llm_logger.log_call(
            model_name="gpt-4o",
            provider="openai",
            messages=[{"role": "user", "content": "What's the weather?"}],
            tools=tools,
            response=response,
            latency_ms=300,
        )

        # Read and verify log entry
        log_file = temp_workspace / "logs" / "llm" / "test_agent.jsonl"
        with open(log_file, "r", encoding="utf-8") as f:
            entry_data = json.loads(f.readline())

        assert entry_data["tools"] == tools
        assert len(entry_data["tool_calls"]) == 1
        assert entry_data["tool_calls"][0]["name"] == "get_weather"

    @pytest.mark.asyncio
    async def test_multiple_log_entries(self, llm_logger, temp_workspace):
        """Test logging multiple entries to the same file."""
        for i in range(5):
            response = {
                "content": f"Response {i}",
                "tool_calls": [],
                "usage": {"prompt_tokens": i * 10, "completion_tokens": i * 5, "total_tokens": i * 15},
            }
            await llm_logger.log_call(
                model_name="gpt-4o",
                provider="openai",
                messages=[{"role": "user", "content": f"Message {i}"}],
                tools=None,
                response=response,
                latency_ms=100 + i * 50,
            )

        # Read and count entries
        log_file = temp_workspace / "logs" / "llm" / "test_agent.jsonl"
        with open(log_file, "r", encoding="utf-8") as f:
            entries = [json.loads(line) for line in f]

        assert len(entries) == 5


class TestExtractTokenUsage:
    """Test cases for extract_token_usage function."""

    def test_extract_openai_usage(self):
        """Test extracting token usage from OpenAI response."""
        # Create a mock response object
        class MockUsage:
            prompt_tokens = 100
            completion_tokens = 50
            total_tokens = 150

        class MockResponse:
            usage = MockUsage()

        result = extract_token_usage("openai", MockResponse())

        assert result["input_tokens"] == 100
        assert result["output_tokens"] == 50
        assert result["total_tokens"] == 150

    def test_extract_anthropic_usage(self):
        """Test extracting token usage from Anthropic response."""
        class MockUsage:
            input_tokens = 80
            output_tokens = 40

        class MockResponse:
            usage = MockUsage()

        result = extract_token_usage("anthropic", MockResponse())

        assert result["input_tokens"] == 80
        assert result["output_tokens"] == 40
        assert result["total_tokens"] == 120

    def test_extract_bedrock_usage(self):
        """Test extracting token usage from Bedrock response."""
        response = {
            "usage": {
                "input_tokens": 60,
                "output_tokens": 30,
            }
        }

        result = extract_token_usage("bedrock", response)

        assert result["input_tokens"] == 60
        assert result["output_tokens"] == 30
        assert result["total_tokens"] == 90

    def test_extract_usage_no_usage_data(self):
        """Test extracting token usage when no usage data is available."""
        class MockResponse:
            pass

        result = extract_token_usage("openai", MockResponse())

        assert result["input_tokens"] is None
        assert result["output_tokens"] is None
        assert result["total_tokens"] is None

    def test_extract_unknown_provider(self):
        """Test extracting token usage from unknown provider."""
        class MockResponse:
            pass

        result = extract_token_usage("unknown_provider", MockResponse())

        assert result["input_tokens"] is None
        assert result["output_tokens"] is None
        assert result["total_tokens"] is None


class TestLLMLogEntry:
    """Test cases for LLMLogEntry data model."""

    def test_to_dict(self):
        """Test converting LLMLogEntry to dictionary."""
        entry = LLMLogEntry(
            log_id="test-123",
            agent_id="test_agent",
            timestamp=1234567890.123,
            model_name="gpt-4o",
            provider="openai",
            messages=[{"role": "user", "content": "Hi"}],
            completion="Hello!",
            latency_ms=100,
        )

        data = entry.to_dict()

        assert data["log_id"] == "test-123"
        assert data["agent_id"] == "test_agent"
        assert data["model_name"] == "gpt-4o"

    def test_to_json_and_from_json(self):
        """Test JSON serialization and deserialization."""
        entry = LLMLogEntry(
            log_id="test-456",
            agent_id="test_agent",
            timestamp=1234567890.456,
            model_name="claude-3-sonnet",
            provider="anthropic",
            messages=[{"role": "user", "content": "Hello"}],
            completion="Hi there!",
            latency_ms=200,
            input_tokens=10,
            output_tokens=5,
            total_tokens=15,
        )

        json_str = entry.to_json()
        restored = LLMLogEntry.from_json(json_str)

        assert restored.log_id == entry.log_id
        assert restored.agent_id == entry.agent_id
        assert restored.model_name == entry.model_name
        assert restored.completion == entry.completion

    def test_to_summary(self):
        """Test converting LLMLogEntry to summary."""
        entry = LLMLogEntry(
            log_id="test-789",
            agent_id="test_agent",
            timestamp=1234567890.789,
            model_name="gpt-4o",
            provider="openai",
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": "What is Python?"},
            ],
            completion="Python is a programming language.",
            latency_ms=300,
            input_tokens=20,
            output_tokens=10,
            total_tokens=30,
            tool_calls=[{"id": "call_1", "name": "search", "arguments": "{}"}],
        )

        summary = entry.to_summary()

        assert summary["log_id"] == "test-789"
        assert summary["model_name"] == "gpt-4o"
        assert summary["latency_ms"] == 300
        assert summary["has_tool_calls"] is True
        assert "preview" in summary
