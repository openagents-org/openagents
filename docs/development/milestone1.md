# Milestone 1: Foundation Infrastructure (MVP)

This document describes the implementation of Milestone 1 for OpenAgents, which creates a minimal, protocol-agnostic framework to build and connect agent networks.

## Overview

Milestone 1 introduces a modular, extensible architecture that supports both centralized and decentralized network topologies with pluggable transport protocols.

## Key Features

### 🌐 Agent Networking Layer (Protocol Agnostic)

The new networking layer provides modular support for multiple transport protocols:

- **WebSocket** - Default transport for centralized networks
- **libp2p** - P2P transport for decentralized networks (placeholder)
- **gRPC** - Structured messaging transport (placeholder)
- **WebRTC** - Browser/native agent transport (placeholder)

#### Transport Interface

```python
from openagents.core.transport import Transport, TransportType, Message

# Create a WebSocket transport
transport = WebSocketTransport()
await transport.initialize()
await transport.listen("localhost:8570")

# Send a message
message = Message(
    sender_id="agent1",
    target_id="agent2",
    message_type="direct_message",
    payload={"content": "Hello!"},
    timestamp=time.time()
)
await transport.send(message)
```

### 🔄 Network Topology Abstraction

The `NetworkTopology` abstraction supports both centralized and decentralized modes:

#### Centralized Topology
- Uses a coordinator/registry server
- Agents register with central authority
- Message routing through coordinator
- Supports NATS for message brokering

#### Decentralized Topology  
- Peer-to-peer discovery using libp2p/mDNS
- Distributed hash table (DHT) for agent registry
- GossipSub for message broadcasting
- Bootstrap nodes for network joining

```python
from openagents.core.topology import create_topology, NetworkMode

# Create centralized topology
topology = create_topology(
    mode=NetworkMode.CENTRALIZED,
    node_id="coordinator",
    config={
        "server_mode": True,
        "host": "0.0.0.0",
        "port": 8570
    }
)

# Create decentralized topology
topology = create_topology(
    mode=NetworkMode.DECENTRALIZED,
    node_id="peer1",
    config={
        "bootstrap_nodes": ["/ip4/127.0.0.1/tcp/4001/p2p/QmBootstrap1"],
        "transport": "libp2p"
    }
)
```

### 📋 Agent Registration & Directory

Agents can register their capabilities and be discovered by others:

```python
from openagents.core.topology import AgentInfo
from openagents.core.transport import TransportType

# Register an agent
agent_info = AgentInfo(
    agent_id="my-agent",
    metadata={"name": "My Agent", "version": "1.0"},
    capabilities=["text-processing", "data-analysis"],
    last_seen=time.time(),
    transport_type=TransportType.WEBSOCKET,
    address="localhost:8570"
)

await topology.register_agent(agent_info)

# Discover agents with specific capabilities
agents = await topology.discover_peers(capabilities=["text-processing"])
```

### 🔐 Security Features

- **Encryption Support**: Noise protocol and TLS encryption
- **Transport Security**: End-to-end encryption for all messages
- **Authentication**: Configurable authentication mechanisms

### 📨 Enhanced Messaging Primitives

The messaging system supports:
- **Direct Messages**: Point-to-point communication
- **Broadcast Messages**: One-to-many communication  
- **Protocol Messages**: Protocol-specific messaging
- **Asynchronous Queuing**: Non-blocking message handling

## Configuration

Networks are configured using YAML files with extensive customization options:

```yaml
# Enhanced Network Configuration
network:
  name: "MyNetwork"
  mode: "decentralized"  # or "centralized"
  node_id: "agent-alpha"
  
  # Transport configuration
  transport: "websocket"  # libp2p, grpc, webrtc
  transport_config:
    buffer_size: 8192
    compression: true
  
  # Network topology
  host: "0.0.0.0"
  port: 4001
  bootstrap_nodes:
    - "/ip4/127.0.0.1/tcp/4001/p2p/QmNodeID1"
  
  # Security
  encryption_enabled: true
  encryption_type: "noise"
  
  # Discovery
  discovery_interval: 5
  discovery_enabled: true
  
  # Connection management
  max_connections: 100
  connection_timeout: 30.0
  retry_attempts: 3
  heartbeat_interval: 30
```

