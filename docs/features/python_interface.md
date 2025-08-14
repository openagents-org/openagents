# Python Interface

The OpenAgents Python interface provides a comprehensive API for building and connecting agents to OpenAgents networks. This document covers the core classes, message types, and usage patterns for developing agents programmatically.

## Table of Contents

- [Core Classes](#core-classes)
  - [AgentClient](#agentclient)
  - [AgentRunner](#agentrunner)
- [Message Types](#message-types)
  - [BaseMessage](#basemessage)
  - [DirectMessage](#directmessage)
  - [BroadcastMessage](#broadcastmessage)
  - [ModMessage](#modmessage)
- [Mod Adapters and Tools](#mod-adapters-and-tools)
  - [BaseModAdapter](#basemodoapter)
  - [AgentAdapterTool](#agentadaptertool)
- [Usage Examples](#usage-examples)
  - [Basic Agent Client](#basic-agent-client)
  - [Agent Runner Implementation](#agent-runner-implementation)
  - [Custom Mod Adapter](#custom-mod-adapter)
- [Connection Management](#connection-management)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Core Classes

### AgentClient

The `AgentClient` is the core class for connecting to OpenAgents networks and communicating with other agents.

#### Constructor

```python
from openagents.core.client import AgentClient

client = AgentClient(
    agent_id: Optional[str] = None,  # Auto-generated if not provided
    mod_adapters: Optional[List[BaseModAdapter]] = None
)
```

#### Connection Methods

##### `connect_to_server()`

Connect to a centralized OpenAgents network server.

```python
success = await client.connect_to_server(
    host: Optional[str] = None,
    port: Optional[int] = None,
    network_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    max_message_size: int = 104857600  # 10MB default
) -> bool
```

**Parameters:**
- `host`: Server hostname or IP address
- `port`: Server port number
- `network_id`: Network identifier (alternative to host/port)
- `metadata`: Agent metadata (name, capabilities, etc.)
- `max_message_size`: Maximum WebSocket message size in bytes

**Returns:** `True` if connection successful, `False` otherwise

##### `disconnect()`

Disconnect from the network server.

```python
success = await client.disconnect() -> bool
```

#### Messaging Methods

##### `send_direct_message()`

Send a direct message to a specific agent.

```python
await client.send_direct_message(message: DirectMessage)
```

##### `send_broadcast_message()`

Send a broadcast message to all agents in the network.

```python
await client.send_broadcast_message(message: BroadcastMessage)
```

##### `send_mod_message()`

Send a mod-specific message.

```python
await client.send_mod_message(message: ModMessage)
```

#### Network Discovery Methods

##### `list_agents()`

Get a list of all agents connected to the network.

```python
agents = await client.list_agents() -> List[Dict[str, Any]]
```

**Returns:** List of agent information dictionaries with keys like `agent_id`, `metadata`, etc.

##### `list_mods()`

Get a list of available mods from the network server.

```python
mods = await client.list_mods() -> List[Dict[str, Any]]
```

**Returns:** List of mod information dictionaries

##### `get_mod_manifest()`

Get the manifest for a specific mod.

```python
manifest = await client.get_mod_manifest(mod_name: str) -> Optional[Dict[str, Any]]
```

#### Mod Management Methods

##### `register_mod_adapter()`

Register a mod adapter with the agent.

```python
success = client.register_mod_adapter(mod_adapter: BaseModAdapter) -> bool
```

##### `unregister_mod_adapter()`

Unregister a mod adapter from the agent.

```python
success = client.unregister_mod_adapter(mod_name: str) -> bool
```

#### Tool Management Methods

##### `get_tools()`

Get all tools from registered mod adapters.

```python
tools = client.get_tools() -> List[AgentAdapterTool]
```

##### `get_messsage_threads()`

Get all message threads from registered mod adapters.

```python
threads = client.get_messsage_threads() -> Dict[str, MessageThread]
```

### AgentRunner

The `AgentRunner` is an abstract base class for implementing agents that automatically process incoming messages and manage their lifecycle.

#### Constructor

```python
from openagents.agents.runner import AgentRunner

class MyAgent(AgentRunner):
    def __init__(self):
        super().__init__(
            agent_id: Optional[str] = None,
            mod_names: Optional[List[str]] = None,
            mod_adapters: Optional[List[BaseModAdapter]] = None,
            client: Optional[AgentClient] = None,
            interval: Optional[int] = 1,  # Message check interval in seconds
            ignored_sender_ids: Optional[List[str]] = None
        )
```

#### Abstract Methods

##### `react()`

**Required implementation.** Called when a new message is received.

```python
async def react(
    self, 
    message_threads: Dict[str, MessageThread], 
    incoming_thread_id: str, 
    incoming_message: BaseMessage
):
    """React to an incoming message."""
    # Your message handling logic here
    pass
```

**Parameters:**
- `message_threads`: All available message threads at the time of the message
- `incoming_thread_id`: ID of the thread containing the new message
- `incoming_message`: The new message to process

#### Lifecycle Methods

##### `setup()`

Called after the agent connects to the network. Override for initialization logic.

```python
async def setup(self):
    """Setup the agent after connection."""
    print(f"Agent {self.client.agent_id} is ready!")
```

##### `teardown()`

Called before the agent disconnects. Override for cleanup logic.

```python
async def teardown(self):
    """Cleanup before disconnection."""
    print(f"Agent {self.client.agent_id} is shutting down...")
```

#### Control Methods

##### `start()`

Start the agent and connect to the network.

```python
agent.start(
    host: Optional[str] = None,
    port: Optional[int] = None,
    network_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None
)
```

##### `wait_for_stop()`

Block until the agent stops (typically via Ctrl+C).

```python
agent.wait_for_stop()
```

##### `stop()`

Stop the agent and disconnect from the network.

```python
agent.stop()
```

#### Properties

##### `client`

Access the underlying AgentClient.

```python
client = agent.client -> AgentClient
```

##### `tools`

Get available tools from mod adapters.

```python
tools = agent.tools -> List[AgentAdapterTool]
```

## Message Types

All message types inherit from `BaseMessage` and use Pydantic for validation.

### BaseMessage

Base class for all messages in the OpenAgents system.

```python
from openagents.models.messages import BaseMessage

class BaseMessage(BaseModel):
    message_id: str  # Auto-generated UUID
    timestamp: int   # Unix timestamp in milliseconds
    mod: Optional[str]  # Associated mod name
    message_type: str  # Message type identifier
    sender_id: str  # Agent ID of sender (required)
    metadata: Dict[str, Any]  # Additional metadata
    content: Dict[str, Any]  # Message content
    text_representation: Optional[str]  # Human-readable text
    requires_response: bool = False  # Whether response is expected
```

### DirectMessage

Message sent from one agent to another specific agent.

```python
from openagents.models.messages import DirectMessage

message = DirectMessage(
    sender_id="my-agent",
    target_agent_id="recipient-agent",
    protocol="openagents.mods.communication.simple_messaging",
    message_type="direct_message",
    content={"text": "Hello!"},
    text_representation="Hello!",
    requires_response=False
)
```

**Additional Fields:**
- `target_agent_id: str` - ID of the recipient agent

### BroadcastMessage

Message sent to all agents in the network.

```python
from openagents.models.messages import BroadcastMessage

message = BroadcastMessage(
    sender_id="my-agent",
    protocol="openagents.mods.communication.simple_messaging",
    message_type="broadcast_message",
    content={"text": "Hello everyone!"},
    text_representation="Hello everyone!",
    exclude_agent_ids=["agent-to-exclude"]  # Optional
)
```

**Additional Fields:**
- `exclude_agent_ids: List[str]` - List of agent IDs to exclude from broadcast

### ModMessage

Message for mod-specific communication and protocol handling.

```python
from openagents.models.messages import ModMessage

message = ModMessage(
    sender_id="my-agent",
    mod="openagents.mods.communication.simple_messaging",
    message_type="mod_message",
    direction="inbound",  # or "outbound"
    relevant_agent_id="target-agent",
    content={"action": "ping"}
)
```

**Additional Fields:**
- `mod: str` - Name of the mod handling this message
- `direction: str` - Message direction ("inbound" or "outbound")
- `relevant_agent_id: str` - Agent ID this message is relevant to

## Mod Adapters and Tools

### BaseModAdapter

Abstract base class for creating mod adapters that extend agent capabilities.

```python
from openagents.core.base_mod_adapter import BaseModAdapter

class MyModAdapter(BaseModAdapter):
    def __init__(self):
        super().__init__(mod_name="my_custom_mod")
    
    async def process_incoming_direct_message(self, message: DirectMessage) -> Optional[DirectMessage]:
        # Process incoming direct messages
        return message  # Return message to continue processing, None to stop
    
    async def process_outgoing_direct_message(self, message: DirectMessage) -> Optional[DirectMessage]:
        # Process outgoing direct messages
        return message
    
    # Similar methods for broadcast and mod messages...
    
    async def get_tools(self) -> List[AgentAdapterTool]:
        # Return tools provided by this mod
        return []
```

#### Key Methods

##### Message Processing

- `process_incoming_direct_message()` - Handle incoming direct messages
- `process_incoming_broadcast_message()` - Handle incoming broadcast messages  
- `process_incoming_mod_message()` - Handle incoming mod messages
- `process_outgoing_direct_message()` - Process outgoing direct messages
- `process_outgoing_broadcast_message()` - Process outgoing broadcast messages
- `process_outgoing_mod_message()` - Process outgoing mod messages

##### Lifecycle

- `initialize()` - Called when mod is registered
- `shutdown()` - Called when mod is unregistered
- `on_connect()` - Called when agent connects to network
- `on_disconnect()` - Called when agent disconnects

##### Message Threading

- `add_message_to_thread()` - Add a message to a conversation thread

### AgentAdapterTool

Represents a callable tool that agents can use.

```python
from openagents.models.tool import AgentAdapterTool

def my_function(param1: str, param2: int = 10) -> str:
    return f"Result: {param1} - {param2}"

tool = AgentAdapterTool(
    name="my_function",
    description="Example function that processes parameters",
    input_schema={
        "type": "object",
        "properties": {
            "param1": {"type": "string", "description": "First parameter"},
            "param2": {"type": "integer", "description": "Second parameter", "default": 10}
        },
        "required": ["param1"]
    },
    func=my_function
)

# Execute the tool
result = await tool.execute(param1="test", param2=20)
```

#### Methods

##### `execute()`

Execute the tool with provided parameters.

```python
result = await tool.execute(**kwargs) -> Any
```

##### `to_openai_function()`

Convert tool to OpenAI function calling format.

```python
openai_format = tool.to_openai_function() -> Dict[str, Any]
```

## Usage Examples

### Basic Agent Client

```python
import asyncio
from openagents.core.client import AgentClient
from openagents.models.messages import DirectMessage, BroadcastMessage

async def main():
    # Create and connect client
    client = AgentClient(agent_id="my-agent")
    
    # Connection metadata
    metadata = {
        "name": "My Agent",
        "type": "demo_agent",
        "capabilities": ["text_processing"],
        "version": "1.0.0"
    }
    
    # Connect to server
    success = await client.connect_to_server(
        host="localhost",
        port=8570,
        metadata=metadata
    )
    
    if success:
        print("Connected successfully!")
        
        # List other agents
        agents = await client.list_agents()
        print(f"Found {len(agents)} agents")
        
        # Send a broadcast message
        broadcast = BroadcastMessage(
            sender_id=client.agent_id,
            protocol="openagents.mods.communication.simple_messaging",
            message_type="broadcast_message",
            content={"text": "Hello everyone!"},
            text_representation="Hello everyone!"
        )
        await client.send_broadcast_message(broadcast)
        
        # Keep running
        await asyncio.sleep(10)
    
    # Disconnect
    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
```

### Agent Runner Implementation

```python
import asyncio
from typing import Dict
from openagents.agents.runner import AgentRunner
from openagents.models.messages import DirectMessage, BroadcastMessage, BaseMessage
from openagents.models.message_thread import MessageThread

class EchoAgent(AgentRunner):
    def __init__(self):
        super().__init__(agent_id="echo-agent")
        self.message_count = 0

    async def react(self, message_threads: Dict[str, MessageThread], 
                   incoming_thread_id: str, incoming_message: BaseMessage):
        """React to incoming messages by echoing them back."""
        self.message_count += 1
        sender_id = incoming_message.sender_id
        content = incoming_message.content
        text = content.get("text", str(content))
        
        print(f"Received message #{self.message_count} from {sender_id}: {text}")
        
        # Echo direct messages back to sender
        if isinstance(incoming_message, DirectMessage):
            echo_response = DirectMessage(
                sender_id=self.client.agent_id,
                target_agent_id=sender_id,
                protocol="openagents.mods.communication.simple_messaging",
                message_type="direct_message",
                content={"text": f"Echo: {text}"},
                text_representation=f"Echo: {text}"
            )
            await self.client.send_direct_message(echo_response)
            print(f"Sent echo response to {sender_id}")

    async def setup(self):
        """Setup after connection."""
        print(f"🚀 Echo agent {self.client.agent_id} connected and ready!")
        
        # Send greeting broadcast
        greeting = BroadcastMessage(
            sender_id=self.client.agent_id,
            protocol="openagents.mods.communication.simple_messaging",
            message_type="broadcast_message",
            content={"text": "Echo agent is online!"},
            text_representation="Echo agent is online!"
        )
        await self.client.send_broadcast_message(greeting)

    async def teardown(self):
        """Cleanup before shutdown."""
        print(f"Echo agent processed {self.message_count} messages. Goodbye!")

def main():
    agent = EchoAgent()
    
    # Agent metadata
    metadata = {
        "name": "Echo Agent",
        "type": "utility_agent",
        "capabilities": ["echo", "message_processing"],
        "version": "1.0.0"
    }
    
    try:
        # Start the agent
        agent.start(host="localhost", port=8570, metadata=metadata)
        
        # Wait until stopped
        agent.wait_for_stop()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        agent.stop()

if __name__ == "__main__":
    main()
```

### Custom Mod Adapter

```python
from typing import List, Optional
from openagents.core.base_mod_adapter import BaseModAdapter
from openagents.models.messages import DirectMessage, BroadcastMessage
from openagents.models.tool import AgentAdapterTool

class CalculatorModAdapter(BaseModAdapter):
    def __init__(self):
        super().__init__(mod_name="calculator_mod")
    
    async def process_incoming_direct_message(self, message: DirectMessage) -> Optional[DirectMessage]:
        """Process incoming direct messages for calculator commands."""
        content = message.content
        
        # Check if this is a calculation request
        if content.get("type") == "calculate":
            expression = content.get("expression")
            if expression:
                try:
                    # Simple calculator (be careful with eval in production!)
                    result = eval(expression)
                    
                    # Send result back
                    response = DirectMessage(
                        sender_id=self.agent_id,
                        target_agent_id=message.sender_id,
                        protocol="calculator_mod",
                        message_type="direct_message",
                        content={
                            "type": "calculation_result",
                            "expression": expression,
                            "result": result
                        },
                        text_representation=f"{expression} = {result}"
                    )
                    await self.connector.send_message(response)
                except Exception as e:
                    # Send error response
                    error_response = DirectMessage(
                        sender_id=self.agent_id,
                        target_agent_id=message.sender_id,
                        protocol="calculator_mod",
                        message_type="direct_message",
                        content={
                            "type": "calculation_error",
                            "expression": expression,
                            "error": str(e)
                        },
                        text_representation=f"Error calculating {expression}: {str(e)}"
                    )
                    await self.connector.send_message(error_response)
        
        return message  # Continue processing
    
    async def get_tools(self) -> List[AgentAdapterTool]:
        """Provide calculator tools."""
        
        def calculate(expression: str) -> float:
            """Calculate a mathematical expression."""
            return eval(expression)  # Use a safer evaluator in production
        
        calc_tool = AgentAdapterTool(
            name="calculate",
            description="Calculate a mathematical expression",
            input_schema={
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Mathematical expression to calculate"
                    }
                },
                "required": ["expression"]
            },
            func=calculate
        )
        
        return [calc_tool]

# Usage in an agent
class CalculatorAgent(AgentRunner):
    def __init__(self):
        calc_adapter = CalculatorModAdapter()
        super().__init__(
            agent_id="calculator-agent",
            mod_adapters=[calc_adapter]
        )
    
    async def react(self, message_threads: Dict[str, MessageThread], 
                   incoming_thread_id: str, incoming_message: BaseMessage):
        # The mod adapter handles calculation messages automatically
        # This method can handle other types of messages
        pass
```

## Connection Management

### Network Discovery

You can connect to networks using either direct host/port or network discovery:

```python
# Direct connection
await client.connect_to_server(host="localhost", port=8570)

# Network discovery (if configured)
await client.connect_to_server(network_id="my-network")
```

### Connection Parameters

- **Host/Port**: Direct server connection
- **Network ID**: Use network discovery service
- **Metadata**: Agent description and capabilities
- **Max Message Size**: WebSocket message size limit (default 10MB)

### Connection States

Monitor connection state through the client:

```python
if client.connector and client.connector.is_connected:
    print("Connected to network")
else:
    print("Not connected")
```

## Error Handling

### Connection Errors

```python
try:
    success = await client.connect_to_server(host="localhost", port=8570)
    if not success:
        print("Failed to connect to server")
        return
except Exception as e:
    print(f"Connection error: {e}")
```

### Message Sending Errors

```python
try:
    await client.send_direct_message(message)
except Exception as e:
    print(f"Failed to send message: {e}")
```

### Agent Runner Errors

```python
class RobustAgent(AgentRunner):
    async def react(self, message_threads, incoming_thread_id, incoming_message):
        try:
            # Your message processing logic
            pass
        except Exception as e:
            print(f"Error processing message: {e}")
            # Log error, send error response, etc.
```

## Best Practices

### 1. Agent Identification

Always provide meaningful agent IDs and metadata:

```python
metadata = {
    "name": "File Processor Agent",
    "type": "utility_agent",
    "capabilities": ["file_processing", "data_analysis"],
    "version": "2.1.0",
    "description": "Processes and analyzes various file formats"
}
```

### 2. Message Validation

Validate message content before processing:

```python
async def react(self, message_threads, incoming_thread_id, incoming_message):
    # Validate message structure
    if not incoming_message.content:
        return
    
    # Validate required fields
    if incoming_message.content.get("type") != "expected_type":
        return
    
    # Process the message
    await self.process_message(incoming_message)
```

### 3. Graceful Shutdown

Always implement proper shutdown handling:

```python
async def teardown(self):
    """Cleanup resources before shutdown."""
    # Save state
    self.save_state()
    
    # Send goodbye message
    goodbye = BroadcastMessage(
        sender_id=self.client.agent_id,
        protocol="openagents.mods.communication.simple_messaging",
        message_type="broadcast_message",
        content={"text": "Agent shutting down"},
        text_representation="Agent shutting down"
    )
    await self.client.send_broadcast_message(goodbye)
    
    # Close external connections
    await self.close_external_resources()
```

### 4. Error Recovery

Implement retry logic for network operations:

```python
async def send_with_retry(self, message, max_retries=3):
    for attempt in range(max_retries):
        try:
            await self.client.send_direct_message(message)
            return True
        except Exception as e:
            if attempt == max_retries - 1:
                print(f"Failed to send message after {max_retries} attempts: {e}")
                return False
            await asyncio.sleep(2 ** attempt)  # Exponential backoff
```

### 5. Message Threading

Use message threads for conversation context:

```python
async def react(self, message_threads, incoming_thread_id, incoming_message):
    # Get conversation context
    thread = message_threads.get(incoming_thread_id)
    if thread:
        previous_messages = thread.get_sorted_messages()
        context = [msg.text_representation for msg in previous_messages[-5:]]
        
        # Process with context
        response = self.generate_response(incoming_message, context)
        await self.send_response(response, incoming_message.sender_id)
```

### 6. Tool Integration

Organize tools logically in mod adapters:

```python
class UtilityModAdapter(BaseModAdapter):
    async def get_tools(self) -> List[AgentAdapterTool]:
        return [
            self.create_file_tool(),
            self.create_calculation_tool(),
            self.create_search_tool()
        ]
    
    def create_file_tool(self) -> AgentAdapterTool:
        def read_file(filename: str) -> str:
            with open(filename, 'r') as f:
                return f.read()
        
        return AgentAdapterTool(
            name="read_file",
            description="Read contents of a file",
            input_schema={
                "type": "object",
                "properties": {
                    "filename": {"type": "string", "description": "Path to file"}
                },
                "required": ["filename"]
            },
            func=read_file
        )
```

This comprehensive documentation covers the essential aspects of the OpenAgents Python interface. For more specific use cases or advanced features, refer to the examples directory and the API reference documentation.
