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

### Prerequisites

OpenAgents requires Python 3.8 or higher. The project uses modern async/await patterns throughout.

### Setting Up the Development Environment

#### Option 1: Using pyproject.toml (Recommended)

```bash
# Clone the repository
git clone https://github.com/openagents/openagents.git
cd openagents

# Install with all development dependencies
pip install -e ".[dev]"
```

#### Option 2: Using requirements file

```bash
# Install core package
pip install -e .

# Install test dependencies
pip install -r requirements-test.txt
```

#### Option 3: Using the setup script

```bash
# Run the automated setup and test script
python setup_tests.py
```

#### Option 4: Using Makefile

```bash
# Install dependencies and run tests
make install test

# Or run specific commands
make test-coverage    # Run tests with coverage
make test-fast       # Run tests in parallel
make all            # Full development workflow
```

### Running Tests

The project includes a comprehensive test suite covering all major components:

```bash
# Run all tests
pytest

# Run with verbose output
pytest -v

# Run specific test categories
pytest tests/test_network.py           # Core network tests
pytest tests/test_transport.py         # Transport layer tests
pytest tests/test_topology.py          # Topology tests
pytest tests/test_simple_messaging.py  # Protocol tests

# Run tests with coverage
pytest --cov=src/openagents --cov-report=html

# Run tests in parallel (faster)
pytest -n auto

# Run specific test patterns
pytest -k "network"                    # Tests matching "network"
pytest tests/ -m "not slow"            # Exclude slow tests
```

### Test Organization

The test suite includes:

- **Network Tests** (`test_network.py`) - Core network functionality, agent lifecycle, message routing
- **Transport Tests** (`test_transport.py`) - WebSocket transport, connection management  
- **Topology Tests** (`test_topology.py`) - Centralized/decentralized topologies, agent discovery
- **Protocol Tests** - Agent discovery, messaging protocols, protocol loading
- **Launcher Tests** (`test_network_launcher.py`) - Configuration loading, network startup

### Test Coverage

The project maintains >90% test coverage across core functionality:

```bash
# Generate coverage report
pytest --cov=src/openagents --cov-report=html
open htmlcov/index.html  # View detailed coverage report
```

### Continuous Integration

Tests run automatically on:
- Python 3.8, 3.9, 3.10, 3.11, 3.12
- Multiple operating systems (Linux, macOS, Windows)
- All pull requests and pushes to main branch

Current test status: **57 tests passing** with comprehensive coverage of all major components.

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

