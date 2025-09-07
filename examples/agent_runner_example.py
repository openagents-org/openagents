#!/usr/bin/env python3
"""
Simple demo agent that connects to an OpenAgents network and responds to messages.
"""

import asyncio
import logging
from typing import Dict

from openagents.agents.runner import AgentRunner
from openagents.models.messages import Event, EventNames
from openagents.models.message_thread import MessageThread
from openagents.models.event import Event

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SimpleAgent(AgentRunner):
    """A simple agent that echoes direct messages and responds to greetings."""
    
    def __init__(self):
        super().__init__(agent_id="simple-demo-agent")
        self.message_count = 0

    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message):
        """React to an incoming message."""
        print(f"🎯 REACT CALLED! Processing message from {incoming_message.source_id}")
        print(f"   Message type: {type(incoming_message).__name__}")
        print(f"   Content: {incoming_message.payload}")
        print(f"   Requires response: {incoming_message.requires_response}")
        
        self.message_count += 1
        sender_id = incoming_message.source_id
        content = incoming_message.payload
        text = content.get("text", str(content))
        
        logger.info(f"Agent {self.client.agent_id} received message from {sender_id}: {text}")
        logger.info(f"Message type: {type(incoming_message).__name__}, Protocol: {getattr(incoming_message, 'protocol', 'N/A')}")
        
        # Handle different message types
        if isinstance(incoming_message, Event):
            logger.info(f"Processing direct message from {sender_id} to {incoming_message.target_agent_id}")
            print(f"📨 Sending echo response to {sender_id}")
            # Echo direct messages back
            echo_message = Event(
                event_name="agent.direct_message.sent",
                source_id=self.client.agent_id,
                target_agent_id=sender_id,
                relevant_mod="openagents.mods.communication.simple_messaging",
                payload={"text": f"Echo: {text}"},
                text_representation=f"Echo: {text}",
                requires_response=False
            )
            await self.client.send_direct_message(echo_message)
            logger.info(f"Sent echo message back to {sender_id}")
            print(f"✅ Echo sent successfully!")
            
        elif isinstance(incoming_message, Event):
            logger.info(f"Processing broadcast message from {sender_id}")
            # Respond to greetings in broadcast messages
            if "hello" in text.lower() and sender_id != self.client.agent_id:
                greeting_message = Event(
                    event_name="agent.direct_message.sent",
                    source_id=self.client.agent_id,
                    target_agent_id=sender_id,
                    relevant_mod="openagents.mods.communication.simple_messaging",
                    payload={"text": f"Hello {sender_id}! Nice to meet you!"},
                    text_representation=f"Hello {sender_id}! Nice to meet you!",
                    requires_response=False
                )
                await self.client.send_direct_message(greeting_message)
                logger.info(f"Sent greeting message to {sender_id}")
        else:
            logger.info(f"Received unknown message type: {type(incoming_message).__name__}")
    
    async def setup(self):
        """Setup the agent after connection."""
        print(f"🚀 Agent {self.client.agent_id} connected and ready!")
        logger.info(f"Agent {self.client.agent_id} connected and ready!")
        logger.info(f"Agent protocols: {[name for name in self.client.mod_adapters.keys()]}")
        print(f"📋 Loaded protocols: {list(self.client.mod_adapters.keys())}")
        
        # Send a greeting broadcast message
        greeting_message = Event(
            event_name="agent.broadcast_message.sent",
            source_id=self.client.agent_id,
            relevant_mod="openagents.mods.communication.simple_messaging",
            payload={"text": f"Hello! I'm {self.client.agent_id}, ready to help!"},
            text_representation=f"Hello! I'm {self.client.agent_id}, ready to help!",
            requires_response=False
        )
        await self.client.send_broadcast_message(greeting_message)
    
    async def teardown(self):
        """Cleanup before disconnection."""
        logger.info(f"Agent {self.client.agent_id} is shutting down...")
        
        # Send goodbye message
        goodbye_message = Event(
            event_name="agent.broadcast_message.sent",
            source_id=self.client.agent_id,
            relevant_mod="openagents.mods.communication.simple_messaging",
            payload={"text": f"Goodbye from {self.client.agent_id}!"},
            text_representation=f"Goodbye from {self.client.agent_id}!",
            requires_response=False
        )
        await self.client.send_broadcast_message(goodbye_message)


def main():
    """Main function to run the simple agent."""
    # Create agent
    agent = SimpleAgent()
    
    # Connection parameters (change these to match your network)
    host = "localhost"
    port = 8570
    
    # Agent metadata
    metadata = {
        "name": "Simple Demo Agent",
        "type": "demo_agent",
        "capabilities": ["echo", "greeting", "status_updates"],
        "version": "1.0.0"
    }
    
    try:
        # Start the agent (this will connect and run until interrupted)
        print(f"Starting agent and connecting to {host}:{port}...")
        agent.start(host=host, port=port, metadata=metadata)
        
        # Wait for the agent to finish (this blocks until Ctrl+C)
        agent.wait_for_stop()
        
    except KeyboardInterrupt:
        print("\nShutting down agent...")
    finally:
        # Stop the agent
        agent.stop()
        print("Agent stopped")


if __name__ == "__main__":
    main() 