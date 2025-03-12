import time
import asyncio
import threading
import json
from openagents.core.network import AgentNetwork
from openagents.core.agent import Agent
from openagents.protocols.communication.messaging.network_protocol import MessagingProtocol

def start_server():
    """Start a network server."""
    network = AgentNetwork(
        name="ExampleNetwork",
        protocols=[MessagingProtocol()],
        server_mode=True,
        host="0.0.0.0",  # Listen on all interfaces
        port=8765
    )
    
    print("Starting Agent Network Server...")
    network.run(as_server=True)

def run_sender(server_host, server_port, agent_name, target_name):
    """Run a sender agent."""
    # Create a sender agent
    agent = Agent(name=agent_name)
    
    # Connect to the server
    print(f"Connecting {agent_name} to server at {server_host}:{server_port}...")
    connected = agent.connect_to_server(server_host, server_port)
    
    if connected:
        print(f"Agent {agent_name} connected to the network server")
        
        # Send messages periodically
        try:
            message_count = 1
            while True:
                # Send a message
                message = {
                    "text": f"Message {message_count} from {agent_name}",
                    "timestamp": time.time()
                }
                
                asyncio.run(agent.send_message(target_name, message))
                print(f"Sent message to {target_name}: {message['text']}")
                
                message_count += 1
                time.sleep(5)  # Send a message every 5 seconds
                
        except KeyboardInterrupt:
            print(f"Agent {agent_name} disconnecting...")
            agent.disconnect_from_server()
    else:
        print(f"Agent {agent_name} failed to connect to the server")

def run_receiver(server_host, server_port, agent_name):
    """Run a receiver agent."""
    # Create a receiver agent
    agent = Agent(name=agent_name)
    
    # Set up message handler
    async def message_handler(message_data):
        if message_data.get("message_type") == "agent_message":
            source_id = message_data.get("source_agent_id")
            content = message_data.get("content")
            print(f"\nReceived message from {source_id}: {content['text']}")
    
    # Connect to the server
    print(f"Connecting {agent_name} to server at {server_host}:{server_port}...")
    connected = agent.connect_to_server(server_host, server_port)
    
    if connected:
        print(f"Agent {agent_name} connected to the network server")
        
        # Register message handler
        for protocol in agent.network.protocols:
            if hasattr(protocol, "handle_remote_message"):
                protocol.on_message_received = message_handler
        
        # Keep the receiver running
        try:
            print(f"Agent {agent_name} listening for messages...")
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print(f"Agent {agent_name} disconnecting...")
            agent.disconnect_from_server()
    else:
        print(f"Agent {agent_name} failed to connect to the server")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python network_communication.py server")
        print("  python network_communication.py sender <server_host> <server_port> <agent_name> <target_name>")
        print("  python network_communication.py receiver <server_host> <server_port> <agent_name>")
        sys.exit(1)
    
    mode = sys.argv[1]
    
    if mode == "server":
        start_server()
    elif mode == "sender":
        if len(sys.argv) < 6:
            print("Sender mode requires server_host, server_port, agent_name, and target_name")
            sys.exit(1)
        
        server_host = sys.argv[2]
        server_port = int(sys.argv[3])
        agent_name = sys.argv[4]
        target_name = sys.argv[5]
        
        run_sender(server_host, server_port, agent_name, target_name)
    elif mode == "receiver":
        if len(sys.argv) < 5:
            print("Receiver mode requires server_host, server_port, and agent_name")
            sys.exit(1)
        
        server_host = sys.argv[2]
        server_port = int(sys.argv[3])
        agent_name = sys.argv[4]
        
        run_receiver(server_host, server_port, agent_name)
    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1) 