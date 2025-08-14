# A Full Python Example

This guide demonstrates how to use OpenAgents with a complete, interactive Python example that showcases the full conversation workflow: network setup, agent creation, client interaction, message exchange, and cleanup.

## Overview

OpenAgents provides a clean, intuitive Python API for building agent networks. This example demonstrates:

1. **Network Creation** - Load and start a network from configuration
2. **Agent Deployment** - Start an echo agent that responds to messages  
3. **Client Interaction** - Connect a client and send messages to the agent
4. **Message Handling** - Capture and display agent responses in real-time
5. **Proper Cleanup** - Gracefully shutdown all components

## Complete Interactive Example

Here's a complete working example with real message exchange:

```python
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
```

## Step-by-Step Breakdown

### 1. Network Setup

```python
# Load network configuration from YAML file
network = AgentNetwork.load("examples/centralized_network_config.yaml")
await network.initialize()
```

**What this does:**
- Loads network configuration including protocols and mods
- Starts the network server on the configured host/port
- Automatically loads and registers network mods (messaging, discovery, etc.)

### 2. Agent Creation

```python
# Create and start an echo agent
agent = SimpleEchoAgentRunner("echo-agent", "Echo")
await agent.async_start("localhost", 8570)
```

**What this does:**
- Creates a simple echo agent with ID "echo-agent"
- Connects the agent to the network server
- Agent announces its presence and starts processing messages

### 3. Message Handler Setup

```python
# Global variable to store received messages
received_messages = []

async def handle_direct_message(message_data):
    """Handle incoming direct messages"""
    # Extract sender and message content (handles both dict and object formats)
    if hasattr(message_data, 'sender_id'):
        sender_id = message_data.sender_id
        content = message_data.content
        text = content.get("text", str(content)) if isinstance(content, dict) else str(content)
    else:
        sender_id = message_data.get("sender_id", "Unknown")
        content = message_data.get("content", {})
        text = content.get("text", str(content))
    
    # Display and store the message
    print(f"📨 Received response from {sender_id}: {text}")
    received_messages.append({"from": sender_id, "text": text})
```

**What this does:**
- Defines a handler function to process incoming messages
- Extracts sender ID and message content safely
- Displays messages in real-time as they arrive
- Stores messages for later summary

### 4. Client Interaction

```python
# Create client and register message handler
client = AgentClient("demo-client") 
await client.connect("localhost", 8570)

# Register the message handler to capture responses
if client.connector:
    client.connector.register_message_handler("direct_message", handle_direct_message)

# Send a direct message to the echo agent
msg = DirectMessage(
    sender_id="demo-client", 
    target_agent_id="echo-agent", 
    content={"text": "Hello!"}
)
await client.send_direct_message(msg)
print("📤 Sent: Hello!")

# Wait for response and display results
await asyncio.sleep(2)
print(f"\n📊 Received {len(received_messages)} responses:")
for msg in received_messages:
    print(f"   🔄 {msg['from']}: {msg['text']}")
```

**What this does:**
- Creates a client with ID "demo-client"
- Connects to the same network as the agent
- Registers the message handler to capture responses
- Sends a direct message to the echo agent
- Waits for the response and displays results
- Shows a summary of all received messages

### 5. Cleanup

```python
# Graceful shutdown
await agent.async_stop()
await client.disconnect() 
await network.shutdown()
```

**What this does:**
- Stops the agent and sends goodbye message
- Disconnects the client from the network
- Shuts down the network server cleanly

## Running the Example

1. **Save the code** to a file (e.g., `my_example.py`)

2. **Run it:**
   ```bash
   python my_example.py
   ```

3. **Expected output:**
   ```
   🚀 Echo agent echo-agent is ready!
   📤 Sent: Hello!
   📨 Received response from echo-agent: Echo: Hello!
   
   📊 Received 1 responses:
      🔄 echo-agent: Echo: Hello!
   ```

## Key API Methods

### Agent Methods
- `await agent.async_start(host, port)` - Start agent and connect to network
- `await agent.async_stop()` - Stop agent gracefully

### Client Methods  
- `await client.connect(host, port)` - Connect client to network
- `await client.disconnect()` - Disconnect client from network
- `await client.send_direct_message(message)` - Send message to specific agent
- `await client.send_broadcast_message(message)` - Send message to all agents
- `client.connector.register_message_handler(type, handler)` - Register handler for incoming messages

### Network Methods
- `network = AgentNetwork.load(config_path)` - Load network from YAML config
- `await network.initialize()` - Start the network server
- `await network.shutdown()` - Stop the network server

## Configuration Files

This example uses existing configuration files:

- **`examples/centralized_network_config.yaml`** - Network configuration
  - Defines network type, protocols, host/port settings
  - Automatically loads messaging and discovery protocols

## Advanced Examples

For more sophisticated examples with interactive demos and error handling, see:

- **`examples/full_example.py`** - Complete interactive demonstration (433 lines)
- **`examples/agent_runner_example.py`** - Custom agent implementation
- **`examples/agent_client_example.py`** - Advanced client usage

## Error Handling

For production use, add proper error handling:

```python
async def main():
    network = None
    agent = None
    client = None
    
    try:
        # Network setup
        network = AgentNetwork.load("examples/centralized_network_config.yaml")
        await network.initialize()
        
        # Agent setup
        agent = SimpleEchoAgentRunner("echo-agent", "Echo")
        await agent.async_start("localhost", 8570)
        
        # Client interaction
        client = AgentClient("demo-client")
        await client.connect("localhost", 8570)
        
        # Your application logic here...
        
    except Exception as e:
        print(f"Error: {e}")
        
    finally:
        # Always cleanup
        if agent:
            await agent.async_stop()
        if client:
            await client.disconnect()
        if network:
            await network.shutdown()
```

## Next Steps

1. **Explore Custom Agents** - Create your own agent by extending `AgentRunner`
2. **Add Multiple Agents** - Deploy multiple agents with different capabilities
3. **Implement Business Logic** - Build agents that perform specific tasks
4. **Scale Your Network** - Use distributed configurations for larger deployments

## Related Documentation

- [Python Interface](python_interface.md) - Complete API reference
- [Agent Identity Management](agent_identity_management.md) - Agent lifecycle
- [Connection Management](connection-management.md) - Network connectivity
- [Features Overview](features/README.md) - All OpenAgents features

---

This example demonstrates the power and simplicity of OpenAgents - a complete agent network in just 29 lines of clean, readable Python code!
