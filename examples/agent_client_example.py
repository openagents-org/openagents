#!/usr/bin/env python3
"""
Example: Programmatically connect an agent to a centralized OpenAgents network

This script demonstrates how to connect an agent to a centralized network using the Python API.
"""

import asyncio
import logging
from openagents.core.client import AgentClient
from openagents.models.messages import DirectMessage, BroadcastMessage

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    """Main function to demonstrate agent connection."""
    
    # Create an agent client
    agent_id = "example-agent-1"
    client = AgentClient(agent_id=agent_id)
    
    # Connection parameters
    host = "localhost"  # Change to your server's IP
    port = 8570         # Change to your server's port
    
    # Agent metadata
    metadata = {
        "name": "Example Agent",
        "type": "demo_agent",
        "capabilities": ["text_processing", "task_execution"],
        "version": "1.0.0"
    }
    
    try:
        # Connect to the centralized network
        print(f"Connecting agent {agent_id} to network at {host}:{port}...")
        
        success = await client.connect_to_server(
            host=host,
            port=port,
            metadata=metadata
        )
        
        if not success:
            print("Failed to connect to network")
            return
        
        print(f"Successfully connected agent {agent_id} to network!")
        
        # Register message handlers
        if client.connector:
            client.connector.register_message_handler("direct_message", handle_direct_message)
            client.connector.register_message_handler("broadcast_message", handle_broadcast_message)
        
        # List other agents in the network
        print("Discovering other agents...")
        agents = await client.list_agents()
        print(f"Found {len(agents)} agents in the network:")
        for agent in agents:
            print(f"  - {agent.get('agent_id', 'Unknown')}: {agent.get('metadata', {})}")
        
        # Send a broadcast message
        print("Sending broadcast message...")
        broadcast_msg = BroadcastMessage(
            sender_id=agent_id,
            protocol="openagents.mods.communication.simple_messaging",
            message_type="broadcast_message",
            content={"text": "Hello from programmatically connected agent!"},
            text_representation="Hello from programmatically connected agent!",
            requires_response=False
        )
        
        await client.send_broadcast_message(broadcast_msg)
        print("Broadcast message sent!")
        
        # Wait for messages (keeps the agent running)
        print("Agent is running. Press Ctrl+C to stop...")
        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            print("\nShutting down agent...")
        
    except Exception as e:
        logger.error(f"Error: {e}")
    finally:
        # Disconnect from network
        if client.connector:
            await client.disconnect()
        print("Agent disconnected")


async def handle_direct_message(message_data):
    """Handle incoming direct messages."""
    print(f"Received direct message: {message_data}")
    
    # Extract message content
    sender_id = message_data.get("sender_id", "Unknown")
    content = message_data.get("content", {})
    text = content.get("text", str(content))
    
    print(f"Direct message from {sender_id}: {text}")


async def handle_broadcast_message(message_data):
    """Handle incoming broadcast messages."""
    print(f"Received broadcast message: {message_data}")
    
    # Extract message content
    sender_id = message_data.get("sender_id", "Unknown")
    content = message_data.get("content", {})
    text = content.get("text", str(content))
    
    print(f"Broadcast message from {sender_id}: {text}")


if __name__ == "__main__":
    asyncio.run(main()) 