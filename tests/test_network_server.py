import pytest
import asyncio
import threading
import time
from openagents.core.network import AgentNetwork
from openagents.core.agent import Agent
from openagents.protocols.communication.messaging.network_protocol import MessagingProtocol

def start_server(ready_event):
    """Start a network server in a separate thread."""
    network = AgentNetwork(
        name="TestServerNetwork",
        protocols=[MessagingProtocol()],
        server_mode=True,
        host="127.0.0.1",
        port=8766
    )
    
    # Signal that the server is about to start
    ready_event.set()
    
    # Start the server (this will block until the server is stopped)
    network.run(as_server=True)

@pytest.mark.asyncio
async def test_network_server_connection():
    """Test connecting to a network server."""
    # Create an event to signal when the server is ready
    ready_event = threading.Event()
    
    # Start the server in a separate thread
    server_thread = threading.Thread(target=start_server, args=(ready_event,))
    server_thread.daemon = True
    server_thread.start()
    
    # Wait for the server to be ready
    ready_event.wait()
    # Give the server a moment to start
    time.sleep(1)
    
    try:
        # Create a client agent
        agent = Agent(name="TestClientAgent")
        
        # Create a network for the client
        network = AgentNetwork(
            name="TestClientNetwork",
            protocols=[MessagingProtocol()]
        )
        
        # Add the agent to the network
        network.add_agent(agent)
        
        # Connect to the server
        connected = network.connect_to_server("127.0.0.1", 8766, agent.id)
        
        # Check that the connection was successful
        assert connected, "Failed to connect to the network server"
        
    finally:
        # Clean up (the server thread will be terminated when the test exits)
        pass 