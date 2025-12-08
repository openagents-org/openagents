"""
Test cases for source_agent_group field in Event.

This module contains tests to verify that the source_agent_group field is
correctly populated by the network gateway for agent sources and remains
None for mod and system sources.
"""

import pytest
import asyncio

from openagents.core.network import AgentNetwork
from openagents.models.network_config import NetworkConfig, AgentGroupConfig, NetworkMode
from openagents.models.transport import TransportType
from openagents.models.event import Event

# Predefined password hashes for testing
DEVELOPERS_HASH = "dev_hash_12345"
TESTERS_HASH = "test_hash_67890"


@pytest.fixture
async def network_with_groups():
    """Create a test network with agent groups configured."""
    from openagents.models.network_config import TransportConfigItem
    
    config = NetworkConfig(
        name="SourceAgentGroupTestNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        transports=[
            TransportConfigItem(
                type=TransportType.HTTP,
                config={"port": 8702}  # Use different port to avoid conflicts
            )
        ],
        agent_groups={
            "developers": AgentGroupConfig(
                password_hash=DEVELOPERS_HASH,
                description="Development team agents",
                metadata={
                    "permissions": ["code_review", "deployment"],
                },
            ),
            "testers": AgentGroupConfig(
                password_hash=TESTERS_HASH,
                description="QA team agents",
                metadata={
                    "permissions": ["test_execution", "bug_reporting"],
                },
            ),
        },
    )

    network = AgentNetwork.create_from_config(config)
    await network.initialize()

    yield network

    # Cleanup
    await network.shutdown()


