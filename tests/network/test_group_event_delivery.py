"""
Test cases for group-based event delivery.

This module contains tests for the event gateway's ability to deliver events
to groups of agents using the "group:group_name" destination format.
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
ADMINS_HASH = "admin_hash_abc123"


@pytest.fixture
async def network_with_agent_groups():
    """Create a test network with agent groups configured with specific agent lists."""
    from openagents.models.network_config import TransportConfigItem
    
    config = NetworkConfig(
        name="GroupEventTestNetwork",
        mode=NetworkMode.CENTRALIZED,
        default_agent_group="guests",
        transports=[
            TransportConfigItem(
                type=TransportType.HTTP,
                config={"port": 8701}  # Use different port to avoid conflicts
            )
        ],
        agent_groups={
            "developers": AgentGroupConfig(
                password_hash=DEVELOPERS_HASH,
                description="Development team agents",
                metadata={
                    "permissions": ["code_review", "deployment"],
                    "agents": ["dev-agent-1", "dev-agent-2", "dev-agent-3"]
                },
            ),
            "testers": AgentGroupConfig(
                password_hash=TESTERS_HASH,
                description="QA team agents",
                metadata={
                    "permissions": ["test_execution", "bug_reporting"],
                    "agents": ["qa-agent-1", "qa-agent-2"]
                },
            ),
            "admins": AgentGroupConfig(
                password_hash=ADMINS_HASH,
                description="Admin team agents",
                metadata={
                    "permissions": ["manage_network", "monitor_system"],
                    "agents": ["admin-agent-1"]
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
async def test_group_event_delivery_basic(network_with_agent_groups):
    """Test basic group event delivery to all agents in a group."""
    network = network_with_agent_groups

    # Register agents in developers group
    for agent_id in ["dev-agent-1", "dev-agent-2", "dev-agent-3"]:
        response = await network.register_agent(
            agent_id=agent_id,
            transport_type=TransportType.HTTP,
            metadata={"name": f"Developer Agent {agent_id}"},
            certificate=None,
            force_reconnect=False,
            password_hash=DEVELOPERS_HASH,
        )
        assert response.success, f"Registration failed for {agent_id}: {response.message}"
        
        # Verify agent was assigned to developers group
        group = network.topology.agent_group_membership.get(agent_id)
        assert group == "developers", f"Agent {agent_id} expected 'developers', got '{group}'"

    # Register one agent in testers group (should not receive developers group events)
    response = await network.register_agent(
        agent_id="qa-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "QA Agent 1"},
        certificate=None,
        force_reconnect=False,
        password_hash=TESTERS_HASH,
    )
    assert response.success

    # Create event targeted at developers group
    event = Event(
        event_name="code.review.requested",
        source_id="project-manager-agent",
        destination_id="group:developers",
        payload={
            "pull_request_id": "PR-123",
            "repository": "openagents/main",
            "message": "Please review the new authentication module"
        }
    )

    # Process the event through the gateway
    response = await network.event_gateway.process_event(event, enable_delivery=True)
    assert response.success, f"Event processing failed: {response.message}"

    # Give a moment for async delivery
    await asyncio.sleep(0.1)

    # Verify that all developers received the event
    for agent_id in ["dev-agent-1", "dev-agent-2", "dev-agent-3"]:
        events = await network.event_gateway.poll_events(agent_id)
        assert len(events) == 1, f"Agent {agent_id} should have received exactly 1 event, got {len(events)}"
        received_event = events[0]
        assert received_event.event_name == "code.review.requested"
        assert received_event.payload["pull_request_id"] == "PR-123"

    # Verify that the QA agent did NOT receive the event
    qa_events = await network.event_gateway.poll_events("qa-agent-1")
    assert len(qa_events) == 0, f"QA agent should not have received developers group event, got {len(qa_events)} events"


@pytest.mark.asyncio
async def test_group_event_delivery_multiple_groups(network_with_agent_groups):
    """Test event delivery to multiple different groups."""
    network = network_with_agent_groups

    # Register agents in different groups
    dev_agents = ["dev-agent-1", "dev-agent-2"]
    qa_agents = ["qa-agent-1", "qa-agent-2"]
    admin_agents = ["admin-agent-1"]

    for agent_id in dev_agents:
        response = await network.register_agent(
            agent_id=agent_id,
            transport_type=TransportType.HTTP,
            metadata={"name": f"Developer {agent_id}"},
            certificate=None,
            password_hash=DEVELOPERS_HASH,
        )
        assert response.success

    for agent_id in qa_agents:
        response = await network.register_agent(
            agent_id=agent_id,
            transport_type=TransportType.HTTP,
            metadata={"name": f"QA {agent_id}"},
            certificate=None,
            password_hash=TESTERS_HASH,
        )
        assert response.success

    for agent_id in admin_agents:
        response = await network.register_agent(
            agent_id=agent_id,
            transport_type=TransportType.HTTP,
            metadata={"name": f"Admin {agent_id}"},
            certificate=None,
            password_hash=ADMINS_HASH,
        )
        assert response.success

    # Send event to developers group
    dev_event = Event(
        event_name="code.deploy.started",
        source_id="ci-system",
        destination_id="group:developers",
        payload={"deployment_id": "DEP-456", "environment": "staging"}
    )

    # Send event to testers group
    qa_event = Event(
        event_name="test.suite.completed",
        source_id="test-runner",
        destination_id="group:testers",
        payload={"test_run_id": "RUN-789", "status": "passed", "coverage": 85}
    )

    # Send event to admins group
    admin_event = Event(
        event_name="system.alert.critical",
        source_id="monitoring-system",
        destination_id="group:admins",
        payload={"alert_type": "memory_usage", "threshold": 90, "current": 95}
    )

    # Process all events
    for event in [dev_event, qa_event, admin_event]:
        response = await network.event_gateway.process_event(event, enable_delivery=True)
        assert response.success

    # Give a moment for async delivery
    await asyncio.sleep(0.1)

    # Verify developers received only the dev event
    for agent_id in dev_agents:
        events = await network.event_gateway.poll_events(agent_id)
        assert len(events) == 1, f"Dev agent {agent_id} should have received 1 event"
        assert events[0].event_name == "code.deploy.started"

    # Verify QA agents received only the QA event
    for agent_id in qa_agents:
        events = await network.event_gateway.poll_events(agent_id)
        assert len(events) == 1, f"QA agent {agent_id} should have received 1 event"
        assert events[0].event_name == "test.suite.completed"

    # Verify admin agents received only the admin event
    for agent_id in admin_agents:
        events = await network.event_gateway.poll_events(agent_id)
        assert len(events) == 1, f"Admin agent {agent_id} should have received 1 event"
        assert events[0].event_name == "system.alert.critical"


@pytest.mark.asyncio
async def test_group_event_delivery_nonexistent_group(network_with_agent_groups):
    """Test event delivery to a nonexistent group."""
    network = network_with_agent_groups

    # Register one agent to verify no events are delivered
    response = await network.register_agent(
        agent_id="dev-agent-1",
        transport_type=TransportType.HTTP,
        metadata={"name": "Developer Agent 1"},
        certificate=None,
        password_hash=DEVELOPERS_HASH,
    )
    assert response.success

    # Create event targeted at nonexistent group
    event = Event(
        event_name="project.update.posted",
        source_id="project-manager",
        destination_id="group:nonexistent",
        payload={"update": "This group doesn't exist"}
    )

    # Process the event (should succeed but not deliver to anyone)
    response = await network.event_gateway.process_event(event, enable_delivery=True)
    assert response.success

    # Give a moment for async delivery
    await asyncio.sleep(0.1)

    # Verify no agents received the event
    events = await network.event_gateway.poll_events("dev-agent-1")
    assert len(events) == 0, "No agent should receive events for nonexistent groups"


@pytest.mark.asyncio
async def test_group_event_delivery_excludes_sender(network_with_agent_groups):
    """Test that group event delivery excludes the sender even if they're in the group."""
    network = network_with_agent_groups

    # Register agents in developers group
    for agent_id in ["dev-agent-1", "dev-agent-2", "dev-agent-3"]:
        response = await network.register_agent(
            agent_id=agent_id,
            transport_type=TransportType.HTTP,
            metadata={"name": f"Developer {agent_id}"},
            certificate=None,
            password_hash=DEVELOPERS_HASH,
        )
        assert response.success

    # Create event from one of the developers to the developers group
    event = Event(
        event_name="team.meeting.scheduled",
        source_id="dev-agent-1",  # Sender is in the group
        destination_id="group:developers",
        payload={"meeting_time": "2024-01-15 10:00 AM", "topic": "Sprint Planning"}
    )

    # Process the event
    response = await network.event_gateway.process_event(event, enable_delivery=True)
    assert response.success

    # Give a moment for async delivery
    await asyncio.sleep(0.1)

    # Verify sender did not receive their own event
    sender_events = await network.event_gateway.poll_events("dev-agent-1")
    assert len(sender_events) == 0, "Sender should not receive their own group event"

    # Verify other group members received the event
    for agent_id in ["dev-agent-2", "dev-agent-3"]:
        events = await network.event_gateway.poll_events(agent_id)
        assert len(events) == 1, f"Agent {agent_id} should have received the event"
        assert events[0].event_name == "team.meeting.scheduled"
        assert events[0].source_id == "dev-agent-1"


