import asyncio
from openagents.core.network import AgentNetwork
from openagents.core.client import AgentClient  
from openagents.agents.simple_echo_agent import SimpleEchoAgentRunner
from openagents.models.messages import DirectMessage

# Global variable to store received messages
received_messages = []

async def handle_direct_message(message_data):
    """Handle incoming direct messages"""
    if hasattr(message_data, 'sender_id'):
        sender_id = message_data.sender_id
        content = message_data.content
        text = content.get("text", str(content)) if isinstance(content, dict) else str(content)
    else:
        sender_id = message_data.get("sender_id", "Unknown")
        content = message_data.get("content", {})
        text = content.get("text", str(content))
    
    print(f"📨 Received response from {sender_id}: {text}")
    received_messages.append({"from": sender_id, "text": text})

async def main():
    # Start network
    network = AgentNetwork.load("examples/centralized_network_config.yaml")
    await network.initialize()
    
    # Start agent
    agent = SimpleEchoAgentRunner("echo-agent", "Echo")
    await agent.async_start("localhost", 8570)
    
    # Start client and register message handler
    client = AgentClient("demo-client") 
    await client.connect("localhost", 8570)
    
    # Register the message handler to capture responses
    if client.connector:
        client.connector.register_message_handler("direct_message", handle_direct_message)
    
    # Send message
    msg = DirectMessage(sender_id="demo-client", target_agent_id="echo-agent", 
                       content={"text": "Hello!"})
    await client.send_direct_message(msg)
    print("📤 Sent: Hello!")
    
    # Wait for response
    await asyncio.sleep(2)
    
    # Display results
    print(f"\n📊 Received {len(received_messages)} responses:")
    for msg in received_messages:
        print(f"   🔄 {msg['from']}: {msg['text']}")
    
    # Cleanup
    await agent.async_stop()
    await client.disconnect() 
    await network.shutdown()

asyncio.run(main())