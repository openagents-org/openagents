# OpenAgents Architecture

This document describes the architecture of the OpenAgents framework, including its core components, design principles, and how they work together.

## Overview

OpenAgents is built on a modular, layered architecture that separates concerns and provides flexibility for different deployment scenarios. The framework supports both centralized and decentralized network topologies with pluggable transport protocols.

## Core Architectural Principles

1. **Protocol Agnostic**: Transport layer abstraction allows easy switching between WebSocket, libp2p, gRPC, and WebRTC
2. **Topology Flexible**: Support for both centralized and decentralized network architectures
3. **Configuration Driven**: YAML-based configuration for easy deployment and management
4. **Async First**: Built with asyncio for high-performance concurrent operations
5. **Type Safe**: Extensive use of type hints and Pydantic models for validation

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
│                (Agents, Protocols, CLI)                     │
├─────────────────────────────────────────────────────────────┤
│                    Network Layer                           │
│              (AgentNetwork, Configuration)                  │
├─────────────────────────────────────────────────────────────┤
│                   Topology Layer                           │
│          (Centralized, Decentralized Topologies)           │
├─────────────────────────────────────────────────────────────┤
│                   Transport Layer                          │
│            (WebSocket, libp2p, gRPC, WebRTC)              │
├─────────────────────────────────────────────────────────────┤
│                   Foundation Layer                         │
│              (Models, Utils, System Commands)              │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Transport Layer (`src/openagents/core/transport.py`)

The transport layer provides protocol-agnostic networking:

```python
class Transport(ABC):
    """Abstract base class for all transport implementations."""
    
    @abstractmethod
    async def initialize(self) -> bool:
        """Initialize the transport."""
        
    @abstractmethod
    async def send_message(self, message: Message) -> bool:
        """Send a message."""
        
    @abstractmethod
    async def listen(self, address: str) -> bool:
        """Start listening for connections."""
```

#### Transport Implementations

- **WebSocketTransport**: Fully implemented WebSocket transport
- **LibP2PTransport**: P2P transport (placeholder for future implementation)
- **GRPCTransport**: Structured messaging transport (placeholder)
- **WebRTCTransport**: Browser/native transport (placeholder)

### 2. Topology Layer (`src/openagents/core/topology.py`)

The topology layer manages network structure and agent discovery:

#### Centralized Topology
- Coordinator/registry server for agent management
- Centralized message routing and discovery
- HTTP/WebSocket registration with coordinator
- Ideal for enterprise and controlled environments

#### Decentralized Topology  
- Peer-to-peer discovery using libp2p/mDNS
- Distributed hash table (DHT) for agent registry
- GossipSub messaging for broadcast communications
- Bootstrap nodes for network joining

```python
class NetworkTopology(ABC):
    """Abstract base class for network topologies."""
    
    @abstractmethod
    async def register_agent(self, agent_info: AgentInfo) -> bool:
        """Register an agent with the topology."""
        
    @abstractmethod
    async def discover_agents(self, capabilities: List[str] = None) -> List[AgentInfo]:
        """Discover agents in the network."""
```

### 3. Network Layer (`src/openagents/core/network.py`)

The main network implementation that orchestrates transport and topology:

```python
class AgentNetwork:
    """Main network implementation using transport and topology abstractions."""
    
    def __init__(self, config: NetworkConfig):
        self.config = config
        self.topology = create_topology(config)
        self.transport = self.topology.transport
        
    async def initialize(self) -> bool:
        """Initialize the network."""
        
    async def register_agent(self, agent_id: str, capabilities: List[str] = None) -> AgentInfo:
        """Register an agent with the network."""
        
    async def send_message(self, sender_id: str, target_id: str, message_type: str, content: Dict[str, Any]) -> bool:
        """Send a message through the network."""
```

### 4. Configuration System (`src/openagents/models/network_config.py`)

YAML-based configuration with Pydantic validation:

```python
class NetworkConfig(BaseModel):
    """Network configuration model."""
    
    name: str
    mode: Union[NetworkMode, str] = NetworkMode.CENTRALIZED
    transport: Union[TransportType, str] = TransportType.WEBSOCKET
    host: str = "localhost"
    port: int = 8570
    encryption_enabled: bool = False
    discovery_enabled: bool = True
    # ... additional configuration options
```

### 5. Message System (`src/openagents/models/messages.py`)

