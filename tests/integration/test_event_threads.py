"""
Integration tests for event threading functionality.

This module tests that get_event_threads() correctly returns event threads
after sending events. This addresses the issue reported in GitHub issue
where get_event_threads() was returning an empty dictionary.

See: https://github.com/openagents-org/openagents/issues/XXX
"""

import pytest
import asyncio

from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient
from openagents.models.event import Event, EventNames
from openagents.models.event_thread import EventThread
from openagents.models.network_config import NetworkConfig, NetworkMode, TransportConfigItem
from openagents.models.transport import TransportType


@pytest.fixture
async def test_network():
    """Create and initialize a test network with HTTP transport."""
    config = NetworkConfig(
        name="TestEventThreadNetwork",
        mode=NetworkMode.CENTRALIZED,
        host="localhost",
        port=8700,
        transports=[
            TransportConfigItem(
                type=TransportType.HTTP,
                config={"host": "localhost", "port": 8700}
            ),
            TransportConfigItem(
                type=TransportType.GRPC,
                config={"host": "localhost", "port": 8701}
            ),
        ],
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    yield network

    await network.shutdown()


@pytest.fixture
async def connected_client(test_network):
    """Create a client connected to the test network."""
    client = AgentClient(agent_id="test-thread-agent")

    connected = await client.connect(
        network_host="localhost",
        network_port=8700,
    )

    assert connected, "Client should connect successfully"

    yield client

    await client.disconnect()


@pytest.mark.asyncio
async def test_get_event_threads_returns_threads_after_send_event(connected_client):
    """
    Test that get_event_threads() returns non-empty dict after sending events.
    
    This test verifies the fix for the issue where get_event_threads() was
    returning an empty dictionary even after sending threaded events.
    """
    client = connected_client

    # Send an event with a thread_name
    event = Event(
        event_name=EventNames.AGENT_MESSAGE,
        thread_name="test-conversation-1",
        source_id=client.agent_id,
        payload={"message": "Hello, this is a test message!"},
    )

    response = await client.send_event(event)

    # Give some time for the event to be processed
    await asyncio.sleep(0.5)

    # Get event threads - this should NOT be empty
    threads = client.get_event_threads()

    # Verify threads is not empty
    assert threads, "get_event_threads() should return non-empty dict after sending events"

    # Verify our thread exists
    assert "test-conversation-1" in threads, (
        f"Thread 'test-conversation-1' should exist. Available threads: {list(threads.keys())}"
    )

    # Verify the thread contains our event
    thread = threads["test-conversation-1"]
    assert isinstance(thread, EventThread), "Thread should be an EventThread instance"
    
    events = thread.get_events()
    assert len(events) >= 1, "Thread should contain at least one event"

    # Verify the event content
    found_event = None
    for e in events:
        if e.payload.get("message") == "Hello, this is a test message!":
            found_event = e
            break

    assert found_event is not None, "Our sent event should be in the thread"


@pytest.mark.asyncio
async def test_get_event_threads_multiple_threads(connected_client):
    """
    Test that get_event_threads() correctly organizes events into multiple threads.
    """
    client = connected_client

    # Send events to different threads
    for i in range(3):
        event = Event(
            event_name=EventNames.AGENT_MESSAGE,
            thread_name=f"conversation-{i}",
            source_id=client.agent_id,
            payload={"message": f"Message in thread {i}"},
        )
        await client.send_event(event)

    await asyncio.sleep(0.5)

    threads = client.get_event_threads()

    # Verify all three threads exist
    for i in range(3):
        thread_name = f"conversation-{i}"
        assert thread_name in threads, f"Thread '{thread_name}' should exist"
        
        thread = threads[thread_name]
        events = thread.get_events()
        assert len(events) >= 1, f"Thread '{thread_name}' should have at least one event"


@pytest.mark.asyncio
async def test_get_event_threads_auto_thread_name(connected_client):
    """
    Test that events without explicit thread_name get automatically classified.
    
    When no thread_name is provided, the system should auto-generate one
    based on the event_name pattern.
    """
    client = connected_client

    # Send event without explicit thread_name
    event = Event(
        event_name=EventNames.AGENT_MESSAGE,
        source_id=client.agent_id,
        payload={"message": "Auto-threaded message"},
    )

    await client.send_event(event)
    await asyncio.sleep(0.5)

    threads = client.get_event_threads()

    # Verify at least one thread exists
    assert threads, "get_event_threads() should return non-empty dict"

    # The auto-generated thread name should be based on "agent" prefix
    # According to the code, it should be "thread:agent" for "agent.message"
    expected_thread = "thread:agent"
    assert expected_thread in threads, (
        f"Expected auto-generated thread '{expected_thread}' not found. "
        f"Available threads: {list(threads.keys())}"
    )


@pytest.mark.asyncio
async def test_event_thread_ordering(connected_client):
    """
    Test that events in a thread are properly ordered by timestamp.
    """
    client = connected_client
    thread_name = "ordered-thread"

    # Send multiple events to the same thread
    for i in range(3):
        event = Event(
            event_name=EventNames.AGENT_MESSAGE,
            thread_name=thread_name,
            source_id=client.agent_id,
            payload={"message": f"Message {i}", "order": i},
        )
        await client.send_event(event)
        await asyncio.sleep(0.1)  # Small delay to ensure different timestamps

    await asyncio.sleep(0.5)

    threads = client.get_event_threads()
    assert thread_name in threads, f"Thread '{thread_name}' should exist"

    thread = threads[thread_name]
    events = thread.get_events()

    # Verify events are ordered by timestamp
    for i in range(len(events) - 1):
        assert events[i].timestamp <= events[i + 1].timestamp, (
            f"Events should be ordered by timestamp"
        )


@pytest.mark.asyncio 
async def test_event_thread_deduplication(connected_client):
    """
    Test that the same event is not added twice to a thread (deduplication).
    """
    client = connected_client
    thread_name = "dedup-thread"

    # Create a single event
    event = Event(
        event_name=EventNames.AGENT_MESSAGE,
        thread_name=thread_name,
        source_id=client.agent_id,
        payload={"message": "Unique message"},
    )

    # Send the same event twice
    await client.send_event(event)
    
    # Manually try to add the same event again to test deduplication
    threads = client.get_event_threads()
    if thread_name in threads:
        threads[thread_name].add_event(event)

    await asyncio.sleep(0.5)

    threads = client.get_event_threads()
    assert thread_name in threads

    thread = threads[thread_name]
    events = thread.get_events()

    # Count events with the same event_id
    event_ids = [e.event_id for e in events]
    assert event_ids.count(event.event_id) == 1, (
        f"Event should only appear once due to deduplication. "
        f"Found {event_ids.count(event.event_id)} occurrences."
    )
