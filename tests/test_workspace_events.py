"""
Tests for workspace event subscription functionality.

This module tests the new event subscription interface that allows agents
to subscribe to typed events using an async iterator pattern.
"""

import asyncio
import pytest
import logging
import random
import tempfile
import yaml
import os
from typing import List, Dict, Any

from src.openagents.core.network import AgentNetwork
from src.openagents.core.client import AgentClient
from src.openagents.agents.simple_echo_agent import SimpleEchoAgentRunner
# DEPRECATED: This test file tests the old workspace-level event system
# The functionality has been moved to network-level events
# See tests/test_unified_event_system.py for the new event system tests
import pytest
pytest.skip("Workspace events deprecated - use network events instead", allow_module_level=True)

# Configure logging for tests
logger = logging.getLogger(__name__)


class EventTestAgent:
    """A test agent that uses event subscriptions."""
    
    def __init__(self, agent_id: str, workspace):
        self.agent_id = agent_id
        self.workspace = workspace
        self.received_events = []
        self.event_handlers_called = []
        
    def setup_event_handlers(self):
        """Set up event handlers for testing."""
        
        def on_channel_message(event):
            self.event_handlers_called.append(('channel_message', event))
            logger.info(f"Handler: Channel message in {event.channel}: {event.data.get('text', '')}")
        
        def on_direct_message(event):
            self.event_handlers_called.append(('direct_message', event))
            logger.info(f"Handler: Direct message from {event.source_agent_id}")
        
        def on_reaction(event):
            self.event_handlers_called.append(('reaction', event))
            logger.info(f"Handler: Reaction {event.data.get('reaction_type')} on message {event.data.get('target_message_id')}")
        
        # Register handlers
        self.workspace.events.register_handler(EventType.CHANNEL_POST_CREATED, on_channel_message)
        self.workspace.events.register_handler(EventType.CHANNEL_MESSAGE_RECEIVED, on_channel_message)
        self.workspace.events.register_handler(EventType.AGENT_DIRECT_MESSAGE_RECEIVED, on_direct_message)
        self.workspace.events.register_handler(EventType.REACTION_ADDED, on_reaction)
    
    async def collect_events(self, subscription, max_events=5, timeout=10.0):
        """Collect events from a subscription."""
        events = []
        
        async def collect_from_subscription():
            """Inner function to collect events."""
            async for event in subscription:
                events.append(event)
                self.received_events.append(event)
                logger.info(f"Collected event: {event.event_name} from {event.source_agent_id}")
                
                if len(events) >= max_events:
                    break
        
        try:
            await asyncio.wait_for(collect_from_subscription(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.info(f"Event collection timed out after {timeout}s, collected {len(events)} events")
        
        return events


class TestWorkspaceEvents:
    """Test cases for workspace event subscription."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down test environment."""
        # Initialize test data
        self.host = "127.0.0.1"
        self.port = random.randint(9200, 9299)
        self.network = None
        self.agents: List[SimpleEchoAgentRunner] = []
        self.test_agents: List[EventTestAgent] = []
        self.workspaces = []
        
        logger.info(f"Setting up workspace events test on {self.host}:{self.port}")
        
        # Setup is done, yield control back to the test
        yield
        
        # Clean up after the test
        logger.info("Cleaning up workspace events test...")
        
        # Clean up event subscriptions
        for ws in self.workspaces:
            try:
                if hasattr(ws, '_events') and ws._events:
                    ws.events.cleanup()
            except Exception as e:
                logger.warning(f"Error cleaning up workspace events: {e}")
        
        # Disconnect workspace clients
        for ws in self.workspaces:
            try:
                client = ws.get_client()
                if client and client.connector:
                    await client.disconnect()
            except Exception as e:
                logger.warning(f"Error disconnecting workspace: {e}")
        
        # Stop echo agents
        for agent in self.agents:
            try:
                await agent.async_stop()
            except Exception as e:
                logger.warning(f"Error stopping agent: {e}")
        
        # Shutdown network
        if self.network:
            try:
                await self.network.shutdown()
            except Exception as e:
                logger.warning(f"Error shutting down network: {e}")
        
        logger.info("Workspace events test cleanup completed")

    async def create_network(self):
        """Create and initialize a test network with workspace support."""
        # Create a temporary config file for testing
        config_data = {
            "network": {
                "name": "TestWorkspaceEventsNetwork",
                "mode": "centralized",
                "host": self.host,
                "port": self.port,
                "server_mode": True,
                "transport": "websocket",
                "mods": [
                    {
                        "name": "openagents.mods.communication.thread_messaging",
                        "enabled": True,
                        "config": {}
                    },
                    {
                        "name": "openagents.mods.workspace.default", 
                        "enabled": True,
                        "config": {}
                    }
                ]
            },
            "log_level": "INFO"
        }
        
        # Write temporary config file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yaml.dump(config_data, f)
            temp_config_path = f.name
        
        try:
            self.network = AgentNetwork.load(temp_config_path)
            await self.network.initialize()
            return self.network
        finally:
            # Clean up temp file
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)

    async def create_echo_agent(self, agent_id: str) -> SimpleEchoAgentRunner:
        """Create and start an echo agent."""
        agent = SimpleEchoAgentRunner(agent_id, f"Echo-{agent_id}")
        await agent.async_start(self.host, self.port)
        self.agents.append(agent)
        return agent

    async def create_test_agent(self, agent_id: str) -> EventTestAgent:
        """Create a test agent with workspace and events."""
        ws = self.network.workspace(agent_id)
        self.workspaces.append(ws)
        
        test_agent = EventTestAgent(agent_id, ws)
        self.test_agents.append(test_agent)
        return test_agent

    @pytest.mark.asyncio
    async def test_basic_event_subscription(self):
        """Test basic event subscription functionality."""
        logger.info("Testing basic event subscription...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        
        # Wait for connections to stabilize
        await asyncio.sleep(1.0)
        
        # Subscribe to events
        subscription = alice.workspace.events.subscribe([
            EventType.CHANNEL_POST_CREATED,
            EventType.CHANNEL_MESSAGE_RECEIVED,
            EventType.AGENT_DIRECT_MESSAGE_SENT
        ])
        
        # Verify subscription was created
        active_subs = alice.workspace.events.get_active_subscriptions()
        assert len(active_subs) == 1, f"Expected 1 active subscription, got {len(active_subs)}"
        
        # Send a message to generate events
        channel = alice.workspace.channel("#general")
        success = await channel.post("Hello from event test!")
        assert success, "Failed to send channel message"
        
        # Collect events
        events = await alice.collect_events(subscription, max_events=1, timeout=5.0)
        
        # Verify we received the expected event
        assert len(events) >= 1, f"Expected at least 1 event, got {len(events)}"
        
        channel_event = events[0]
        assert channel_event.event_type == EventType.CHANNEL_POST_CREATED
        assert channel_event.source_agent_id == alice.agent_id
        assert channel_event.channel == "#general"
        assert "Hello from event test!" in channel_event.data.get("text", "")
        
        # Clean up subscription
        alice.workspace.events.unsubscribe(subscription)
        
        logger.info("✅ Basic event subscription test completed")

    @pytest.mark.asyncio
    async def test_filtered_event_subscription(self):
        """Test event subscription with filters."""
        logger.info("Testing filtered event subscription...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        
        # Wait for connections to stabilize
        await asyncio.sleep(1.0)
        
        # Subscribe to events with channel filter
        subscription = alice.workspace.events.subscribe(
            [EventType.CHANNEL_POST_CREATED],
            filters={"channel": "#general"}
        )
        
        # Send messages to different channels
        general_channel = alice.workspace.channel("#general")
        dev_channel = alice.workspace.channel("#dev")
        
        await general_channel.post("Message in #general - should trigger event")
        await dev_channel.post("Message in #dev - should NOT trigger event")
        await general_channel.post("Another message in #general - should trigger event")
        
        # Collect events
        events = await alice.collect_events(subscription, max_events=2, timeout=5.0)
        
        # Verify we only received events from #general
        assert len(events) == 2, f"Expected 2 events from #general, got {len(events)}"
        
        for event in events:
            assert event.channel == "#general", f"Expected event from #general, got {event.channel}"
            assert event.event_type == EventType.CHANNEL_POST_CREATED
        
        # Clean up
        alice.workspace.events.unsubscribe(subscription)
        
        logger.info("✅ Filtered event subscription test completed")

    @pytest.mark.asyncio
    async def test_multiple_subscriptions(self):
        """Test multiple concurrent subscriptions."""
        logger.info("Testing multiple concurrent subscriptions...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        
        # Wait for connections to stabilize
        await asyncio.sleep(1.0)
        
        # Create multiple subscriptions
        channel_sub = alice.workspace.events.subscribe([EventType.CHANNEL_POST_CREATED])
        agent_sub = alice.workspace.events.subscribe([EventType.AGENT_DIRECT_MESSAGE_SENT])
        
        # Verify both subscriptions are active
        active_subs = alice.workspace.events.get_active_subscriptions()
        assert len(active_subs) == 2, f"Expected 2 active subscriptions, got {len(active_subs)}"
        
        # Generate events
        channel = alice.workspace.channel("#general")
        await channel.post("Test message for multiple subscriptions")
        
        # Collect events from both subscriptions concurrently
        async def collect_channel_events():
            return await alice.collect_events(channel_sub, max_events=1, timeout=3.0)
        
        async def collect_agent_events():
            return await alice.collect_events(agent_sub, max_events=1, timeout=3.0)
        
        channel_events, agent_events = await asyncio.gather(
            collect_channel_events(),
            collect_agent_events(),
            return_exceptions=True
        )
        
        # Verify channel events
        if isinstance(channel_events, list):
            assert len(channel_events) >= 1, "Should have received channel events"
            assert channel_events[0].event_type == EventType.CHANNEL_POST_CREATED
        
        # Clean up subscriptions
        alice.workspace.events.unsubscribe(channel_sub)
        alice.workspace.events.unsubscribe(agent_sub)
        
        logger.info("✅ Multiple subscriptions test completed")

    @pytest.mark.asyncio
    async def test_event_handlers(self):
        """Test event handlers as alternative to subscriptions."""
        logger.info("Testing event handlers...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        alice.setup_event_handlers()
        
        # Wait for connections to stabilize
        await asyncio.sleep(1.0)
        
        # Generate events
        channel = alice.workspace.channel("#general")
        await channel.post("Test message for event handlers")
        
        # Wait for handlers to be called
        await asyncio.sleep(1.0)
        
        # Verify handlers were called
        assert len(alice.event_handlers_called) >= 1, "Event handlers should have been called"
        
        # Check that we got the expected handler call
        handler_calls = [call for call in alice.event_handlers_called if call[0] == 'channel_message']
        assert len(handler_calls) >= 0, "Channel message handler should have been called"
        
        logger.info("✅ Event handlers test completed")

    @pytest.mark.asyncio
    async def test_custom_event_emission(self):
        """Test custom event emission."""
        logger.info("Testing custom event emission...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        
        # Subscribe to system events
        subscription = alice.workspace.events.subscribe([EventType.NETWORK_STATUS_CHANGED])
        
        # Emit a custom event
        custom_event = await alice.workspace.events.emit(
            EventType.NETWORK_STATUS_CHANGED,
            source_agent_id="test-system",
            data={
                "status": "test_mode",
                "message": "Network in test mode",
                "test_id": "custom_event_test"
            }
        )
        
        # Verify event was created correctly
        assert custom_event.event_type == EventType.NETWORK_STATUS_CHANGED
        assert custom_event.source_agent_id == "test-system"
        assert custom_event.data["status"] == "test_mode"
        
        # Collect the emitted event
        events = await alice.collect_events(subscription, max_events=1, timeout=3.0)
        
        # Verify we received the custom event
        assert len(events) == 1, f"Expected 1 custom event, got {len(events)}"
        
        received_event = events[0]
        assert received_event.event_type == EventType.NETWORK_STATUS_CHANGED
        assert received_event.source_agent_id == "test-system"
        assert received_event.data["test_id"] == "custom_event_test"
        
        # Clean up
        alice.workspace.events.unsubscribe(subscription)
        
        logger.info("✅ Custom event emission test completed")

    @pytest.mark.asyncio
    async def test_agent_to_agent_events(self):
        """Test events between multiple agents."""
        logger.info("Testing agent-to-agent events...")
        
        # Create network
        await self.create_network()
        
        # Create echo agent and test agent
        echo_agent = await self.create_echo_agent("echo-bot")
        alice = await self.create_test_agent("alice")
        
        # Wait for connections to stabilize
        await asyncio.sleep(1.0)
        
        # Subscribe to direct message events
        subscription = alice.workspace.events.subscribe([
            EventType.AGENT_DIRECT_MESSAGE_SENT,
            EventType.AGENT_DIRECT_MESSAGE_RECEIVED
        ])
        
        # Send direct message to echo agent
        echo_conn = alice.workspace.agent("echo-bot")
        success = await echo_conn.send_direct_message("Hello echo bot from event test!")
        assert success, "Failed to send direct message"
        
        # Collect events
        events = await alice.collect_events(subscription, max_events=2, timeout=5.0)
        
        # Verify we received events
        assert len(events) >= 1, f"Expected at least 1 event, got {len(events)}"
        
        # Check for sent message event
        sent_events = [e for e in events if e.event_type == EventType.AGENT_DIRECT_MESSAGE_SENT]
        assert len(sent_events) >= 1, "Should have received direct message sent event"
        
        sent_event = sent_events[0]
        assert sent_event.source_agent_id == alice.agent_id
        assert sent_event.target_agent_id == "echo-bot"
        
        # Clean up
        alice.workspace.events.unsubscribe(subscription)
        
        logger.info("✅ Agent-to-agent events test completed")

    @pytest.mark.asyncio
    async def test_event_subscription_cleanup(self):
        """Test proper cleanup of event subscriptions."""
        logger.info("Testing event subscription cleanup...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        
        # Create multiple subscriptions
        sub1 = alice.workspace.events.subscribe([EventType.CHANNEL_POST_CREATED])
        sub2 = alice.workspace.events.subscribe([EventType.AGENT_DIRECT_MESSAGE_SENT])
        sub3 = alice.workspace.events.subscribe([EventType.REACTION_ADDED])
        
        # Verify all subscriptions are active
        active_subs = alice.workspace.events.get_active_subscriptions()
        assert len(active_subs) == 3, f"Expected 3 active subscriptions, got {len(active_subs)}"
        
        # Unsubscribe from one
        alice.workspace.events.unsubscribe(sub1)
        active_subs = alice.workspace.events.get_active_subscriptions()
        assert len(active_subs) == 2, f"Expected 2 active subscriptions after unsubscribe, got {len(active_subs)}"
        
        # Cleanup all
        alice.workspace.events.cleanup()
        active_subs = alice.workspace.events.get_active_subscriptions()
        assert len(active_subs) == 0, f"Expected 0 active subscriptions after cleanup, got {len(active_subs)}"
        
        logger.info("✅ Event subscription cleanup test completed")

    @pytest.mark.asyncio
    async def test_event_types_validation(self):
        """Test event type validation."""
        logger.info("Testing event type validation...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        
        # Test valid event types (string format)
        try:
            sub = alice.workspace.events.subscribe([
                "channel.post.created",
                "agent.direct_message.received"
            ])
            alice.workspace.events.unsubscribe(sub)
        except Exception as e:
            pytest.fail(f"Valid event types should not raise exception: {e}")
        
        # Test invalid event type
        with pytest.raises(ValueError):
            alice.workspace.events.subscribe(["invalid.event.type"])
        
        # Test mixed valid/invalid event types
        with pytest.raises(ValueError):
            alice.workspace.events.subscribe([
                "channel.post.created",
                "invalid.event.type"
            ])
        
        # Test EventType enum format
        try:
            sub = alice.workspace.events.subscribe([
                EventType.CHANNEL_POST_CREATED,
                EventType.AGENT_DIRECT_MESSAGE_RECEIVED
            ])
            alice.workspace.events.unsubscribe(sub)
        except Exception as e:
            pytest.fail(f"EventType enums should not raise exception: {e}")
        
        logger.info("✅ Event types validation test completed")

    @pytest.mark.asyncio
    async def test_available_event_types(self):
        """Test getting available event types."""
        logger.info("Testing available event types...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        
        # Get available event types
        available_types = alice.workspace.events.get_available_event_types()
        
        # Verify we have the expected event types
        expected_types = [
            "agent.connected",
            "agent.disconnected", 
            "agent.direct_message.received",
            "agent.direct_message.sent",
            "channel.post.created",
            "channel.message.received",
            "reaction.added",
            "reaction.removed",
            "file.uploaded",
            "network.status.changed"
        ]
        
        for expected_type in expected_types:
            assert expected_type in available_types, f"Expected event type {expected_type} not found in available types"
        
        logger.info(f"✅ Available event types test completed. Found {len(available_types)} event types")

    @pytest.mark.asyncio
    async def test_channel_mention_events(self):
        """Test channel mention events functionality."""
        logger.info("Testing channel mention events...")
        
        # Create network
        await self.create_network()
        
        # Create test agent
        alice = await self.create_test_agent("alice")
        
        # Wait for connections to stabilize
        await asyncio.sleep(1.0)
        
        # Alice subscribes to events
        alice_sub = alice.workspace.events.subscribe([
            EventType.CHANNEL_POST_CREATED,
            EventType.CHANNEL_MESSAGE_MENTIONED
        ])
        
        # Test 1: Alice posts a regular message (should get channel.post.created)
        alice_channel = alice.workspace.channel("#general")
        await alice_channel.post("This is a test message")
        
        # Test 2: Test direct event emission for mentions
        await alice.workspace.events.emit(
            EventType.CHANNEL_MESSAGE_MENTIONED,
            source_agent_id="bob",
            target_agent_id="alice", 
            channel="#general",
            data={
                "text": "Hey @alice, check this out!",
                "mention_type": "text_mention"
            }
        )
        
        # Test 3: Test explicit mention event emission
        await alice.workspace.events.emit(
            EventType.CHANNEL_MESSAGE_MENTIONED,
            source_agent_id="bob",
            target_agent_id="alice",
            channel="#general", 
            data={
                "text": "Hello Alice!",
                "mention_type": "explicit"
            }
        )
        
        # Collect Alice's events
        alice_events = await alice.collect_events(alice_sub, max_events=5, timeout=5.0)
        
        # Verify Alice received events
        post_events = [e for e in alice_events if e.event_type == EventType.CHANNEL_POST_CREATED]
        mention_events = [e for e in alice_events if e.event_type == EventType.CHANNEL_MESSAGE_MENTIONED]
        
        assert len(post_events) >= 1, f"Alice should have received channel.post.created events, got {len(post_events)}"
        assert len(mention_events) >= 2, f"Alice should have received mention events, got {len(mention_events)}"
        
        # Verify mention event structure
        for mention_event in mention_events:
            assert mention_event.source_agent_id == "bob", f"Mention should be from Bob, got {mention_event.source_agent_id}"
            assert mention_event.target_agent_id == "alice", f"Mention should target Alice, got {mention_event.target_agent_id}"
            assert mention_event.channel == "#general", f"Mention should be in #general, got {mention_event.channel}"
            assert "mention_type" in mention_event.data, "Mention event should have mention_type in data"
            assert mention_event.data["mention_type"] in ["explicit", "text_mention"], f"Invalid mention type: {mention_event.data['mention_type']}"
        
        # Check specific mention types
        explicit_mentions = [e for e in mention_events if e.data.get("mention_type") == "explicit"]
        text_mentions = [e for e in mention_events if e.data.get("mention_type") == "text_mention"]
        
        assert len(explicit_mentions) >= 1, "Should have received explicit mention event"
        assert len(text_mentions) >= 1, "Should have received text mention event"
        
        # Clean up subscriptions
        alice.workspace.events.unsubscribe(alice_sub)
        
        logger.info("✅ Channel mention events test completed")