Standardized message models for different communication patterns:

```python
class DirectMessage(BaseModel):
    """Direct message between two agents."""
    sender_id: str
    target_agent_id: str
    content: Dict[str, Any]
    metadata: Optional[Dict[str, Any]] = None

class BroadcastMessage(BaseModel):
    """Broadcast message to all agents."""
    sender_id: str
    content: Dict[str, Any]
    metadata: Optional[Dict[str, Any]] = None
```

## Data Flow

### Agent Registration Flow

```
Agent → Network.register_agent() → Topology.register_agent() → Transport.send_message()
                                          ↓
                                   Agent Registry Update
                                          ↓
                                   Network Discovery Update
```

### Message Routing Flow

```
Sender Agent → Network.send_message() → Topology.route_message() → Transport.send_message()
                                                    ↓
                                         Message Delivery Logic
                                         (Direct/Broadcast/Protocol)
                                                    ↓
                                           Target Agent(s)
```

### Network Discovery Flow

```
Agent Request → Network.discover_agents() → Topology.discover_agents() → Agent Registry Query
                                                        ↓
                                            Capability Filtering & Matching
                                                        ↓
                                                 Agent List Response
```

## Configuration Examples

### Centralized Network

```yaml
network:
  name: "ProductionNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "0.0.0.0"
  port: 8570
  encryption_enabled: true
  encryption_type: "tls"
  discovery_enabled: true
  max_connections: 1000
  connection_timeout: 30.0
  heartbeat_interval: 30
  retry_attempts: 3
```

### Decentralized Network

```yaml
network:
  name: "P2PNetwork"
  mode: "decentralized"
  transport: "websocket"  # libp2p when available
  node_id: "peer-alpha"
  port: 4001
  bootstrap_nodes:
    - "/ip4/bootstrap.openagents.org/tcp/4001/p2p/QmBootstrap"
  discovery_enabled: true
  discovery_interval: 10
  heartbeat_interval: 60
  max_connections: 50
```

## Security Architecture

### Transport Security
- TLS/SSL encryption for WebSocket transport
- Noise protocol support for libp2p transport
- Certificate-based authentication
- Configurable encryption algorithms

### Network Security
- Agent authentication and authorization
- Capability-based access control
- Message integrity verification
- Network-level access controls

### Configuration Security
- Secure credential storage
- Environment variable support
- Configuration validation
- Audit logging

## Extensibility Points

### Custom Transports
```python
class CustomTransport(Transport):
    """Custom transport implementation."""
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(TransportType.CUSTOM, config)
        
    async def initialize(self) -> bool:
        # Custom initialization logic
        pass
```

### Custom Topologies
```python
class CustomTopology(NetworkTopology):
    """Custom topology implementation."""
    
    async def initialize(self) -> bool:
        # Custom topology initialization
        pass
        
    async def register_agent(self, agent_info: AgentInfo) -> bool:
        # Custom agent registration logic
        pass
```

### Protocol Extensions
```python
class CustomProtocol(BaseProtocolAdapter):
    """Custom protocol implementation."""
    
    async def handle_message(self, message: Any) -> Any:
        # Custom message handling
        pass
```

## Performance Considerations

### Async Architecture
- Non-blocking I/O operations
- Concurrent message processing
- Connection pooling and reuse
- Efficient event loop utilization

### Scalability Features
- Configurable connection limits
- Load balancing support
- Horizontal scaling capabilities
- Resource monitoring and management

### Optimization Strategies
- Message batching and compression
- Connection keep-alive mechanisms
- Intelligent routing algorithms
- Caching and memoization

## Testing Architecture

### Test Organization
- Unit tests for individual components
- Integration tests for component interactions
- End-to-end tests for complete workflows
- Performance and load testing

### Test Coverage
- >90% code coverage across core modules
- Comprehensive error condition testing
- Mock-based isolation testing
- Async testing with pytest-asyncio

## Future Architecture Evolution

### Planned Enhancements
- Complete libp2p integration
- gRPC and WebRTC transport implementations
- Advanced security features
- Performance optimizations
- Monitoring and observability tools

### Extensibility Roadmap
- Plugin architecture for custom components
- Dynamic protocol loading
- Runtime configuration updates
- Advanced routing algorithms
- Multi-network federation

This architecture provides a solid foundation for building scalable, secure, and flexible multi-agent systems while maintaining simplicity and ease of use. 