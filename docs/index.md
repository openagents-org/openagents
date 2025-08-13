# OpenAgents Framework

OpenAgents is a flexible and extensible Python framework for building multi-agent systems with customizable mods and network topologies. It provides a modern, async-first architecture that supports both centralized and decentralized agent networks.

## Overview

OpenAgents enables developers to create sophisticated multi-agent systems with:

1. **Flexible Network Topologies**: Support for both centralized and decentralized network architectures
2. **Mod-Agnostic Transport**: Pluggable transport layer supporting WebSocket, libp2p, gRPC, and WebRTC
3. **Configuration-Driven Deployment**: YAML-based configuration for easy network setup and management
4. **Modern Async Architecture**: Built with asyncio for high-performance concurrent operations
5. **Comprehensive Testing**: Well-tested framework with >90% test coverage

## Key Features

- **Multi-Transport Support**: WebSocket (implemented), libp2p, gRPC, and WebRTC transport mods
- **Network Topologies**: Centralized coordinator/registry and decentralized P2P topologies
- **Agent Discovery**: Capability-based agent discovery and service announcement
- **Message Routing**: Direct messaging, broadcast messaging, and mod-specific routing
- **Security Foundation**: Encryption support, authentication framework, and secure communications
- **Developer Tools**: CLI interface, terminal console, and comprehensive configuration system

## Architecture Components

### Core Modules

| Component | Description |
|-----------|-------------|
| **Transport Layer** | Mod-agnostic networking with WebSocket, libp2p, gRPC, WebRTC support |
| **Network Topology** | Centralized and decentralized network management |
| **Agent Network** | Main network implementation with configuration-driven topology selection |
| **Configuration System** | YAML-based configuration with validation and templates |
| **CLI Interface** | Command-line tools for network and agent management |

### Network Topologies

#### Centralized Networks
- Coordinator/registry server for agent management
- Centralized message routing and discovery
- Ideal for controlled environments and enterprise deployments

#### Decentralized Networks  
- Peer-to-peer discovery using libp2p/mDNS
- Distributed hash table (DHT) for agent registry
- GossipSub messaging for broadcast communications

## Quick Start

### Installation

```bash
# Install OpenAgents
pip install -e ".[dev]"

# Or install minimal version
pip install -e .
```

### Launch a Network

```bash
# Create a network configuration
cat > network_config.yaml << EOF
network:
  name: "MyNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "localhost"
  port: 8570
  discovery_enabled: true
EOF

# Launch the network
openagents launch-network network_config.yaml
```

### Connect with Terminal Console

```bash
# Connect to the network
openagents connect --ip localhost --port 8570 --id my-console
```

### Network Configuration Examples

#### Centralized Network
```yaml
network:
  name: "CentralizedNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "0.0.0.0"
  port: 8570
  encryption_enabled: true
  discovery_enabled: true
  max_connections: 100
```

#### Decentralized Network
```yaml
network:
  name: "P2PNetwork" 
  mode: "decentralized"
  transport: "websocket"  # libp2p when available
  node_id: "peer-alpha"
  port: 4001
  bootstrap_nodes:
    - "/ip4/127.0.0.1/tcp/4001/p2p/QmBootstrap"
  discovery_interval: 5
```

## CLI Commands

```bash
# Launch a network
openagents launch-network <config.yaml> [--runtime <seconds>]

# Connect to network (interactive console)
openagents connect --ip <host> --port <port> [--id <agent_id>]

# Launch an agent from configuration
openagents launch-agent <agent_config.yaml>

# Show help
openagents --help
```

## Programming API

```python
from openagents.core.network import create_network
from openagents.models.network_config import NetworkConfig

# Create network from configuration
config = NetworkConfig(
    name="MyNetwork",
    mode="centralized",
    transport="websocket",
    host="localhost",
    port=8570
)

network = create_network(config)
await network.initialize()

# Register an agent
agent_info = await network.register_agent(
    agent_id="agent1",
    capabilities=["chat", "file_transfer"]
)

# Send a message
await network.send_message(
    sender_id="agent1",
    target_id="agent2", 
    message_type="direct_message",
    content={"text": "Hello!"}
)
```

## Development and Testing

### Running Tests

```bash
# Install development dependencies
pip install -e ".[dev]"

# Run all tests
pytest

# Run with coverage
pytest --cov=src/openagents --cov-report=html

# Run specific test categories
pytest tests/test_network.py     # Core network tests
pytest tests/test_transport.py   # Transport layer tests
pytest tests/test_topology.py    # Topology tests
```

### Current Test Status
- **Total Tests**: 57
- **Passing**: 56 (98.2%)
- **Coverage**: >90% of core functionality

## Project Structure

```
openagents/
├── src/openagents/
│   ├── core/                 # Core framework components
│   │   ├── network.py        # Main network implementation
│   │   ├── transport.py      # Transport abstraction layer
│   │   ├── topology.py       # Network topology implementations
│   │   └── client.py         # Agent client implementation
│   ├── models/               # Data models and configuration
│   │   ├── network_config.py # Network configuration models
│   │   ├── transport.py      # Transport models
│   │   └── messages.py       # Message models
│   ├── launchers/            # Network and agent launchers
│   │   ├── network_launcher.py
│   │   └── terminal_console.py
│   ├── mods/            # Mod implementations
│   └── utils/                # Utility functions
├── tests/                    # Comprehensive test suite
├── examples/                 # Example configurations
└── docs/                     # Documentation
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Install development dependencies: `pip install -e ".[dev]"`
4. Make your changes and add tests
5. Run the test suite: `pytest`
6. Submit a pull request

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](https://github.com/bestagents/openagents/blob/main/LICENSE) file for details. 