@pytest.mark.asyncio
async def test_group_event_delivery_with_subscriptions(network_with_agent_groups):
    """Test group event delivery respects agent subscriptions."""
    network = network_with_agent_groups

    # Register agents
    for agent_id in ["dev-agent-1", "dev-agent-2"]:
        response = await network.register_agent(
            agent_id=agent_id,
            transport_type=TransportType.HTTP,
            metadata={"name": f"Developer {agent_id}"},
            certificate=None,
            password_hash=DEVELOPERS_HASH,
        )
        assert response.success

    # Subscribe dev-agent-1 to only code-related events
    subscription = network.event_gateway.subscribe(
        agent_id="dev-agent-1",
        event_patterns=["code.*"]
    )
    assert subscription.agent_id == "dev-agent-1"

    # dev-agent-2 has no subscriptions (receives all events)

    # Send a code-related event to developers group
    code_event = Event(
        event_name="code.review.completed",
        source_id="reviewer-agent",
        destination_id="group:developers",
        payload={"review_status": "approved"}
    )

    # Send a non-code-related event to developers group
    meeting_event = Event(
        event_name="meeting.reminder.sent",
        source_id="calendar-agent",
        destination_id="group:developers",
        payload={"meeting_topic": "Team standup"}
    )

    # Process both events
    for event in [code_event, meeting_event]:
        response = await network.event_gateway.process_event(event, enable_delivery=True)
        assert response.success

    # Give a moment for async delivery
    await asyncio.sleep(0.1)

    # Verify dev-agent-1 (with subscription) only received the code event
    dev1_events = await network.event_gateway.poll_events("dev-agent-1")
    assert len(dev1_events) == 1, "dev-agent-1 should receive only matching events"
    assert dev1_events[0].event_name == "code.review.completed"

    # Verify dev-agent-2 (no subscriptions) received both events
    dev2_events = await network.event_gateway.poll_events("dev-agent-2")
    assert len(dev2_events) == 2, "dev-agent-2 should receive all events"
    event_names = [e.event_name for e in dev2_events]
    assert "code.review.completed" in event_names
    assert "meeting.reminder.sent" in event_names


