"""
Test for the specific event subscription interface requested.

This test focuses on the exact interface pattern:
ws = network.workspace()
sub = ws.events.subscribe(["agent.direct_message.received", "channel.post.created", ...])
async for ev in sub:
    print("EVENT:", ev.event_name, ...)
    break
"""

import asyncio
import pytest
import logging
import random
import tempfile
import yaml
import os

from src.openagents.core.network import AgentNetwork
from src.openagents.agents.simple_echo_agent import SimpleEchoAgentRunner

logger = logging.getLogger(__name__)


class TestEventSubscriptionInterface:
    """Test the exact event subscription interface requested by the user."""

    @pytest.fixture(autouse=True)
    async def setup_and_teardown(self):
        """Set up and tear down test environment."""
        self.host = "127.0.0.1"
        self.port = random.randint(9300, 9399)
        self.network = None
        self.agents = []
        
        logger.info(f"Setting up event subscription interface test on {self.host}:{self.port}")
        
        yield
        
        # Cleanup
        logger.info("Cleaning up event subscription interface test...")
        
        for agent in self.agents:
            try:
                await agent.async_stop()
            except Exception as e:
                logger.warning(f"Error stopping agent: {e}")
        
        if self.network:
            try:
                await self.network.shutdown()
            except Exception as e:
                logger.warning(f"Error shutting down network: {e}")

    async def create_test_network(self):
        """Create a test network with workspace support."""
        config_data = {
            "network": {
                "name": "TestEventSubscriptionInterface",
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
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            yaml.dump(config_data, f)
            temp_config_path = f.name
        
        try:
            self.network = AgentNetwork.load(temp_config_path)
            await self.network.initialize()
        finally:
            if os.path.exists(temp_config_path):
                os.unlink(temp_config_path)

    @pytest.mark.asyncio
    async def test_exact_requested_interface(self):
        """Test the exact interface pattern requested by the user."""
        logger.info("Testing exact requested event subscription interface...")
        
        # Set up network
        await self.create_test_network()
        
        # Start an echo agent for testing
        echo_agent = SimpleEchoAgentRunner("echo-agent", "Echo")
        await echo_agent.async_start(self.host, self.port)
        self.agents.append(echo_agent)
        
        # Wait for connections to stabilize
        await asyncio.sleep(1.0)
        
        # This is the EXACT interface pattern requested!
        ws = self.network.workspace()
        
        # Subscribe to typed events
        sub = ws.events.subscribe([
            "agent.direct_message.received", 
            "channel.post.created", 
            "channel.message.received"
        ])
        
        # Generate some events
        channel = ws.channel("#general")
        await channel.post("Hello from interface test!")
        
        echo_conn = ws.agent("echo-agent")
        await echo_conn.send_direct_message("Test message")
        
        # Read a couple events then shut down
        events_received = []
        event_count = 0
        max_events = 2
        
        async def collect_events():
            """Collect events from subscription."""
            nonlocal events_received, event_count
            async for ev in sub:
                print("EVENT:", ev.event_name, "from:", ev.source_agent_id, "data:", ev.data)
                events_received.append(ev)
                event_count += 1
                
                if event_count >= max_events:
                    break
        
        try:
            await asyncio.wait_for(collect_events(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.info(f"Timeout reached, received {len(events_received)} events")
        
        # Verify we received events
        assert len(events_received) >= 1, f"Expected at least 1 event, got {len(events_received)}"
        
        # Verify event structure
        for ev in events_received:
            assert hasattr(ev, 'event_name'), "Event should have event_name property"
            assert hasattr(ev, 'source_agent_id'), "Event should have source_agent_id property"
            assert hasattr(ev, 'data'), "Event should have data property"
            assert hasattr(ev, 'timestamp'), "Event should have timestamp property"
            
            # Verify event_name is a string
            assert isinstance(ev.event_name, str), "event_name should be a string"
            
            # Verify it's one of our subscribed event types
            assert ev.event_name in [
                "agent.direct_message.received", 
                "channel.post.created", 
                "channel.message.received",
                "agent.direct_message.sent"  # This might also be generated
            ], f"Unexpected event type: {ev.event_name}"
        
        # Clean up subscription
        ws.events.unsubscribe(sub)
        
        logger.info("✅ Exact requested interface test completed successfully!")

    @pytest.mark.asyncio
    async def test_interface_with_filters(self):
        """Test the interface with event filters."""
        logger.info("Testing event subscription interface with filters...")
        
        await self.create_test_network()
        
        # Wait for network to stabilize
        await asyncio.sleep(1.0)
        
        # Test the interface with filters
        ws = self.network.workspace()
        
        # Subscribe with filters (extension of the requested interface)
        sub = ws.events.subscribe(
            ["channel.post.created", "channel.message.received"],
            filters={"channel": "#general"}
        )
        
        # Generate events in different channels
        general_channel = ws.channel("#general")
        dev_channel = ws.channel("#dev")
        
        await general_channel.post("Message in #general")
        await dev_channel.post("Message in #dev")  # Should be filtered out
        await general_channel.post("Another message in #general")
        
        # Collect filtered events
        events_received = []
        event_count = 0
        
        async def collect_filtered_events():
            """Collect filtered events from subscription."""
            nonlocal events_received, event_count
            async for ev in sub:
                print("FILTERED EVENT:", ev.event_name, "channel:", ev.channel, "data:", ev.data)
                events_received.append(ev)
                event_count += 1
                
                if event_count >= 2:
                    break
        
        try:
            await asyncio.wait_for(collect_filtered_events(), timeout=3.0)
        except asyncio.TimeoutError:
            logger.info(f"Timeout reached, received {len(events_received)} filtered events")
        
        # Verify all events are from #general
        for ev in events_received:
            assert ev.channel == "#general", f"Expected event from #general, got {ev.channel}"
        
        ws.events.unsubscribe(sub)
        
        logger.info("✅ Interface with filters test completed!")

    @pytest.mark.asyncio
    async def test_interface_error_handling(self):
        """Test error handling in the event subscription interface."""
        logger.info("Testing event subscription interface error handling...")
        
        await self.create_test_network()
        
        ws = self.network.workspace()
        
        # Test invalid event types
        with pytest.raises(ValueError):
            ws.events.subscribe(["invalid.event.type"])
        
        # Test valid subscription
        sub = ws.events.subscribe(["channel.post.created"])
        
        # Test that we can safely unsubscribe
        ws.events.unsubscribe(sub)
        
        # Test that iterating over unsubscribed subscription stops
        events_after_unsubscribe = []
        
        async def collect_after_unsubscribe():
            """Try to collect events after unsubscribe."""
            async for ev in sub:
                events_after_unsubscribe.append(ev)
        
        try:
            await asyncio.wait_for(collect_after_unsubscribe(), timeout=1.0)
        except (asyncio.TimeoutError, StopAsyncIteration):
            pass  # Expected
        
        assert len(events_after_unsubscribe) == 0, "Should not receive events after unsubscribe"
        
        logger.info("✅ Interface error handling test completed!")

    @pytest.mark.asyncio
    async def test_multiple_concurrent_subscriptions(self):
        """Test multiple concurrent subscriptions using the interface."""
        logger.info("Testing multiple concurrent subscriptions...")
        
        await self.create_test_network()
        
        ws = self.network.workspace()
        
        # Create multiple subscriptions
        channel_sub = ws.events.subscribe(["channel.post.created"])
        agent_sub = ws.events.subscribe(["agent.direct_message.sent"])
        
        # Generate events
        channel = ws.channel("#general")
        await channel.post("Test for concurrent subscriptions")
        
        # Collect from both subscriptions concurrently
        async def collect_channel_events():
            events = []
            
            async def collect_from_channel_sub():
                async for ev in channel_sub:
                    events.append(ev)
                    print("CHANNEL EVENT:", ev.event_name)
                    break
            
            try:
                await asyncio.wait_for(collect_from_channel_sub(), timeout=2.0)
            except asyncio.TimeoutError:
                pass
            return events
        
        async def collect_agent_events():
            events = []
            
            async def collect_from_agent_sub():
                async for ev in agent_sub:
                    events.append(ev)
                    print("AGENT EVENT:", ev.event_name)
                    break
            
            try:
                await asyncio.wait_for(collect_from_agent_sub(), timeout=2.0)
            except asyncio.TimeoutError:
                pass
            return events
        
        # Run both collectors concurrently
        channel_events, agent_events = await asyncio.gather(
            collect_channel_events(),
            collect_agent_events(),
            return_exceptions=True
        )
        
        # Verify we got events from the channel subscription
        if isinstance(channel_events, list):
            assert len(channel_events) >= 1, "Should have received channel events"
        
        # Clean up
        ws.events.unsubscribe(channel_sub)
        ws.events.unsubscribe(agent_sub)
        
        logger.info("✅ Multiple concurrent subscriptions test completed!")

    @pytest.mark.asyncio
    async def test_simple_usage_pattern(self):
        """Test the simplest possible usage pattern."""
        logger.info("Testing simple usage pattern...")
        
        await self.create_test_network()
        
        # The absolute simplest pattern
        ws = self.network.workspace()
        sub = ws.events.subscribe(["channel.post.created"])
        
        # Send message
        await ws.channel("#general").post("Simple test")
        
        # Get one event and exit
        async for ev in sub:
            assert ev.event_name == "channel.post.created"
            assert "Simple test" in ev.data.get("text", "")
            print(f"✅ Received event: {ev.event_name}")
            break
        
        ws.events.unsubscribe(sub)
        
        logger.info("✅ Simple usage pattern test completed!")
