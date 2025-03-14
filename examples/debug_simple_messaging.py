"""
Debugging example for the simple_messaging protocol in OpenAgents.

This example creates a minimal setup to debug the connection issues.

Usage:
    python examples/debug_simple_messaging.py
"""

import asyncio
import logging
import os
import tempfile
from pathlib import Path
import signal
import sys
import time

from openagents.core.client import AgentClient
from openagents.core.network import AgentNetworkServer
from openagents.protocols.communication.simple_messaging.adapter import SimpleMessagingAgentClient
from openagents.protocols.communication.simple_messaging.protocol import SimpleMessagingNetworkProtocol

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,  # Set to DEBUG for more detailed logs
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

# Message handler for agents
def message_handler(content, sender_id):
    print(f"\n>>> RECEIVED MESSAGE from {sender_id}: {content}")

async def debug_connector():
    print("Starting debug session...")
    
    # Create and start the network server
    network = AgentNetworkServer(
        network_name="DebugNetwork",
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
    agent1 = AgentClient(agent_id="Agent1")
    
    # Create and register the simple messaging protocol adapter with the agent
    agent1_messaging = SimpleMessagingAgentClient()
    agent1.register_protocol_adapter(agent1_messaging)
    
    # Register message handler
    agent1_messaging.register_message_handler("debug", message_handler)
    
    # Connect the agent to the network
    success = await agent1.connect_to_server(
        host="127.0.0.1",
        port=8765,
        metadata={"name": "Agent 1"}
    )
    
    if success:
        print(f"Agent1 connected to network")
        
        # Debug the connector
        print(f"Agent1 connector: {agent1.connector}")
        print(f"Agent1 messaging connector: {agent1_messaging.connector}")
        
        # Create the second agent
        agent2 = AgentClient(agent_id="Agent2")
        
        # Create and register the simple messaging protocol adapter with the agent
        agent2_messaging = SimpleMessagingAgentClient()
        agent2.register_protocol_adapter(agent2_messaging)
        
        # Register message handler
        agent2_messaging.register_message_handler("debug", message_handler)
        
        # Connect the agent to the network
        success = await agent2.connect_to_server(
            host="127.0.0.1",
            port=8765,
            metadata={"name": "Agent 2"}
        )
        
        if success:
            print(f"Agent2 connected to network")
            
            # Debug the connector
            print(f"Agent2 connector: {agent2.connector}")
            print(f"Agent2 messaging connector: {agent2_messaging.connector}")
            
            # Wait for connections to establish
            await asyncio.sleep(2)
            
            # Send a direct text message from Agent1 to Agent2
            print("\nSending text message from Agent1 to Agent2...")
            try:
                content = {"text": "Hello from Agent1!"}
                print(f"Creating DirectMessage with content: {content}")
                
                # Try to send the message
                await agent1_messaging.send_direct_message(
                    target_agent_id="Agent2",
                    content=content
                )
                print("Message sent successfully!")
                
                # Wait for message to be processed
                await asyncio.sleep(5)
                
                # Try sending a message from Agent2 to Agent1
                print("\nSending text message from Agent2 to Agent1...")
                content = {"text": "Hello back from Agent2!"}
                await agent2_messaging.send_direct_message(
                    target_agent_id="Agent1",
                    content=content
                )
                print("Reply message sent successfully!")
                
                # Wait for message to be processed
                await asyncio.sleep(5)
            except Exception as e:
                print(f"Error sending message: {e}")
                import traceback
                traceback.print_exc()
            
            # Clean up
            print("\nCleaning up connections...")
            await agent1.disconnect()
            await agent2.disconnect()
        else:
            print("Failed to connect Agent2 to network")
            await agent1.disconnect()
    else:
        print("Failed to connect Agent1 to network")
    
    network.stop()
    print("Disconnected agents and stopped network")

if __name__ == "__main__":
    try:
        asyncio.run(debug_connector())
    except KeyboardInterrupt:
        print("\nExiting...")
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc() 