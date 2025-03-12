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
        port=8767
    )
    
    # Signal that the server is about to start
    ready_event.set()
    
    # Start the server (this will block until the server is stopped)
    network.run(as_server=True)

@pytest.mark.asyncio
async def test_direct_agent_connection():
    """Test direct agent connection to a network server."""
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
        agent = Agent(name="TestDirectAgent")
        
        # Connect directly to the server
        connected = agent.connect_to_server("127.0.0.1", 8767)
        
        # Check that the connection was successful
        assert connected, "Failed to connect to the network server"
        
        # Verify that a network was automatically created
        assert agent.network is not None, "Network was not created for the agent"
        
    finally:
        # Clean up (the server thread will be terminated when the test exits)
        pass 