@pytest.mark.asyncio
async def test_source_agent_group_populated_for_agent(network_with_groups):
    """Test that source_agent_group is populated for agent sources."""
    network = network_with_groups

    # Register an agent in the developers group
    response = await network.register_agent(
        agent_id="dev-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Developer Agent 1"},
        certificate=None,
        force_reconnect=False,
        password_hash=DEVELOPERS_HASH,
    )
    assert response.success, f"Registration failed: {response.message}"

    # Verify agent was assigned to developers group
    group = network.topology.agent_group_membership.get("dev-agent-1")
    assert group == "developers", f"Expected 'developers', got '{group}'"

    # Register another agent to receive the event
    response = await network.register_agent(
        agent_id="receiver-agent",
        transport_type=TransportType.HTTP,
        metadata={"name": "Receiver Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=TESTERS_HASH,
    )
    assert response.success

    # Create event from the developer agent
    event = Event(
        event_name="agent.message",
        source_id="agent:dev-agent-1",
        destination_id="agent:receiver-agent",
        payload={"content": "Hello from developer"}
    )

    # Process the event through the gateway
    response = await network.event_gateway.process_event(event, enable_delivery=True)
    assert response.success, f"Event processing failed: {response.message}"

    # Verify that source_agent_group was populated
    assert event.source_agent_group == "developers", \
        f"Expected source_agent_group='developers', got '{event.source_agent_group}'"

    # Give a moment for async delivery
    await asyncio.sleep(0.1)

    # Verify the receiver got the event with source_agent_group populated
    events = await network.event_gateway.poll_events("receiver-agent")
    assert len(events) == 1, f"Expected 1 event, got {len(events)}"
    received_event = events[0]
    assert received_event.source_agent_group == "developers", \
        f"Expected received event source_agent_group='developers', got '{received_event.source_agent_group}'"


@pytest.mark.asyncio
async def test_source_agent_group_populated_without_agent_prefix(network_with_groups):
    """Test that source_agent_group is populated when source_id doesn't have 'agent:' prefix."""
    network = network_with_groups

    # Register an agent in the testers group
    response = await network.register_agent(
        agent_id="qa-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "QA Agent 1"},
        certificate=None,
        force_reconnect=False,
        password_hash=TESTERS_HASH,
    )
    assert response.success

    # Register receiver agent
    response = await network.register_agent(
        agent_id="receiver-agent",
        transport_type=TransportType.HTTP,
        metadata={"name": "Receiver Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=DEVELOPERS_HASH,
    )
    assert response.success

    # Create event with source_id without "agent:" prefix
    event = Event(
        event_name="test.notification",
        source_id="qa-agent-1",  # No "agent:" prefix
        destination_id="agent:receiver-agent",
        payload={"message": "Test notification"}
    )

    # Process the event
    response = await network.event_gateway.process_event(event, enable_delivery=True)
    assert response.success

    # Verify that source_agent_group was populated correctly
    assert event.source_agent_group == "testers", \
        f"Expected source_agent_group='testers', got '{event.source_agent_group}'"


@pytest.mark.asyncio
async def test_source_agent_group_null_for_mod_source(network_with_groups):
    """Test that source_agent_group is None for mod sources."""
    network = network_with_groups

    # Register an agent to receive the event
    response = await network.register_agent(
        agent_id="receiver-agent",
        transport_type=TransportType.HTTP,
        metadata={"name": "Receiver Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=DEVELOPERS_HASH,
    )
    assert response.success

    # Create event from a mod source
    event = Event(
        event_name="task.notification.completed",
        source_id="mod:openagents.mods.coordination.task_delegation",
        destination_id="agent:receiver-agent",
        payload={"task_id": "task-123"}
    )

    # Process the event
    response = await network.event_gateway.process_event(event, enable_delivery=True)
    assert response.success

    # Verify that source_agent_group is None
    assert event.source_agent_group is None, \
        f"Expected source_agent_group=None for mod source, got '{event.source_agent_group}'"

    # Give a moment for async delivery
    await asyncio.sleep(0.1)

    # Verify the receiver got the event with source_agent_group as None
    events = await network.event_gateway.poll_events("receiver-agent")
    assert len(events) == 1
    received_event = events[0]
    assert received_event.source_agent_group is None, \
        f"Expected received event source_agent_group=None, got '{received_event.source_agent_group}'"


@pytest.mark.asyncio
async def test_source_agent_group_null_for_system_source(network_with_groups):
    """Test that source_agent_group is None for system sources."""
    network = network_with_groups

    # Create event from a system source
    # Note: System events are typically handled internally and not delivered to agents,
    # so we just verify that the field is properly set during processing
    event = Event(
        event_name="system.notification.test",
        source_id="system:system",
        destination_id="agent:receiver-agent",
        payload={}
    )

    # Process the event (with delivery disabled since system events may not be delivered)
    response = await network.event_gateway.process_event(event, enable_delivery=False)
    assert response.success

    # Verify that source_agent_group is None
    assert event.source_agent_group is None, \
        f"Expected source_agent_group=None for system source, got '{event.source_agent_group}'"


@pytest.mark.asyncio
async def test_source_agent_group_null_for_unregistered_agent(network_with_groups):
    """Test that source_agent_group is None for agents not in topology."""
    network = network_with_groups

    # Register an agent to receive the event
    response = await network.register_agent(
        agent_id="receiver-agent",
        transport_type=TransportType.HTTP,
        metadata={"name": "Receiver Agent"},
        certificate=None,
        force_reconnect=False,
        password_hash=DEVELOPERS_HASH,
    )
    assert response.success

    # Create event from an agent that is not registered
    event = Event(
        event_name="agent.message",
        source_id="agent:unknown-agent",
        destination_id="agent:receiver-agent",
        payload={"content": "Hello from unknown agent"}
    )

    # Process the event
    response = await network.event_gateway.process_event(event, enable_delivery=True)
    assert response.success

    # Verify that source_agent_group is None (agent not found in topology)
    assert event.source_agent_group is None, \
        f"Expected source_agent_group=None for unregistered agent, got '{event.source_agent_group}'"


@pytest.mark.asyncio
async def test_event_serialization_includes_source_agent_group(network_with_groups):
    """Test that event serialization includes source_agent_group field."""
    network = network_with_groups

    # Register an agent
    response = await network.register_agent(
        agent_id="dev-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Developer Agent 1"},
        certificate=None,
        force_reconnect=False,
        password_hash=DEVELOPERS_HASH,
    )
    assert response.success

    # Create and process event
    event = Event(
        event_name="agent.message",
        source_id="agent:dev-agent-1",
        destination_id="agent:receiver",
        payload={"content": "Test message"}
    )

    # Process the event
    await network.event_gateway.process_event(event, enable_delivery=False)

    # Serialize the event
    event_dict = event.to_dict()

    # Verify source_agent_group is in the serialized data
    assert "source_agent_group" in event_dict, \
        "source_agent_group field missing from serialized event"
    assert event_dict["source_agent_group"] == "developers", \
        f"Expected serialized source_agent_group='developers', got '{event_dict['source_agent_group']}'"

    # Test deserialization
    restored_event = Event.from_dict(event_dict)
    assert restored_event.source_agent_group == "developers", \
        f"Expected deserialized source_agent_group='developers', got '{restored_event.source_agent_group}'"


@pytest.mark.asyncio
async def test_backward_compatibility_without_source_agent_group(network_with_groups):
    """Test that events without source_agent_group field still work (backward compatibility)."""
    
    # Create an event without source_agent_group (simulating old code)
    event_dict = {
        "event_name": "agent.message",
        "source_id": "agent:test-agent",
        "destination_id": "agent:receiver",
        "payload": {"content": "Test message"}
    }

    # Should be able to create event from dict without source_agent_group
    event = Event.from_dict(event_dict)
    
    # source_agent_group should default to None
    assert event.source_agent_group is None, \
        f"Expected source_agent_group=None by default, got '{event.source_agent_group}'"

    # Event should be valid
    assert event.event_name == "agent.message"
    assert event.source_id == "agent:test-agent"


@pytest.mark.asyncio
async def test_source_agent_group_for_broadcast_event(network_with_groups):
    """Test that source_agent_group is populated for broadcast events."""
    network = network_with_groups

    # Register agents in different groups
    response = await network.register_agent(
        agent_id="dev-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Developer Agent 1"},
        certificate=None,
        force_reconnect=False,
        password_hash=DEVELOPERS_HASH,
    )
    assert response.success

    response = await network.register_agent(
        agent_id="qa-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "QA Agent 1"},
        certificate=None,
        force_reconnect=False,
        password_hash=TESTERS_HASH,
    )
    assert response.success

    # Create broadcast event from developer agent
    event = Event(
        event_name="announcement.broadcast",
        source_id="agent:dev-agent-1",
        destination_id="agent:broadcast",
        payload={"message": "System maintenance in 1 hour"}
    )

    # Process the event
    response = await network.event_gateway.process_event(event, enable_delivery=True)
    assert response.success

    # Verify that source_agent_group was populated
    assert event.source_agent_group == "developers", \
        f"Expected source_agent_group='developers', got '{event.source_agent_group}'"

    # Give a moment for async delivery
    await asyncio.sleep(0.1)

    # Verify both agents received the event with correct source_agent_group
    # (dev-agent-1 should not receive its own broadcast)
    qa_events = await network.event_gateway.poll_events("qa-agent-1")
    assert len(qa_events) == 1
    assert qa_events[0].source_agent_group == "developers"
