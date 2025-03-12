"""
Fixed example for the simple_messaging protocol in OpenAgents.

This example demonstrates how to use the simple messaging protocol to send messages and files between agents.

Usage:
    python examples/fixed_simple_messaging.py
"""

import asyncio
import logging
import os
import tempfile
import time
import signal
import sys
from pathlib import Path

from openagents.core.agent_adapter import AgentAdapter
from openagents.core.network import Network
from openagents.protocols.communication.simple_messaging.adapter import SimpleMessagingAgentAdapter
from openagents.protocols.communication.simple_messaging.protocol import SimpleMessagingNetworkProtocol

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Global variables
running = True

# Message handler for agents
def message_handler(content, sender_id):
    print(f"\n>>> RECEIVED MESSAGE from {sender_id}: {content}")

# File handler for agents
def file_handler(file_id, file_content, metadata, sender_id):
    print(f"\n>>> RECEIVED FILE from {sender_id}: {file_id}")
    print(f"    File size: {len(file_content)} bytes")
    print(f"    Metadata: {metadata}")

async def setup_network():
    """Set up and start the network server."""
    # Create and start the network server
    network = Network(
        network_name="SimpleMessagingNetwork",
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

async def setup_agent(agent_id, network_host, network_port):
    """Set up an agent with the simple messaging protocol."""
    # Create the agent
    agent = AgentAdapter(agent_id=agent_id)
    
    # Create and register the simple messaging protocol adapter with the agent
    messaging_adapter = SimpleMessagingAgentAdapter()
    agent.register_protocol_adapter(messaging_adapter)
    
    # Register message and file handlers
    messaging_adapter.register_message_handler("main", message_handler)
    messaging_adapter.register_file_handler("main", file_handler)
    
    # Connect the agent to the network
    success = await agent.connect_to_server(
        host=network_host,
        port=network_port,
        metadata={"name": agent_id}
    )
    
    if success:
        print(f"{agent_id} connected to network")
        return agent, messaging_adapter
    else:
        print(f"Failed to connect {agent_id} to network")
        return None, None

async def run_example():
    """Run the simple messaging example."""
    global running
    
    # Set up signal handlers for graceful shutdown
    def signal_handler(sig, frame):
        global running
        print("\nShutting down...")
        running = False
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Set up the network
    network = await setup_network()
    
    # Set up the agents
    agent1, agent1_messaging = await setup_agent("Agent1", network.host, network.port)
    if not agent1:
        network.stop()
        return
    
    agent2, agent2_messaging = await setup_agent("Agent2", network.host, network.port)
    if not agent2:
        await agent1.disconnect()
        network.stop()
        return
    
    # Wait for connections to establish
    await asyncio.sleep(2)
    
    # Create a temporary file for testing file transfer
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".txt")
    temp_file_path = temp_file.name
    with open(temp_file_path, "w") as f:
        f.write("This is a test file for the simple messaging protocol.")
    temp_file.close()
    
    try:
        # Send a direct text message from Agent1 to Agent2
        print("\nSending text message from Agent1 to Agent2...")
        await agent1_messaging.send_text_message(
            target_agent_id="Agent2",
            text="Hello from Agent1!"
        )
        print("Message sent successfully!")
        
        # Wait for message to be processed
        await asyncio.sleep(2)
        
        # Send a file from Agent1 to Agent2
        print("\nSending file from Agent1 to Agent2...")
        await agent1_messaging.send_file(
            target_agent_id="Agent2",
            file_path=temp_file_path,
            message_text="Here's a file from Agent1!"
        )
        print("File sent successfully!")
        
        # Wait for file to be processed
        await asyncio.sleep(2)
        
        # Send a broadcast message from Agent2
        print("\nSending broadcast message from Agent2...")
        await agent2_messaging.broadcast_text_message(
            text="Hello everyone from Agent2!"
        )
        print("Broadcast message sent successfully!")
        
        # Wait for broadcast to be processed
        await asyncio.sleep(2)
        
        # Send a reply from Agent2 to Agent1
        print("\nSending reply from Agent2 to Agent1...")
        await agent2_messaging.send_text_message(
            target_agent_id="Agent1",
            text="Thanks for the message and file, Agent1!"
        )
        print("Reply sent successfully!")
        
        # Wait for reply to be processed
        await asyncio.sleep(2)
        
        print("\nDemo completed successfully!")
        
        # Keep the connections open until interrupted
        print("\nPress Ctrl+C to exit...")
        while running:
            await asyncio.sleep(1)
            
    except Exception as e:
        print(f"Error in example: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Clean up
        print("\nCleaning up...")
        try:
            os.unlink(temp_file_path)
        except:
            pass
        
        await agent1.disconnect()
        await agent2.disconnect()
        network.stop()
        print("Disconnected agents and stopped network")

if __name__ == "__main__":
    try:
        asyncio.run(run_example())
    except KeyboardInterrupt:
        print("\nExiting...")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc() 