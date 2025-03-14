import asyncio
from openagents.core.network import AgentNetworkServer
from openagents.core.agent import Agent

async def run_example():
    # Start network server
    network = AgentNetworkServer(name="ExampleNetwork", host="127.0.0.1", port=8765)
    
    # Start server in background
    server_task = asyncio.create_task(network.run())
    
    # Create and connect agents
    agent1 = Agent(name="Agent1")
    agent2 = Agent(name="Agent2")
    
    # Connect agents to server
    await agent1.connect_to_server("127.0.0.1", 8765)
    await agent2.connect_to_server("127.0.0.1", 8765)
    
    # Send a message
    await agent1.send_message(agent2.agent_id, "Hello Agent2!")
    
    # Wait a bit
    await asyncio.sleep(5)
    
    # Clean up
    await agent1.disconnect()
    await agent2.disconnect()
    network.stop()

if __name__ == "__main__":
    asyncio.run(run_example()) 