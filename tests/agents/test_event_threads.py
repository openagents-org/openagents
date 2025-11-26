"""
Test cases for event threading functionality in AgentClient.

This module contains tests for the get_event_threads() method and related
functionality to ensure events are properly tracked in local threads.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from openagents.core.client import AgentClient
from openagents.models.event import Event
from openagents.models.event_thread import EventThread
from openagents.models.event_response import EventResponse


class TestEventThreads:
    """Tests for event threading functionality."""

    def test_get_event_threads_initially_empty(self):
        """Test that get_event_threads() returns empty dict initially."""
        client = AgentClient(agent_id="test_agent")
        threads = client.get_event_threads()
        assert threads == {}
        assert isinstance(threads, dict)

    def test_add_event_to_thread_creates_thread(self):
        """Test that _add_event_to_thread creates a new thread if it doesn't exist."""
        client = AgentClient(agent_id="test_agent")
        
        event = Event(
            event_name="agent.message",
            source_id="test_agent",
            thread_name="test-conversation-1",
            payload={"message": "Hello"}
        )
        
        client._add_event_to_thread(event)
        
        threads = client.get_event_threads()
        assert "test-conversation-1" in threads
        assert len(threads["test-conversation-1"].events) == 1
        assert threads["test-conversation-1"].events[0].event_id == event.event_id

    def test_add_event_to_thread_auto_generates_thread_name(self):
        """Test that _add_event_to_thread auto-generates thread name from event_name."""
        client = AgentClient(agent_id="test_agent")
        
        event = Event(
            event_name="project.run.completed",
            source_id="test_agent",
            payload={"result": "success"}
        )
        # thread_name is None, should be auto-generated
        assert event.thread_name is None
        
        client._add_event_to_thread(event)
        
        threads = client.get_event_threads()
        # Thread name should be generated from event_name: "thread:project.run"
        expected_thread_name = "thread:project.run"
        assert expected_thread_name in threads
        assert len(threads[expected_thread_name].events) == 1
        # The event's thread_name should now be set
        assert event.thread_name == expected_thread_name

    def test_add_multiple_events_to_same_thread(self):
        """Test that multiple events are correctly added to the same thread."""
        client = AgentClient(agent_id="test_agent")
        
        thread_name = "multi-message-thread"
        events = []
        for i in range(3):
            event = Event(
                event_name="agent.message",
                source_id="test_agent",
                thread_name=thread_name,
                payload={"message": f"Message {i+1}"}
            )
            events.append(event)
            client._add_event_to_thread(event)
        
        threads = client.get_event_threads()
        assert thread_name in threads
        assert len(threads[thread_name].events) == 3
        
        # Verify all events are in the thread
        thread_event_ids = [e.event_id for e in threads[thread_name].events]
        for event in events:
            assert event.event_id in thread_event_ids

    def test_add_events_to_different_threads(self):
        """Test that events with different thread_names go to separate threads."""
        client = AgentClient(agent_id="test_agent")
        
        event1 = Event(
            event_name="agent.message",
            source_id="test_agent",
            thread_name="thread-alpha",
            payload={"message": "Alpha message"}
        )
        event2 = Event(
            event_name="agent.message",
            source_id="test_agent",
            thread_name="thread-beta",
            payload={"message": "Beta message"}
        )
        
        client._add_event_to_thread(event1)
        client._add_event_to_thread(event2)
        
        threads = client.get_event_threads()
        assert len(threads) == 2
        assert "thread-alpha" in threads
        assert "thread-beta" in threads
        assert len(threads["thread-alpha"].events) == 1
        assert len(threads["thread-beta"].events) == 1


