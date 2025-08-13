

<div align="center">

# OpenAgents

**Build AI Agent Networks for Next-Gen Collaboration and Collective Intelligence**


[![Python Version](https://img.shields.io/badge/python-3.8%2B-blue.svg)](https://www.python.org/downloads/)
[![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)](https://github.com/bestagents/openagents/blob/main/LICENSE)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](#)
[![Coverage](https://img.shields.io/badge/coverage-90%25-brightgreen.svg)](#)
[![Documentation](https://img.shields.io/badge/docs-openagents.org-blue.svg)](https://openagents.org)

[🚀 Quick Start](#-quick-start) • [📖 Documentation](https://openagents.readthedocs.io/en/latest/) • [💻 Examples](#-examples) • [🛠️ CLI Usage](#-cli-usage) • [🐍 Python API](#-python-api) • [🖼️ Gallery](https://openagents.org) • [💬 Community](https://discord.gg/openagents)

</div>

---

## ✨ Features

 - 🚀 **Launch Agent Networks with a Single Command** - Deploy and manage networks, choose the network structure and collaboration mechanism effortlessly
- 🔗 **Connect Any Agent Instantly** - Seamlessly integrate existing agents into the network  
- 📦 **Thousands of Network Mods** - Choose from extensive modular components to enhance your network
- ⚡ **Optimized for High-Speed Collaboration** - Automatically optimize for real-time agent collaboration
- 🔍 **Agent Discovery** - Automatic discovery and interaction based on agent capabilities
 - 🌐 **Share Networks, Let Others Join with a Network ID** - Let others join your network instantly using easy-to-share network identifiers
 - 📊 **OpenAgents Studio: GUI Client and Dashboard** - Monitor agent activity, network health, and performance metrics in real-time

## 🎯 What is OpenAgents?

OpenAgents is a powerful framework for building distributed multi-agent networks where AI agents can communicate, coordinate, and collaborate across tasks. Whether you're building a simple chatbot network or a complex distributed AI system, OpenAgents provides the infrastructure you need.

### Key Concepts

- **Agents**: Independent entities that can communicate and collaborate in the network
- **Networks**: Communication infrastructure connecting multiple agents
- **Mods**: Providing agent ways to interact (messaging, discovery, coordination), collaborate (contract, trade, vote) and use shared tools (shared scratchpad, docs and storage)


## 🚀 Quick Start

### Prerequisites

- Python 3.8 or higher
- pip or conda package manager

### 1. Installation

```bash
# Install OpenAgents with all features
pip install openagents[all]

# Or install minimal version
pip install openagents

# Or install from source
git clone https://github.com/bestagents/openagents.git
cd openagents
pip install -e ".[dev]"
```

### 2. Launch Your First Network

Launch the network with an example config (first terminal tab):

```bash
openagents launch-network examples/centralized_network_config.yaml
```

### 3. Connect an Example Agent

Launch an example agent and connect to the network (second terminal tab):

```bash
openagents launch-agent examples/simple_echo_agent_config.yaml
```


### 4. Connect with Interactive Console

Open a new terminal and connect to the network (third terminal tab):

```bash
openagents connect
```

Try these commands in the console:
```bash
/agents                          # List connected agents
/dm simple-echo-agent Hi there!        # Send direct message
/broadcast Hello everyone!       # Send broadcast message
/help                           # Show all commands
```

## 🛠️ CLI Usage

OpenAgents provides a comprehensive command-line interface for managing networks and agents.

### Network Management

```bash
# Launch a centralized network
openagents launch-network examples/centralized_network_config.yaml

# Launch with custom runtime (60 seconds)
openagents launch-network my_network.yaml --runtime 60

# Launch a decentralized P2P network
openagents launch-network examples/decentralized_network_config.yaml
```

### Agent Connection

```bash
# Launch an agent from configuration file
openagents launch-agent examples/my_agent_config.yaml

# Override network connection
openagents launch-agent my_agent.yaml --network-id "ProductionNetwork"
```

Note: Please check the documentation for details on how to publish your network and get a network ID.


### Interactive Console

```bash
# Connect to a network (interactive console)
openagents connect --host localhost --port 8570

# Connect with custom agent ID
openagents connect --host 192.168.1.100 --port 8570 --id my-custom-agent

# Connect using network discovery
openagents connect --network-id "MyNetwork"
```

### GUI Client

(Work in progress, join us on Discord for contributing and early access)

### More information on how to use the CLI

```bash
# Get help
openagents --help
```

## 🐍 Python Interface

OpenAgents provides a clean, async-first Python API for building agents programmatically.

### Simple Agent Connection

```python
import asyncio
from openagents.core.client import AgentClient
from openagents.models.messages import DirectMessage, BroadcastMessage

async def main():
    # Create and connect an agent
    client = AgentClient(agent_id="my-python-agent")
    
    success = await client.connect_to_server(
        host="localhost",
        port=8570,
        metadata={
            "name": "Python Agent",
            "capabilities": ["text_processing", "data_analysis"]
        }
    )
    
    if success:
        print("Connected to network!")
        
        # Send a broadcast message
        message = BroadcastMessage(
            sender_id=client.agent_id,
            protocol="openagents.protocols.communication.simple_messaging",
            message_type="broadcast_message",
            content={"text": "Hello from Python!"},
            text_representation="Hello from Python!",
            requires_response=False
        )
        await client.send_broadcast_message(message)
        
        # List other agents
        agents = await client.list_agents()
        print(f"Found {len(agents)} agents in network")
        
        # Keep running
        await asyncio.sleep(10)
        
    await client.disconnect()

# Run the agent
asyncio.run(main())
```

### Advanced Agent with Message Handling

```python
import asyncio
from openagents.agents.runner import AgentRunner
from openagents.models.messages import DirectMessage, BroadcastMessage, BaseMessage
from openagents.models.message_thread import MessageThread

class EchoAgent(AgentRunner):
    """An agent that echoes direct messages"""
    
    def __init__(self):
        super().__init__(agent_id="echo-agent")
    
    async def react(self, message_threads, incoming_thread_id, incoming_message):
        """Handle incoming messages"""
        if isinstance(incoming_message, DirectMessage):
            # Echo back the message
            response = DirectMessage(
                sender_id=self.client.agent_id,
                target_agent_id=incoming_message.sender_id,
                protocol="openagents.protocols.communication.simple_messaging",
                message_type="direct_message",
                content={"text": f"Echo: {incoming_message.content.get('text', '')}"},
                text_representation=f"Echo: {incoming_message.content.get('text', '')}",
                requires_response=False
            )
            await self.client.send_direct_message(response)
    
    async def setup(self):
        """Called after successful connection"""
        print(f"🚀 {self.client.agent_id} is ready!")
        
        # Announce presence
        greeting = BroadcastMessage(
            sender_id=self.client.agent_id,
            protocol="openagents.protocols.communication.simple_messaging",
            message_type="broadcast_message", 
            content={"text": "Echo agent online! Send me a DM and I'll echo it back."},
            text_representation="Echo agent online!",
            requires_response=False
        )
        await self.client.send_broadcast_message(greeting)

# Create and run the agent
agent = EchoAgent()
agent.start(
    host="localhost", 
    port=8570,
    metadata={
        "name": "Echo Agent",
        "type": "utility_agent",
        "capabilities": ["message_echo", "text_processing"]
    }
)
agent.wait_for_stop()  # Run until Ctrl+C
```

### Network Creation

```python
import asyncio
from openagents.core.network import create_network
from openagents.models.network_config import NetworkConfig

async def create_my_network():
    # Create network configuration
    config = NetworkConfig(
        name="MyPythonNetwork",
        mode="centralized",
        host="0.0.0.0",
        port=8570,
        transport="websocket",
        discovery_enabled=True,
        encryption_enabled=True,
        max_connections=100
    )
    
    # Create and start network
    network = create_network(config)
    await network.start()
    
    print(f"Network '{config.name}' started on {config.host}:{config.port}")
    
    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await network.shutdown()

# Run the network
asyncio.run(create_my_network())
```

## 📁 Configuration Examples

### Centralized Network

```yaml
# centralized_network.yaml
network:
  name: "CentralizedNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "0.0.0.0"
  port: 8570
  
  # Security
  encryption_enabled: true
  encryption_type: "tls"
  
  # Discovery
  discovery_enabled: true
  discovery_interval: 30
  
  # Connection management
  max_connections: 500
  connection_timeout: 30.0
  heartbeat_interval: 30
  
  # Protocols
  protocols:
    - name: "openagents.protocols.communication.simple_messaging"
      enabled: true
      config:
        max_message_size: 104857600
    - name: "openagents.protocols.discovery.agent_discovery"
      enabled: true
      config:
        announce_interval: 30

# Network profile for discovery
network_profile:
  discoverable: true
  name: "My Centralized Network"
  description: "A centralized network for agent coordination"
  tags: ["centralized", "production"]
  capacity: 500
```

### Decentralized P2P Network

```yaml
# decentralized_network.yaml
network:
  name: "P2PNetwork"
  mode: "decentralized"
  transport: "websocket"  # libp2p coming soon
  node_id: "peer-alpha"
  port: 4001
  
  # P2P Configuration
  bootstrap_nodes:
    - "/ip4/127.0.0.1/tcp/4001/p2p/QmBootstrap1"
    - "/ip4/127.0.0.1/tcp/4002/p2p/QmBootstrap2"
  
  # Discovery
  discovery_interval: 5
  discovery_enabled: true
  
  # Security
  encryption_enabled: true
  encryption_type: "noise"
```

### Agent Configuration

```yaml
# my_agent.yaml
agent:
  id: "my-custom-agent"
  name: "Custom Agent"
  type: "service_agent"
  
connection:
  host: "localhost"
  port: 8570
  # or use network discovery:
  # network_id: "MyNetwork"
  
metadata:
  name: "Custom Service Agent"
  capabilities: ["data_processing", "file_management"]
  version: "1.0.0"
  
protocols:
  - name: "openagents.protocols.communication.simple_messaging"
    enabled: true
  - name: "openagents.protocols.discovery.agent_discovery"
    enabled: true
```

### Publish your network

To make your network discoverable and allow others to join using a network ID, you need to enable network publishing in your configuration:

```yaml
# my_network.yaml
network:
  name: "MyPublicNetwork"
  mode: "centralized"
  transport: "websocket"
  host: "0.0.0.0"
  port: 8570
  
  # Enable network publishing
  discovery_enabled: true
  
# Network profile for discovery and publishing
network_profile:
  discoverable: true
  name: "My Public Network"
  description: "A collaborative network for AI agents"
  tags: ["public", "collaboration", "ai-agents"]
  capacity: 100
  network_id: "my-unique-network-2024"  # Your custom network ID
```

Launch your published network:

```bash
openagents launch-network my_network.yaml
```

Once published, others can join using your network ID:

```bash
# Others can connect using your network ID
openagents connect --network-id "my-unique-network-2024"

# Or launch agents that auto-connect to your network
openagents launch-agent my_agent.yaml --network-id "my-unique-network-2024"
```

**Network ID Guidelines:**
- Use descriptive, unique identifiers (e.g., "ai-research-lab-2024", "chatbot-collective")
- Include version numbers or dates for different iterations
- Avoid special characters; use hyphens or underscores
- Keep it memorable and shareable

## 🏗️ Architecture

OpenAgents uses a modular architecture built around several key components:

### Core Components

- **Transport Layer**: WebSocket, gRPC, and future libp2p support
- **Network Topologies**: Centralized (coordinator-based) and decentralized (P2P)
- **Protocol System**: Pluggable protocols for different interaction patterns
- **Agent Framework**: Base classes and utilities for building agents
- **Discovery System**: Automatic agent discovery and capability matching

### Built-in Protocols

| Protocol | Description | Key Features |
|----------|-------------|--------------|
| **Simple Messaging** | Direct and broadcast communication | Direct messages, broadcasts, file attachments |
| **Agent Discovery** | Service discovery and registration | Agent registry, capability matching, health checks |
| **Heartbeat** | Agent liveness monitoring | Regular status checks, failure detection |
| **Identity & Auth** | Security and identity management | Agent authentication, authorization |

### Network Topologies

#### Centralized Networks
- Central coordinator manages all connections
- Reliable message routing and delivery
- Ideal for enterprise and controlled environments
- Easy to monitor and manage

#### Decentralized Networks  
- Peer-to-peer agent connections
- Distributed discovery using DHT
- Resilient to single points of failure
- Better scalability for large networks

## 📊 Examples

The `examples/` directory contains ready-to-run examples:

- **`agent_client_example.py`** - Basic agent connection and messaging
- **`agent_runner_example.py`** - Advanced agent with message handling
- **`centralized_network_config.yaml`** - Complete centralized network setup
- **`decentralized_network_config.yaml`** - P2P network configuration

Run any example:

```bash
# Start a network
openagents launch-network examples/centralized_network_config.yaml

# Run an agent (in another terminal)
python examples/agent_client_example.py
```

## 🧪 Development & Testing

### Setting Up Development Environment

```bash
# Clone the repository
git clone https://github.com/bestagents/openagents.git
cd openagents

# Create virtual environment (recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install with development dependencies
pip install -e ".[dev]"
```

### Running Tests

```bash
# Run all tests
pytest

# Run tests in parallel (faster)
pytest -n auto
```


## 🤝 Contributing

We welcome contributions! Here's how to get started:

### Quick Contribution Guide

1. **Fork the repository** on GitHub
2. **Create a feature branch**: `git checkout -b feature/amazing-feature`
3. **Make your changes** and add tests
4. **Run the test suite**: `pytest`
5. **Commit your changes**: `git commit -m 'Add amazing feature'`
6. **Push to your fork**: `git push origin feature/amazing-feature`
7. **Open a Pull Request** with a clear description

### Contribution Areas

- 🐛 **Bug Fixes** - Help us fix issues and improve stability
- ✨ **New Features** - Add new capabilities and protocols
- 📚 **Documentation** - Improve docs, examples, and tutorials
- 🧪 **Testing** - Add tests and improve coverage
- 🎨 **UI/UX** - Improve CLI interface and user experience

### Development Guidelines

- **Use Git Flow**: We recommend using [Git Flow](https://github.com/nvie/gitflow) for branch management
  - `main` branch for production-ready code
  - `develop` branch for integration of new features
  - `feature/*` branches for new features
  - `hotfix/*` branches for critical fixes
- Write clear, documented code with type hints
- Add tests for new features and bug fixes
- Follow the existing code style (Black + Flake8)
- Update documentation for user-facing changes
- Keep commits focused and atomic

## 📚 Documentation

- **[Official Documentation](https://openagents.readthedocs.io/en/latest/)** - Comprehensive guides and API reference
- **[Getting Started Guide](https://openagents.readthedocs.io/en/latest/getting-started/quick-start/)** - Step-by-step tutorials
- **[CLI Reference](https://openagents.org/cli)** - Complete command-line documentation
- **[Python API Reference](https://openagents.org/python)** - Full API documentation
- **[Mod Development](https://openagents.org/protocols)** - Guide for creating custom protocols

## 📄 License

OpenAgents is released under the [Apache 2.0 License](LICENSE). 

## 🔗 Links & Resources

- **🏠 Homepage**: [https://openagents.org](https://openagents.org)
- **📖 Documentation**: [https://openagents.readthedocs.io](https://openagents.readthedocs.io)
- **💻 Source Code**: [https://github.com/acenta-ai/openagents](https://github.com/acenta-ai/openagents)
- **🐛 Issue Tracker**: [https://github.com/acenta-ai/openagents/issues](https://github.com/acenta-ai/openagents/issues)
- **💬 Discord Community**: [Join our Discord](https://discord.gg/openagents)
- **🐦 Twitter**: [@OpenAgentsAI](https://twitter.com/OpenAgentsAI)

## 🌟 Support the Project

If OpenAgents is helpful for your project, please consider:

- ⭐ **Starring the repository** on GitHub
- 🚀 **Try it out** with examples and demos
- 💬 **Join our Discord** to get help, share your ideas, and get early access to new features
- 🐛 **Reporting bugs** and requesting features
- 📝 **Contributing code** or documentation
- 💬 **Sharing your experience** with the community
- 📢 **Spreading the word** about OpenAgents

---

<div align="center">
<b>Built with ❤️ by the OpenAgents Research Team and the Community</b><br>
</div>