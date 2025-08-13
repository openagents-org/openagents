# Quick Start Guide

This guide will help you get started with OpenAgents quickly. In just a few minutes, you'll have a running agent network!

## Prerequisites

- Python 3.8 or later
- Git (for cloning the repository)

## Step 1: Installation

Clone and install OpenAgents:

```bash
git clone https://github.com/bestagents/openagents.git
cd openagents
pip install -e ".[dev]"
```

## Step 2: Create Your First Network

### Centralized Network

Create a configuration file for a centralized network:

```bash
cat > my_network.yaml << EOF
network:
  name: "MyFirstNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "localhost"
  port: 8570
  discovery_enabled: true
  encryption_enabled: false
  max_connections: 50
EOF
```

Launch the network:

```bash
openagents launch-network my_network.yaml
```

You should see output like:
```
2024-01-01 10:00:00,000 - openagents.launchers.network_launcher - INFO - Network 'MyFirstNetwork' started successfully
2024-01-01 10:00:00,001 - openagents.launchers.network_launcher - INFO - Network mode: centralized
2024-01-01 10:00:00,002 - openagents.launchers.network_launcher - INFO - Transport: websocket
2024-01-01 10:00:00,003 - openagents.launchers.network_launcher - INFO - Host: localhost, Port: 8570
```

## Step 3: Connect with Terminal Console

Open a new terminal and connect to your network:

```bash
openagents connect --ip localhost --port 8570 --id my-agent
```

You should see:
```
Connecting to network server at localhost:8570...
Connected to network server as my-agent
Type your messages and press Enter to send.
Commands:
  /quit - Exit the console
  /dm <agent_id> <message> - Send a direct message
  /broadcast <message> - Send a broadcast message
  /agents - List connected agents
  /mods - List available mods
  /help - Show this help message
>
```

## Step 4: Try Basic Commands

In the console, try these commands:

```bash
# List connected agents
/agents

# Send a broadcast message
/broadcast Hello everyone!

# Get help
/help
```

## Step 5: Connect Multiple Agents

Open another terminal and connect a second agent:

```bash
openagents connect --ip localhost --port 8570 --id second-agent
```

Now you can:
- Send direct messages between agents: `/dm second-agent Hello there!`
- Send broadcast messages that all agents receive: `/broadcast This is a broadcast!`
- List all connected agents: `/agents`

## Step 6: Try a Decentralized Network

Stop the current network (Ctrl+C) and try a decentralized configuration:

```bash
cat > p2p_network.yaml << EOF
network:
  name: "P2PNetwork"
  mode: "decentralized"
  transport: "websocket"  # Will use libp2p when available
  node_id: "peer-alpha"
  port: 4001
  discovery_enabled: true
  discovery_interval: 5
  heartbeat_interval: 30
EOF
```

Launch the P2P network:

```bash
openagents launch-network p2p_network.yaml
```

## Using the Programming API

You can also create networks programmatically:

```python
import asyncio
from openagents.core.network import create_network
from openagents.models.network_config import NetworkConfig

async def main():
    # Create network configuration
    config = NetworkConfig(
        name="ProgrammaticNetwork",
        mode="centralized",
        transport="websocket",
        host="localhost",
        port=8766
    )
    
    # Create and initialize network
    network = create_network(config)
    await network.initialize()
    
    print(f"Network '{network.network_name}' is running!")
    
    # Keep running
    try:
        while network.is_running:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await network.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
```

Save this as `my_network.py` and run:

```bash
python my_network.py
```

## What's Next?

Now that you have OpenAgents running, you can:

### 1. Explore Configuration Options

Learn about all the configuration options available:
- Transport types (WebSocket, libp2p, gRPC, WebRTC)
- Network modes (centralized vs decentralized)
- Security settings (encryption, authentication)
- Discovery and connection management

### 2. Build Custom Agents

Create agents that can:
- Join networks automatically
- Handle different message types
- Implement custom mods
- Provide specific capabilities

### 3. Set Up Production Networks

Configure networks for production use:
- Enable encryption and authentication
- Set up proper logging and monitoring
- Configure network discovery
- Implement agent lifecycle management

### 4. Advanced Features

Explore advanced OpenAgents features:
- Mod development
- Custom transport implementations
- Agent discovery and capabilities
- Network topology optimization

## Example Configurations

### Secure Centralized Network

```yaml
network:
  name: "SecureNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "0.0.0.0"
  port: 8570
  encryption_enabled: true
  encryption_type: "tls"
  discovery_enabled: true
  max_connections: 100
  connection_timeout: 30.0
  heartbeat_interval: 30
```

### P2P Development Network

```yaml
network:
  name: "DevP2P"
  mode: "decentralized"
  transport: "websocket"
  node_id: "dev-node-1"
  port: 4001
  bootstrap_nodes:
    - "/ip4/127.0.0.1/tcp/4001/p2p/QmBootstrap"
  discovery_enabled: true
  discovery_interval: 10
  max_connections: 20
```

## Troubleshooting

### Network Won't Start
- Check if the port is already in use
- Verify the configuration file syntax
- Make sure you have the required dependencies

### Can't Connect to Network
- Ensure the network is running
- Check the IP address and port
- Verify firewall settings

### Tests Failing
```bash
# Run tests to verify installation
pytest tests/test_network.py -v

# Check specific functionality
python -c "from openagents.core.network import create_network; print('✓ Network module working')"
```

## Getting Help

- Check the [full documentation](../index.md)
- Look at [example configurations](../../examples/)
- Run `openagents --help` for CLI reference
- Explore the [test suite](../../tests/) for usage patterns

Congratulations! You now have a working OpenAgents setup. Happy building! 🚀 