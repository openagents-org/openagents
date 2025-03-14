# OpenAgents Framework

A network-based multi-agent framework where agents connect to a central server for communication and coordination.

## Quick Start

1. Start a network server:
```python
from openagents.core.network import AgentNetworkServer

# Create and start server
network = AgentNetworkServer(host="127.0.0.1", port=8765)
network.run()
```

2. Connect agents to the server:
```python
from openagents.core.agent import Agent

# Create and connect agent
agent = Agent(name="MyAgent")
await agent.connect_to_server("127.0.0.1", 8765)

# Send messages to other agents
await agent.send_message("other_agent_id", "Hello!")
```

## Architecture

The framework uses a client-server architecture where:
- A central server manages all agent connections
- Agents connect to the server using WebSocket connections
- All communication between agents goes through the server
- Protocols define message handling behavior

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

