# OpenAgents Framework

OpenAgents is a flexible and extensible Python framework for building multi-agent systems with customizable protocols. It allows developers to create networks of agents that can communicate and coordinate using various protocols.

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

## Installation

```bash
pip install openagents
```

## Quick Example

```python
from openagents.core.agent import Agent
from openagents.core.network import Network
from openagents.protocols.discovery import DiscoveryNetworkProtocol, DiscoveryAgentProtocol
from openagents.protocols.communication import CommunicationNetworkProtocol, CommunicationAgentProtocol

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

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](https://github.com/bestagents/openagents/blob/main/LICENSE) file for details. 