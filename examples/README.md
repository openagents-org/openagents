# OpenAgents Network Configuration Examples

This directory contains example configuration files for different OpenAgents network topologies.

## Available Examples

### Centralized Network

- **`centralized_network_config.yaml`** - Complete centralized network configuration with both server and client examples
- **`centralized_client_config.yaml`** - Standalone client configuration for connecting to a centralized network

### Decentralized Network

- **`decentralized_network_config.yaml`** - Decentralized P2P network configuration

### Agent Connection Examples

- **`connect_agent.py`** - Python script showing how to programmatically connect an agent to the network
- **`simple_agent.py`** - Example of a simple agent implementation (work in progress)

## Usage

### Setting up a Centralized Network

1. **Start the coordinator/server:**
   ```bash
   openagents launch-network examples/centralized_network_config.yaml
   ```

2. **Connect clients to the network:**
   ```bash
   # Edit centralized_client_config.yaml to set the correct coordinator_url
   openagents launch-network examples/centralized_client_config.yaml
   ```

3. **Connect with terminal console:**
   ```bash
   openagents connect --ip localhost --port 8765
   ```

4. **Connect programmatically:**
   ```bash
   # Edit the host/port in connect_agent.py then run:
   python examples/connect_agent.py
   ```

### Setting up a Decentralized Network

1. **Start the first node:**
   ```bash
   openagents launch-network examples/decentralized_network_config.yaml
   ```

2. **Start additional nodes:**
   ```bash
   # Edit the configuration to add bootstrap nodes
   openagents launch-network examples/decentralized_network_config.yaml
   ```

## Key Configuration Options

### Centralized Network

- **`mode: "centralized"`** - Use centralized topology
- **`server_mode: true`** - For coordinator/server nodes
- **`server_mode: false`** - For client nodes
- **`coordinator_url`** - WebSocket URL of the coordinator (required for clients)

### Decentralized Network

- **`mode: "decentralized"`** - Use decentralized P2P topology
- **`bootstrap_nodes`** - List of known peers to connect to
- **`transport: "websocket"`** - Currently implemented transport

## Common Settings

- **`transport`** - Transport type (websocket is fully implemented)
- **`protocols`** - List of protocols to enable
- **`service_agents`** - Optional service agents to run
- **`network_profile`** - Network discovery information
- **`encryption_enabled`** - Enable/disable encryption
- **`log_level`** - Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)

## Customization

To customize these configurations:

1. **Change network names** - Update the `name` field in the network section
2. **Modify ports** - Change the `port` field for different listening ports
3. **Add service agents** - Add your own service agents to the `service_agents` section
4. **Configure protocols** - Enable/disable protocols or modify their configurations
5. **Set security options** - Configure encryption and authentication settings

## Testing

After starting a network, you can test it by:

1. **Using the terminal console:**
   ```bash
   openagents connect --ip <host> --port <port>
   ```

2. **Available console commands:**
   - `/help` - Show available commands
   - `/agents` - List connected agents
   - `/dm <agent_id> <message>` - Send direct message
   - `/broadcast <message>` - Send broadcast message
   - `/protocols` - List available protocols
   - `/quit` - Disconnect from network

## Ways to Connect Agents

There are several ways to connect agents to an OpenAgents network:

### 1. Configuration File Method (Recommended)
Use YAML configuration files to define and launch agents:
```bash
openagents launch-network examples/centralized_client_config.yaml
```

### 2. Terminal Console Method
Interactive connection for testing and manual control:
```bash
openagents connect --ip localhost --port 8765
```

### 3. Programmatic Method
Connect agents using Python code:
```python
from openagents.core.client import AgentClient

client = AgentClient(agent_id="my-agent")
success = await client.connect_to_server(
    host="localhost",
    port=8765,
    metadata={"type": "demo_agent"}
)
```

### 4. Agent Runner Method
Use the AgentRunner base class for more sophisticated agents:
```python
from openagents.agents.runner import AgentRunner

class MyAgent(AgentRunner):
    async def react(self, message_threads, incoming_thread_id, incoming_message):
        # Handle incoming messages
        pass

agent = MyAgent("my-agent")
agent.start(host="localhost", port=8765)
```

## Troubleshooting

- **Connection issues:** Check that the coordinator URL is correct and the server is running
- **Port conflicts:** Change the port number if the default port is already in use
- **Firewall issues:** Ensure the necessary ports are open for incoming connections
- **Protocol errors:** Verify that all required protocols are enabled and properly configured

For more information, see the main OpenAgents documentation. 