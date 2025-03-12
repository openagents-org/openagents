"""
Example demonstrating the use of the simple_messaging protocol in OpenAgents.

This example creates two agents that can send text messages and files to each other
using the simple_messaging protocol.

Usage:
    python examples/simple_messaging_example.py
"""

import asyncio
import logging
import os
import tempfile
from pathlib import Path
import inspect

from openagents.core.agent_adapter import AgentAdapter
from openagents.core.network import Network
from openagents.protocols.communication.simple_messaging.adapter import SimpleMessagingAgentAdapter
from openagents.protocols.communication.simple_messaging.protocol import SimpleMessagingNetworkProtocol

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Create a temporary file for testing file transfer
def create_test_file():
    temp_dir = tempfile.gettempdir()
    file_path = Path(temp_dir) / "test_message.txt"
    with open(file_path, "w") as f:
        f.write("This is a test file for the simple messaging protocol example.")
    return file_path

# Message handler for agents
def message_handler(content, sender_id):
    if "text" in content:
        print(f"Received message from {sender_id}: {content['text']}")

# File handler for agents
def file_handler(file_id, file_content, metadata, sender_id):
    print(f"Received file from {sender_id}: {file_id}")
    print(f"File content: {file_content[:50]}...")  # Show first 50 bytes

async def main():
    # Create and start the network server
    network = Network(
        network_name="SimpleMessagingExample",
        host="127.0.0.1",
        port=8765
    )
    
    # Register the simple messaging protocol with the network
    network.register_protocol(SimpleMessagingNetworkProtocol())
    
    # Start the network server
    network.start()
    print(f"Network server started on {network.host}:{network.port}")
    
    # Wait for the server to start
    await asyncio.sleep(1)
    
    # Create the first agent
    agent1 = AgentAdapter(agent_id="Agent1")
    
    # Create and register the simple messaging protocol adapter with the agent
    agent1_messaging = SimpleMessagingAgentAdapter()
    agent1.register_protocol_adapter(agent1_messaging)
    
    # Register message and file handlers
    agent1_messaging.register_message_handler("default", message_handler)
    agent1_messaging.register_file_handler("default", file_handler)
    
    # Connect the agent to the network
    await agent1.connect_to_server(
        host="127.0.0.1",
        port=8765,
        metadata={"name": "Agent 1"}
    )
    print(f"Agent1 connected to network")
    
    # Create the second agent
    agent2 = AgentAdapter(agent_id="Agent2")
    
    # Create and register the simple messaging protocol adapter with the agent
    agent2_messaging = SimpleMessagingAgentAdapter()
    agent2.register_protocol_adapter(agent2_messaging)
    
    # Register message and file handlers
    agent2_messaging.register_message_handler("default", message_handler)
    agent2_messaging.register_file_handler("default", file_handler)
    
    # Connect the agent to the network
    await agent2.connect_to_server(
        host="127.0.0.1",
        port=8765,
        metadata={"name": "Agent 2"}
    )
    print(f"Agent2 connected to network")
    
    # Wait for connections to establish
    await asyncio.sleep(1)
    
    # Send a direct text message from Agent1 to Agent2
    print("Sending text message from Agent1 to Agent2...")
    await agent1_messaging.send_text_message(
        target_agent_id="Agent2",
        text="Hello from Agent1!"
    )
    
    # Wait for message to be processed
    await asyncio.sleep(1)
    
    # Send a direct text message from Agent2 to Agent1
    print("Sending text message from Agent2 to Agent1...")
    await agent2_messaging.send_text_message(
        target_agent_id="Agent1",
        text="Hello back from Agent2!"
    )
    
    # Wait for message to be processed
    await asyncio.sleep(1)
    
    # Create a test file for file transfer
    test_file_path = create_test_file()
    print(f"Created test file at {test_file_path}")
    
    # Send a file from Agent1 to Agent2
    print("Sending file from Agent1 to Agent2...")
    await agent1_messaging.send_file(
        target_agent_id="Agent2",
        file_path=test_file_path,
        message_text="Here's a test file from Agent1"
    )
    
    # Wait for file to be processed
    await asyncio.sleep(2)
    
    # Broadcast a message from Agent1 to all agents
    print("Broadcasting message from Agent1...")
    await agent1_messaging.broadcast_text_message(
        text="Broadcast message from Agent1 to everyone!"
    )
    
    # Wait for broadcast to be processed
    await asyncio.sleep(1)
    
    # Clean up
    await agent1.disconnect()
    await agent2.disconnect()
    network.stop()
    print("Disconnected agents and stopped network")

if __name__ == "__main__":
    asyncio.run(main()) 