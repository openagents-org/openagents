#!/usr/bin/env python3
"""
Example: Simple agent using AgentRunner

This script demonstrates how to create a simple agent that connects to a centralized network
using the AgentRunner class, which provides a cleaner API than the low-level client.
"""

import asyncio
import logging
from typing import Dict, Any, Optional
from openagents.agents.runner import AgentRunner
from openagents.models.messages import DirectMessage, BroadcastMessage
from openagents.models.message_thread import MessageThread
from openagents.models.messages import BaseMessage

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class SimpleAgent(AgentRunner):
    """A simple demonstration agent."""
    
    def __init__(self, agent_id: str = "simple-agent"):
        """Initialize the simple agent."""
        super().__init__(agent_id=agent_id)
        self.message_count = 0
    
    async def react(self, message_threads: Dict[str, MessageThread], incoming_thread_id: str, incoming_message: BaseMessage):
        """React to an incoming message."""
        self.message_count += 1
        sender_id = incoming_message.sender_id
        content = incoming_message.content
        text = content.get("text", str(content))
        
        logger.info(f"Agent {self._agent_id} received message from {sender_id}: {text}")
        
        # Handle different message types
        if isinstance(incoming_message, DirectMessage):
            # Echo direct messages back
            echo_message = DirectMessage(
                sender_id=self._agent_id,
                target_agent_id=sender_id,
                protocol="openagents.protocols.communication.simple_messaging",
                message_type="direct_message",
                content={"text": f"Echo: {text}"},
                text_representation=f"Echo: {text}",
                requires_response=False
            )
            await self.client.send_direct_message(echo_message)
            
        elif isinstance(incoming_message, BroadcastMessage):
            # Respond to greetings in broadcast messages
            if "hello" in text.lower() and sender_id != self._agent_id:
                greeting_message = DirectMessage(
                    sender_id=self._agent_id,
                    target_agent_id=sender_id,
                    protocol="openagents.protocols.communication.simple_messaging",
                    content={"text": f"Hello {sender_id}! Nice to meet you!"},
                    text_representation=f"Hello {sender_id}! Nice to meet you!",
                    requires_response=False
                )
                await self.client.send_direct_message(greeting_message)
    
    async def setup(self):
        """Setup the agent after connection."""
        logger.info(f"Agent {self._agent_id} connected and ready!")
        
        # Send a greeting broadcast message
        greeting_message = BroadcastMessage(
            sender_id=self._agent_id,
            protocol="openagents.protocols.communication.simple_messaging",
            content={"text": f"Hello! I'm {self._agent_id}, ready to help!"},
            text_representation=f"Hello! I'm {self._agent_id}, ready to help!",
            requires_response=False
        )
        await self.client.send_broadcast_message(greeting_message)
    
    async def teardown(self):
        """Cleanup before disconnection."""
        logger.info(f"Agent {self._agent_id} is shutting down...")
        
        # Send goodbye message
        goodbye_message = BroadcastMessage(
            sender_id=self._agent_id,
            protocol="openagents.protocols.communication.simple_messaging",
            content={"text": f"Goodbye from {self._agent_id}!"},
            text_representation=f"Goodbye from {self._agent_id}!",
            requires_response=False
        )
        await self.client.send_broadcast_message(goodbye_message)


def main():
    """Main function to run the simple agent."""
    # Create agent
    agent = SimpleAgent("simple-demo-agent")
    
    # Connection parameters (change these to match your network)
    host = "localhost"
    port = 8765
    
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