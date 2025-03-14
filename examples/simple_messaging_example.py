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
import signal
import sys
import time

from openagents.core.client import AgentAdapter
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
        print(f"\n>>> Received message from {sender_id}: {content['text']}")

# File handler for agents
def file_handler(file_id, file_content, metadata, sender_id):
    print(f"\n>>> Received file from {sender_id}: {file_id}")
    print(f">>> File content: {file_content[:50]}...")  # Show first 50 bytes

async def setup_network():
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
    
    return network

async def setup_agent(agent_id, name):
    # Create the agent
    agent = AgentAdapter(agent_id=agent_id)
    
    # Create and register the simple messaging protocol adapter with the agent
    messaging = SimpleMessagingAgentAdapter()
    agent.register_protocol_adapter(messaging)
    
    # Register message and file handlers
    messaging.register_message_handler("default", message_handler)
    messaging.register_file_handler("default", file_handler)
    
    # Connect the agent to the network
    success = await agent.connect_to_server(
        host="127.0.0.1",
        port=8765,
        metadata={"name": name}
    )
    
    if success:
        print(f"{agent_id} connected to network")
    else:
        print(f"Failed to connect {agent_id} to network")
        return None, None
    
    return agent, messaging

async def run_example():
    # Set up the network
    network = await setup_network()
    
    # Set up the agents
    agent1, agent1_messaging = await setup_agent("Agent1", "Agent 1")
    if not agent1:
        network.stop()
        return
    
    agent2, agent2_messaging = await setup_agent("Agent2", "Agent 2")
    if not agent2:
        await agent1.disconnect()
        network.stop()
        return
    
    # Wait for connections to establish
    await asyncio.sleep(2)
    
    try:
        # Send a direct text message from Agent1 to Agent2
        print("\nSending text message from Agent1 to Agent2...")
        await agent1_messaging.send_text_message(
            target_agent_id="Agent2",
            text="Hello from Agent1!"
        )
        
        # Wait for message to be processed
        await asyncio.sleep(2)
        
        # Send a direct text message from Agent2 to Agent1
        print("\nSending text message from Agent2 to Agent1...")
        await agent2_messaging.send_text_message(
            target_agent_id="Agent1",
            text="Hello back from Agent2!"
        )
        
        # Wait for message to be processed
        await asyncio.sleep(2)
        
        # Create a test file for file transfer
        test_file_path = create_test_file()
        print(f"\nCreated test file at {test_file_path}")
        
        # Send a file from Agent1 to Agent2
        print("\nSending file from Agent1 to Agent2...")
        await agent1_messaging.send_file(
            target_agent_id="Agent2",
            file_path=test_file_path,
            message_text="Here's a test file from Agent1"
        )
        
        # Wait for file to be processed
        await asyncio.sleep(3)
        
        # Broadcast a message from Agent1 to all agents
        print("\nBroadcasting message from Agent1...")
        await agent1_messaging.broadcast_text_message(
            text="Broadcast message from Agent1 to everyone!"
        )
        
        # Wait for broadcast to be processed
        await asyncio.sleep(2)
        
        print("\nExample completed successfully! Press Ctrl+C to exit.")
        
        # Keep the connections open until user interrupts
        while True:
            await asyncio.sleep(1)
            
    except asyncio.CancelledError:
        print("Example interrupted by user.")
    finally:
        # Clean up
        print("\nCleaning up connections...")
        if agent1:
            await agent1.disconnect()
        if agent2:
            await agent2.disconnect()
        network.stop()
        print("Disconnected agents and stopped network")

def handle_interrupt(sig, frame):
    print("\nInterrupted by user. Shutting down...")
    sys.exit(0)

if __name__ == "__main__":
    # Register signal handler for clean shutdown
    signal.signal(signal.SIGINT, handle_interrupt)
    
    try:
        asyncio.run(run_example())
    except KeyboardInterrupt:
        print("\nExiting...")
    except Exception as e:
        print(f"Error: {e}") 