class TestSendEventThreading:
    """Tests for event threading when sending events."""

    @pytest.mark.asyncio
    async def test_send_event_adds_to_threads(self):
        """Test that send_event() adds sent events to local threads."""
        client = AgentClient(agent_id="test_agent")
        
        # Mock the connector
        mock_connector = MagicMock()
        mock_connector.is_connected = True
        mock_connector.send_event = AsyncMock(return_value=EventResponse(
            success=True,
            message="Event sent successfully"
        ))
        client.connector = mock_connector
        
        event = Event(
            event_name="agent.message",
            source_id="test_agent",
            destination_id="other_agent",
            thread_name="test-conversation-1",
            payload={"message": "Hello from test"}
        )
        
        result = await client.send_event(event)
        
        # Verify the event was sent
        assert result is not None
        assert result.success is True
        
        # Verify the event was added to threads
        threads = client.get_event_threads()
        assert "test-conversation-1" in threads
        assert len(threads["test-conversation-1"].events) == 1
        assert threads["test-conversation-1"].events[0].event_id == event.event_id

    @pytest.mark.asyncio
    async def test_send_multiple_events_same_thread(self):
        """Test that sending multiple events with same thread_name groups them correctly."""
        client = AgentClient(agent_id="test_agent")
        
        # Mock the connector
        mock_connector = MagicMock()
        mock_connector.is_connected = True
        mock_connector.send_event = AsyncMock(return_value=EventResponse(
            success=True,
            message="Event sent successfully"
        ))
        client.connector = mock_connector
        
        thread_name = "test-conversation-1"
        sent_event_ids = []
        
        for i in range(3):
            event = Event(
                event_name="agent.message",
                source_id="test_agent",
                destination_id="other_agent",
                thread_name=thread_name,
                payload={"message": f"Message {i+1}"}
            )
            sent_event_ids.append(event.event_id)
            await client.send_event(event)
        
        # Verify all events are in the same thread
        threads = client.get_event_threads()
        assert thread_name in threads
        assert len(threads[thread_name].events) == 3
        
        thread_event_ids = [e.event_id for e in threads[thread_name].events]
        for event_id in sent_event_ids:
            assert event_id in thread_event_ids

    @pytest.mark.asyncio
    async def test_send_event_auto_generates_thread_name(self):
        """Test that send_event() auto-generates thread name when not provided."""
        client = AgentClient(agent_id="test_agent")
        
        # Mock the connector
        mock_connector = MagicMock()
        mock_connector.is_connected = True
        mock_connector.send_event = AsyncMock(return_value=EventResponse(
            success=True,
            message="Event sent successfully"
        ))
        client.connector = mock_connector
        
        event = Event(
            event_name="project.run.completed",
            source_id="test_agent",
            payload={"status": "completed"}
        )
        # thread_name should be None
        assert event.thread_name is None
        
        await client.send_event(event)
        
        threads = client.get_event_threads()
        expected_thread_name = "thread:project.run"
        assert expected_thread_name in threads
        assert len(threads[expected_thread_name].events) == 1


class TestHandleEventThreading:
    """Tests for event threading when handling incoming events."""

    @pytest.mark.asyncio
    async def test_handle_event_adds_to_threads(self):
        """Test that _handle_event() adds received events to local threads."""
        client = AgentClient(agent_id="test_agent")
        
        event = Event(
            event_name="agent.message",
            source_id="other_agent",
            destination_id="test_agent",
            thread_name="incoming-thread",
            payload={"message": "Hello from other agent"}
        )
        
        await client._handle_event(event)
        
        threads = client.get_event_threads()
        assert "incoming-thread" in threads
        assert len(threads["incoming-thread"].events) == 1
        assert threads["incoming-thread"].events[0].event_id == event.event_id

    @pytest.mark.asyncio
    async def test_handle_event_auto_generates_thread_name(self):
        """Test that _handle_event() auto-generates thread name when not provided."""
        client = AgentClient(agent_id="test_agent")
        
        event = Event(
            event_name="channel.message.posted",
            source_id="other_agent",
            payload={"text": "Channel message"}
        )
        assert event.thread_name is None
        
        await client._handle_event(event)
        
        threads = client.get_event_threads()
        expected_thread_name = "thread:channel.message"
        assert expected_thread_name in threads
        assert len(threads[expected_thread_name].events) == 1


class TestEventCaching:
    """Tests for event caching functionality."""

    def test_get_cached_event(self):
        """Test that events are cached and retrievable by ID."""
        client = AgentClient(agent_id="test_agent")
        
        event = Event(
            event_name="agent.message",
            source_id="test_agent",
            thread_name="cache-test",
            payload={"message": "Cached message"}
        )
        
        # Manually add to event cache and thread
        client._event_id_map[event.event_id] = event
        client._add_event_to_thread(event)
        
        # Verify we can retrieve by ID
        cached = client.get_cached_event(event.event_id)
        assert cached is not None
        assert cached.event_id == event.event_id
        assert cached.payload == event.payload

    def test_get_cached_event_not_found(self):
        """Test that get_cached_event returns None for unknown event ID."""
        client = AgentClient(agent_id="test_agent")
        
        cached = client.get_cached_event("non-existent-id")
        assert cached is None
