import time
from openagents.core.network import AgentNetwork
from openagents.core.agent import Agent
from openagents.protocols.communication.messaging.network_protocol import MessagingProtocol

def run_server():
    # Create a network with server mode enabled
    network = AgentNetwork(
        name="AgentServerNetwork",
        protocols=[MessagingProtocol()],
        server_mode=True,
        host="0.0.0.0",  # Listen on all interfaces
        port=8765
    )
    
    # Start the server
    print("Starting Agent Network Server...")
    network.run(as_server=True)

def run_client(server_host, server_port, agent_name):
    # Create a client agent
    agent = Agent(name=agent_name)
    
    # Create a network for the client
    network = AgentNetwork(
        name=f"{agent_name}Network",
        protocols=[MessagingProtocol()]
    )
    
    # Add the agent to the network
    network.add_agent(agent)
    
    # Connect to the server
    print(f"Connecting to server at {server_host}:{server_port}...")
    connected = network.connect_to_server(server_host, server_port, agent.id)
    
    if connected:
        print(f"Agent {agent_name} connected to the network server")
        # Keep the client running
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print(f"Agent {agent_name} disconnecting...")
    else:
        print(f"Agent {agent_name} failed to connect to the server")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python agent_network_server.py server")
        print("  python agent_network_server.py client <server_host> <server_port> <agent_name>")
        sys.exit(1)
    
    mode = sys.argv[1]
    
    if mode == "server":
        run_server()
    elif mode == "client":
        if len(sys.argv) < 5:
            print("Client mode requires server_host, server_port, and agent_name")
            sys.exit(1)
        
        server_host = sys.argv[2]
        server_port = int(sys.argv[3])
        agent_name = sys.argv[4]
        
        run_client(server_host, server_port, agent_name)
    else:
        print(f"Unknown mode: {mode}")
        sys.exit(1) 