# OpenAgents Framework

OpenAgents is a flexible and extensible Python framework for building multi-agent systems with customizable protocols. It allows developers to create networks of agents that can communicate and coordinate using various protocols.


## Project Website

Visit our project website at [https://openagents.org](https://openagents.org) for more information, documentation, and resources.

## Overview

OpenAgents provides an engine for running a network with a set of protocols. The framework is designed to be modular, allowing developers to:

1. Create agents with any combination of protocols
2. Establish networks with specific protocol requirements
3. Contribute custom protocols that can be used by other developers

## Features

- **Modular Protocol System**: Mix and match protocols to create the exact agent network you need
- **Flexible Agent Architecture**: Agents can implement any combination of protocols
- **Customizable Communication Patterns**: Support for direct messaging, publish-subscribe, and more
- **Protocol Discovery**: Agents can discover and interact with other agents based on their capabilities
- **Extensible Framework**: Easy to add new protocols and extend existing ones

## Core Protocols

OpenAgents includes several built-in protocols:

| Protocol | Description | Key Features |
|----------|-------------|--------------|
| Discovery | Agent registration and service discovery | Agent registration/deregistration, Service announcement & discovery, Capability advertising |
| Communication | Message exchange between agents | Direct messaging, Publish-subscribe, Request-response patterns |
| Heartbeat | Agent liveness monitoring | Regular status checks, Network health detection |
| Identity & Authentication | Security and identity management | Agent identifiers, Authentication/authorization |
| Coordination | Task distribution and negotiation | Task negotiation & delegation, Contract-net protocol |
| Resource Management | Resource allocation and tracking | Resource allocation & accounting, Usage metering |

## Quick Start

### Installation

```bash
pip install openagents
```

### Creating a Simple Network

Here's a basic example of creating a network with two agents:

```python
from openagents.core.agent import Agent
from openagents.core.network import Network
from openagents.protocols.discovery.agent_registration.agent_protocol import DiscoveryAgentProtocol
from openagents.protocols.discovery.agent_registration.network_protocol import DiscoveryNetworkProtocol
from openagents.protocols.communication.messaging.agent_protocol import CommunicationAgentProtocol
from openagents.protocols.communication.messaging.network_protocol import CommunicationNetworkProtocol

# Create network
network = Network(name="MyNetwork")
network.register_protocol(DiscoveryNetworkProtocol())
network.register_protocol(CommunicationNetworkProtocol())
network.start()

# Create agents
agent1 = Agent(name="Agent1")
agent2 = Agent(name="Agent2")

# Register protocols
agent1.register_protocol(DiscoveryAgentProtocol(agent1.agent_id))
agent1.register_protocol(CommunicationAgentProtocol(agent1.agent_id))

agent2.register_protocol(DiscoveryAgentProtocol(agent2.agent_id))
agent2.register_protocol(CommunicationAgentProtocol(agent2.agent_id))

# Start agents and join network
agent1.start()
agent2.start()

agent1.join_network(network)
agent2.join_network(network)

# Send a message
agent1_comm = agent1.protocols["CommunicationAgentProtocol"]
agent1_comm.send_message(agent2.agent_id, {"content": "Hello, Agent2!"})
```

## Creating Custom Protocols

### Network Protocol

```python
from openagents.core.network_protocol_base import NetworkProtocolBase

class MyCustomNetworkProtocol(NetworkProtocolBase):
    def __init__(self, config=None):
        super().__init__(config)
        # Initialize protocol state
    
    def initialize(self) -> bool:
        # Protocol initialization logic
        return True
    
    def shutdown(self) -> bool:
        # Protocol shutdown logic
        return True
    
    @property
    def capabilities(self):
        return ["my-custom-capability"]
    
    def register_agent(self, agent_id, metadata):
        # Agent registration logic
        return True
    
    def unregister_agent(self, agent_id):
        # Agent unregistration logic
        return True
    
    def get_network_state(self):
        # Return current protocol state
        return {"status": "active"}
```

### Agent Protocol

```python
from openagents.core.agent_protocol_base import AgentProtocolBase

class MyCustomAgentProtocol(AgentProtocolBase):
    def __init__(self, agent_id, config=None):
        super().__init__(agent_id, config)
        # Initialize protocol state
    
    def initialize(self) -> bool:
        # Protocol initialization logic
        return True
    
    def shutdown(self) -> bool:
        # Protocol shutdown logic
        return True
    
    @property
    def capabilities(self):
        return ["my-custom-capability"]
    
    def handle_message(self, message):
        # Message handling logic
        return {"status": "received"}
    
    def get_agent_state(self):
        # Return current protocol state
        return {"status": "active"}
```

### Protocol Manifest

Each protocol should include a manifest file (protocol_manifest.json):

```json
    {
      "protocol_name": "my_custom_protocol",
      "version": "1.0.0",
      "description": "A custom protocol for specific functionality",
      "agent_protocol": true,
      "network_protocol": true,
      "dependencies": ["discovery"],
      "capabilities": ["my-custom-capability"],
      "authors": ["Your Name"],
      "license": "MIT"
    }
```

## Project Structure

```
    openagents/
    ├── core/
    │   ├── agent.py                      # Core agent implementation
    │   ├── network.py                    # Core network engine implementation
    │   ├── protocol_base.py              # Base class for all protocols
    │   ├── agent_protocol_base.py        # Base class for agent-level protocols
    │   └── network_protocol_base.py      # Base class for network-level protocols
    │
    ├── protocols/
    │   ├── discovery/                    # Discovery protocol implementation
    │   ├── communication/                # Communication protocol implementation
    │   ├── heartbeat/                    # Heartbeat protocol implementation
    │   └── ...                           # Other protocol implementations
    │
    ├── configs/                          # Configuration files
    ├── utils/                            # Utility functions
    ├── tests/                            # Test suite
    ├── docs/                             # Documentation
    └── examples/                         # Example implementations
```

## Contributing

We welcome contributions to the OpenAgents framework! Whether you want to fix bugs, add new features, or create new protocols, your help is appreciated.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Development and Testing

### Running Tests

You can run the test suite using pytest:

```bash
# Run all tests
pytest

# Run specific test files
pytest tests/test_discoverability.py tests/test_discovery_integration.py

# Run tests with coverage report
pytest --cov=src/openagents --cov-report=xml
```

### Continuous Integration

This project uses GitHub Actions for continuous integration testing. The workflow automatically runs pytest on Python versions 3.8, 3.9, 3.10, and 3.11 whenever code is pushed to the main, master, or develop branches, or when pull requests are made to these branches.

### Test Status

[![Python Tests](https://github.com/openagents/openagents/actions/workflows/pytest.yml/badge.svg)](https://github.com/openagents/openagents/actions/workflows/pytest.yml)

### Test Coverage

[![codecov](https://codecov.io/gh/openagents/openagents/branch/main/graph/badge.svg)](https://codecov.io/gh/openagents/openagents)

### Workflow Details

The CI workflow:
- Runs on multiple Python versions (3.8, 3.9, 3.10, 3.11)
- Installs all dependencies from requirements.txt
- Caches pip dependencies for faster runs
- Runs specific test files focused on discovery and discoverability
- Reports test coverage to Codecov

For more details, see the [workflow configuration file](.github/workflows/pytest.yml).

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/openagents/openagents.git
cd openagents

# Create and activate a virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install the package in development mode
pip install -e .

# Run an example
python examples/example_network.py
```

### Command Line Interface

OpenAgents provides a command-line interface for basic operations:

```bash
# Launch a network with a configuration file
openagents network launch config.json --runtime 3600

# Get help on available commands
openagents --help

# Set logging level
openagents --log-level DEBUG network launch config.json
```

The CLI is currently under development, with more commands planned for future releases. The configuration file should specify the network name, protocols, and other settings.

Example configuration file (config.json):
```json
{
  "name": "MyNetwork",
  "protocols": {
    "discovery": {},
    "communication": {}
  }
}
```

For more advanced usage, refer to the Python API examples above.

