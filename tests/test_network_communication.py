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
        name="TestCommunicationNetwork",
        protocols=[MessagingProtocol()],
        server_mode=True,
        host="127.0.0.1",
        port=8768
    )
    
    # Signal that the server is about to start
    ready_event.set()
    
    # Start the server (this will block until the server is stopped)
    network.run(as_server=True)

@pytest.mark.asyncio
async def test_agent_communication():
    """Test communication between agents over the network."""
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
        # Create two client agents
        agent1 = Agent(name="TestAgent1")
        agent2 = Agent(name="TestAgent2")
        
        # Connect agents to the server
        connected1 = agent1.connect_to_server("127.0.0.1", 8768)
        connected2 = agent2.connect_to_server("127.0.0.1", 8768)
        
        # Check that the connections were successful
        assert connected1, "Agent1 failed to connect to the network server"
        assert connected2, "Agent2 failed to connect to the network server"
        
        # Set up a message received flag
        message_received = threading.Event()
        received_content = [None]  # Use a list to store the received content
        
        # Define a message handler for agent2
        async def message_handler(message):
            received_content[0] = message.get("content")
            message_received.set()
        
        # Register the message handler with agent2's network
        for protocol in agent2.network.protocols:
            if hasattr(protocol, "handle_remote_message"):
                protocol.on_message_received = message_handler
        
        # Send a message from agent1 to agent2
        test_message = {"text": "Hello from Agent1", "timestamp": time.time()}
        await agent1.send_message(agent2.agent_id, test_message)
        
        # Wait for the message to be received (with timeout)
        message_received.wait(timeout=5)
        
        # Verify the message was received correctly
        assert message_received.is_set(), "Message was not received"
        assert received_content[0] == test_message, "Received message content does not match sent content"
        
    finally:
        # Clean up (the server thread will be terminated when the test exits)
        pass 