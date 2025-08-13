# Agent Discovery Protocol

The Agent Discovery protocol enables agents to announce their capabilities to the network and for other agents to discover agents with specific capabilities.

## Features

- **Capability Announcement**: Agents can announce their capabilities to the network
- **Capability Discovery**: Agents can discover other agents with specific capabilities
- **Capability Updates**: Agents can update their capabilities as they change

## Components

- **AgentDiscoveryProtocol**: Network-level protocol that manages agent capabilities and handles discovery queries
- **AgentDiscoveryAdapter**: Agent-level adapter that allows agents to announce capabilities and discover other agents

## Usage

### Network Server

To enable agent discovery in your network server:

```python
from openagents.core.network import AgentNetworkServer
from openagents.protocols.discovery.agent_discovery import AgentDiscoveryProtocol

# Create network server
network = AgentNetworkServer("localhost:8570")

# Register agent discovery protocol
network.register_protocol(AgentDiscoveryProtocol())

# Start network server
await network.start()
```

### Agent Client

To use agent discovery in your agent:

```python
from openagents.core.client import AgentClient
from openagents.protocols.discovery.agent_discovery import AgentDiscoveryAdapter

# Create agent client
client = AgentClient("my_agent_id")

# Add agent discovery adapter
discovery_adapter = AgentDiscoveryAdapter()
client.add_protocol_adapter(discovery_adapter)

# Set agent capabilities
discovery_adapter.set_capabilities({
    "type": "service",
    "service_type": "text_generation",
    "language_models": ["gpt-4", "claude-3"],
    "max_tokens": 8192,
    "supports_streaming": True
})

# Connect to network
await client.connect("localhost:8570")
```

### Discovering Agents

To discover agents with specific capabilities:

```python
# Create a query for agents with specific capabilities
query = {
    "type": "service",
    "service_type": "text_generation",
    "language_models": "gpt-4"
}

# Discover agents matching the query
results = await discovery_adapter.discover_agents(query)

# Process results
for result in results:
    agent_id = result["agent_id"]
    capabilities = result["capabilities"]
    print(f"Found agent {agent_id} with capabilities: {capabilities}")
```

## Capability Matching

The agent discovery protocol uses a simple matching algorithm:

1. For each key-value pair in the query, the agent must have the same key with the same value
2. For nested dictionaries, each key-value pair in the nested dictionary must match
3. For arrays, the agent must have the exact array value (order matters)

## Example

See the `agent_discovery_example.py` file in the examples directory for a complete example of using the agent discovery protocol. 