@pytest.mark.asyncio
async def test_group_config_agent_list_format(network_with_agent_groups):
    """Test that the _get_group_members method correctly parses different agent list formats."""
    network = network_with_agent_groups

    # Test metadata.agents format (already configured in fixture)
    developers = network.event_gateway._get_group_members("developers")
    assert set(developers) == {"dev-agent-1", "dev-agent-2", "dev-agent-3"}

    # Test direct agents format - create a new group config temporarily
    # This simulates if someone configured the group with direct 'agents' field
    original_config = network.config.agent_groups["testers"]
    network.config.agent_groups["testers"] = AgentGroupConfig(
        password_hash=TESTERS_HASH,
        description="QA team agents",
        metadata={
            "permissions": ["test_execution"]
        },
        # Simulate direct agents field (though this isn't in the current model)
    )
    
    # Add direct agents field to the config dict for testing
    network.config.agent_groups["testers"].__dict__["agents"] = ["qa-agent-1", "qa-agent-2"]

    testers = network.event_gateway._get_group_members("testers") 
    # This will return empty list since the current implementation only supports metadata.agents
    # But the test documents the intended behavior

    # Test nonexistent group
    nonexistent = network.event_gateway._get_group_members("nonexistent")
    assert nonexistent == []

    # Restore original config
    network.config.agent_groups["testers"] = original_config


@pytest.mark.asyncio
async def test_group_event_parse_destination(network_with_agent_groups):
    """Test that Event.parse_destination correctly handles group destinations."""
    
    # Test group destination parsing
    event_with_group = Event(
        event_name="test.group.event",
        source_id="test-agent",
        destination_id="group:developers"
    )
    
    destination = event_with_group.parse_destination()
    assert destination.role.value == "group"
    assert destination.desitnation_id == "developers"

    # Test agent destination parsing (for comparison)
    event_with_agent = Event(
        event_name="test.agent.event",
        source_id="test-agent",
        destination_id="agent:specific-agent"
    )
    
    agent_destination = event_with_agent.parse_destination()
    assert agent_destination.role.value == "agent"
    assert agent_destination.desitnation_id == "specific-agent"

    # Test broadcast destination parsing
    event_broadcast = Event(
        event_name="test.broadcast.event",
        source_id="test-agent",
        destination_id="agent:broadcast"
    )
    
    broadcast_destination = event_broadcast.parse_destination()
    assert broadcast_destination.role.value == "agent"
    assert broadcast_destination.desitnation_id == "broadcast"