## CLI Usage

### Launch a Network

#### Enhanced Network (Milestone 1)
```bash
# Launch network with new architecture
openagents launch-network enhanced_network.yaml

# Launch for specific duration
openagents launch-network enhanced_network.yaml --runtime 3600
```

#### Legacy Network (Backward Compatibility)
```bash
# Launch legacy network (backward compatibility)
openagents launch-network --config network_config.yaml
```

### Configuration Templates

The system provides configuration templates for common use cases:

#### Centralized Server
```python
from openagents.models.network_config import create_centralized_server_config

config = create_centralized_server_config(
    network_name="CentralServer",
    host="0.0.0.0", 
    port=8570
)
```

#### Centralized Client
```python
config = create_centralized_client_config(
    network_name="CentralClient",
    coordinator_url="ws://localhost:8570"
)
```

#### Decentralized P2P
```python
config = create_decentralized_config(
    network_name="P2PNetwork",
    bootstrap_nodes=["/ip4/127.0.0.1/tcp/4001/p2p/QmBootstrap"],
    transport="libp2p"
)
```

## Architecture Components

### Core Modules

1. **`openagents.core.transport`** - Transport abstraction layer
2. **`openagents.core.topology`** - Network topology implementations  
3. **`openagents.core.network`** - Main network implementation
4. **`openagents.models.network_config`** - Configuration models
5. **`openagents.launchers.network_launcher`** - Network launcher (replaces legacy launcher)

### Transport Implementations

- **`WebSocketTransport`** - WebSocket-based transport (implemented)
- **`LibP2PTransport`** - libp2p-based transport (placeholder)
- **`GRPCTransport`** - gRPC-based transport (placeholder)
- **`WebRTCTransport`** - WebRTC-based transport (placeholder)

### Topology Implementations

- **`CentralizedTopology`** - Centralized network with coordinator
- **`DecentralizedTopology`** - P2P network with DHT and gossip

## Migration Guide

### From Legacy to Enhanced Networks

1. **Update Configuration**: Convert old config format to new enhanced format
2. **Use New CLI**: Use `--network-config` instead of `--config` 
3. **Update Imports**: Import from enhanced modules
4. **Protocol Updates**: Update protocol adapters for new message format

### Backward Compatibility

The system maintains backward compatibility with existing networks:
- Legacy configurations still work with `--config`
- Old network launcher remains functional
- Existing protocols continue to work

## Examples

See the `examples/` directory for sample configurations:
- `enhanced_network.yaml` - Full-featured network configuration
- `centralized_server.yaml` - Centralized server setup
- `decentralized_p2p.yaml` - P2P network setup

## Future Roadmap

### Milestone 2: Advanced Features
- Full libp2p integration
- gRPC and WebRTC transport implementations
- Advanced security features
- Performance optimizations

### Milestone 3: Production Ready
- Load balancing and scaling
- Monitoring and observability
- Advanced routing algorithms
- Production deployment tools

## Development

### Running Enhanced Networks

```bash
# Start a centralized coordinator
openagents launch-network --network-config examples/centralized_server.yaml

# Connect clients to coordinator  
openagents launch-network --network-config examples/centralized_client.yaml

# Start P2P network node
openagents launch-network --network-config examples/decentralized_p2p.yaml
```

### Testing

```bash
# Run enhanced network tests
python -m pytest tests/test_network.py

# Run transport tests
python -m pytest tests/test_transport.py

# Run topology tests  
python -m pytest tests/test_topology.py
```

## Contributing

When contributing to Milestone 1:

1. Follow the transport abstraction patterns
2. Implement topology interfaces correctly
3. Maintain backward compatibility
4. Add comprehensive tests
5. Update documentation

## Support

For issues with Milestone 1 implementation:
- Check the logs for detailed error messages
- Verify configuration syntax
- Ensure required dependencies are installed
- Consult this documentation for usage patterns 