import time
from openagents.core.agent import Agent

def run_direct_client(server_host, server_port, agent_name):
    # Create a client agent
    agent = Agent(name=agent_name)
    
    # Connect directly to the server
    print(f"Connecting to server at {server_host}:{server_port}...")
    connected = agent.connect_to_server(server_host, server_port)
    
    if connected:
        print(f"Agent {agent_name} connected to the network server")
        # Keep the client running
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print(f"Agent {agent_name} disconnecting...")
            agent.disconnect_from_server()
    else:
        print(f"Agent {agent_name} failed to connect to the server")

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 4:
        print("Usage: python direct_agent_connection.py <server_host> <server_port> <agent_name>")
        sys.exit(1)
    
    server_host = sys.argv[1]
    server_port = int(sys.argv[2])
    agent_name = sys.argv[3]
    
    run_direct_client(server_host, server_port, agent_name) 