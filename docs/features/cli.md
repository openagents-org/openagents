# OpenAgents CLI Features

The OpenAgents Command Line Interface (CLI) provides a comprehensive set of tools for managing multi-agent networks, launching agents, and interacting with distributed agent systems. This document describes all available CLI features and their usage.

## Table of Contents

- [Overview](#overview)
- [Global Options](#global-options)
- [Commands](#commands)
  - [launch-network](#launch-network)
  - [connect](#connect)
  - [launch-agent](#launch-agent)
- [Interactive Console Features](#interactive-console-features)
- [Configuration Management](#configuration-management)
- [Logging and Debugging](#logging-and-debugging)
- [Examples](#examples)

## Overview

The OpenAgents CLI is the primary interface for managing and interacting with OpenAgents networks. It supports three main operational modes:

1. **Network Management** - Launch and configure network coordinators
2. **Agent Management** - Deploy and manage individual agents
3. **Interactive Console** - Real-time interaction with live networks

## Global Options

All CLI commands support the following global options:

### `--log-level`
Controls the logging verbosity for system logs.

**Syntax:** `--log-level {DEBUG,INFO,WARNING,ERROR,CRITICAL}`

**Default:** `INFO`

**Example:**
```bash
openagents --log-level DEBUG connect --ip localhost
```

### `--verbose` / `-v`
Enables verbose debugging output for troubleshooting and development.

**Syntax:** `--verbose` or `-v`

**Default:** Disabled

**Description:** When enabled, shows detailed debugging information including:
- Protocol adapter loading details
- Message routing information
- WebSocket connection details
- Agent reaction processing
- Tool execution traces

**Example:**
```bash
# Standard output (clean)
openagents connect --ip localhost --port 8765

# Verbose output (detailed debugging)
openagents --verbose connect --ip localhost --port 8765
```

## Commands

### `launch-network`

Launches a network coordinator or node based on a configuration file.

**Syntax:** `openagents launch-network <config_file> [--runtime SECONDS]`

**Parameters:**
- `config_file` (required): Path to network configuration file (YAML format)
- `--runtime SECONDS` (optional): Runtime duration in seconds (default: run indefinitely)

**Description:**
Starts a network coordinator that manages agent connections, message routing, and protocol discovery. Supports both centralized and decentralized network topologies.

**Examples:**
```bash
# Launch a centralized network coordinator
openagents launch-network examples/centralized_network_config.yaml

# Launch with 60-second runtime limit
openagents launch-network examples/centralized_network_config.yaml --runtime 60

# Launch a decentralized network node
openagents launch-network examples/decentralized_network_config.yaml
```

**Configuration File Support:**
- Centralized networks with WebSocket transport
- Decentralized P2P networks
- Custom protocol configurations
- Security and encryption settings
- Network discovery mechanisms

### `connect`

Connects to an existing network as an interactive console agent.

**Syntax:** `openagents connect [--ip HOST] [--port PORT] [--id AGENT_ID] [--network-id NETWORK_ID]`

**Parameters:**
- `--ip HOST` (optional): Server IP address (default: localhost, required if --network-id not provided)
- `--port PORT` (optional): Server port (default: 8765)
- `--id AGENT_ID` (optional): Custom agent ID (default: auto-generated)
- `--network-id NETWORK_ID` (optional): Network ID for discovery-based connection

**Description:**
Establishes an interactive console session with a running network. Provides real-time messaging capabilities and network introspection tools.

**Examples:**
```bash
# Connect to local network with defaults
openagents connect

# Connect to remote network
openagents connect --ip 192.168.1.100 --port 8765

# Connect with custom agent ID
openagents connect --ip localhost --id my-console-agent

# Connect using network discovery
openagents connect --network-id my-network-001
```

**Interactive Features:**
Once connected, the console provides a rich set of interactive commands (see [Interactive Console Features](#interactive-console-features)).

### `launch-agent`

Launches a configured agent that connects to an existing network.

**Syntax:** `openagents launch-agent <config_file> [--network-id NETWORK_ID] [--host HOST] [--port PORT]`

**Parameters:**
- `config_file` (required): Path to agent configuration file (YAML format)
- `--network-id NETWORK_ID` (optional): Network ID to connect to (overrides config file)
- `--host HOST` (optional): Server host address (overrides config file)
- `--port PORT` (optional): Server port (overrides config file)

**Description:**
Deploys a configured agent with specific capabilities and behaviors. Supports various agent types including OpenAI-based agents, custom agents, and specialized service agents.

**Examples:**
```bash
# Launch agent with configuration file
openagents launch-agent examples/openai_agent_config.yaml

# Launch agent with network override
openagents launch-agent examples/minimal_agent_config.yaml --network-id production-net

# Launch agent with connection override
openagents launch-agent examples/custom_agent_config.yaml --host prod.example.com --port 9000
```

**Supported Agent Types:**
- **OpenAI Agents**: GPT-powered conversational agents
- **Custom Agents**: User-defined agent implementations
- **Service Agents**: Specialized utility and processing agents

## Interactive Console Features

When using the `connect` command, you enter an interactive console with the following capabilities:

### Direct Messaging
Send private messages to specific agents in the network.

**Syntax:** `/dm <agent_id> <message>`

**Example:**
```
> /dm openai-assistant-001 Hello, how are you?
[DM to openai-assistant-001]: Hello, how are you?
[DM from openai-assistant-001]: I'm doing well, thank you! How can I help you today?
```

### Broadcast Messaging
Send messages to all connected agents in the network.

**Syntax:** `/broadcast <message>`

**Example:**
```
> /broadcast Welcome everyone to the network!
[Broadcast]: Welcome everyone to the network!
```

### Network Introspection

#### List Connected Agents
View all agents currently connected to the network.

**Syntax:** `/agents`

**Example:**
```
> /agents
Connected Agents:
----------------
- Console Agent (ConsoleAgent-12ab34cd): Connected
- OpenAI Assistant (openai-assistant-001): Connected
- File Processor (file-processor-002): Connected
```

#### List Available Protocols
View all protocols supported by the network.

**Syntax:** `/protocols`

**Example:**
```
> /protocols
Available Protocols:
------------------
- openagents.protocols.communication.simple_messaging (v1.0.0): Basic messaging protocol
- openagents.protocols.discovery.agent_discovery (v1.0.0): Agent discovery and registration
```

#### Get Protocol Manifest
Retrieve detailed information about a specific protocol.

**Syntax:** `/manifest <protocol_name>`

**Example:**
```
> /manifest openagents.protocols.communication.simple_messaging

Protocol Manifest for openagents.protocols.communication.simple_messaging:
------------------------------------------------------------------------
Version: 1.0.0
Description: Simple messaging protocol for direct and broadcast communication

Capabilities:
- Direct messaging between agents
- Broadcast messaging to all agents
- Message acknowledgments
- File attachments
```

### Console Management

#### Help
Display available commands and usage information.

**Syntax:** `/help`

#### Exit
Gracefully disconnect from the network and exit the console.

**Syntax:** `/quit`

## Configuration Management

The OpenAgents CLI supports various configuration file formats and management features:

### Network Configuration Files
Define network topology, transport settings, and protocol configurations.

**Example Structure:**
```yaml
network:
  name: "MyNetwork"
  mode: "centralized"  # or "decentralized"
  host: "0.0.0.0"
  port: 8765
  transport: "websocket"
  
protocols:
  - name: "openagents.protocols.communication.simple_messaging"
    version: "1.0.0"
    enabled: true
  - name: "openagents.protocols.discovery.agent_discovery"
    version: "1.0.0"
    enabled: true
```

### Agent Configuration Files
Define agent behavior, capabilities, and connection settings.

**Example Structure:**
```yaml
type: "openai"  # or custom class path

config:
  agent_id: "my-agent-001"
  model_name: "gpt-3.5-turbo"
  instruction: "You are a helpful assistant"
  
connection:
  host: "localhost"
  port: 8765
  network_id: "my-network"
```

### Configuration Validation
The CLI automatically validates configuration files and provides detailed error messages for:
- Missing required fields
- Invalid parameter types
- Unsupported protocol versions
- Network connectivity issues

## Logging and Debugging

### Log Level Control
Fine-tune logging output for different operational needs:

- **DEBUG**: Detailed development information
- **INFO**: General operational information (default)
- **WARNING**: Important notices and warnings
- **ERROR**: Error conditions that don't stop execution
- **CRITICAL**: Severe errors that may cause termination

### Verbose Mode
Enable comprehensive debugging output for troubleshooting:

**Without Verbose (Production):**
```bash
$ openagents connect --ip localhost
Connecting to network server at localhost:8765...
Connected to network server as ConsoleAgent-12ab34cd
Type your messages and press Enter to send.
```

**With Verbose (Development/Debugging):**
```bash
$ openagents --verbose connect --ip localhost
🔌 Loading protocol adapters for console...
   ✅ Loaded protocol adapter: SimpleMessagingAgentAdapter
🔄 AgentClient.send_direct_message called for message to target-agent
   Available protocol adapters: ['SimpleMessagingAgentAdapter']
   Processing through SimpleMessagingAgentAdapter adapter...
   Result from SimpleMessagingAgentAdapter: ✅ message
🚀 Sending message via connector...
✅ Message sent via connector successfully
```

### Log File Output
All CLI operations are logged to `openagents.log` for persistent debugging and audit trails.

## Examples

### Basic Network Setup and Interaction

1. **Start a Network:**
   ```bash
   openagents launch-network examples/centralized_network_config.yaml
   ```

2. **Connect with Console:**
   ```bash
   openagents connect --ip localhost --port 8765
   ```

3. **Launch an AI Agent:**
   ```bash
   openagents launch-agent examples/openai_agent_config.yaml
   ```

4. **Interact via Console:**
   ```
   > /agents
   > /dm openai-assistant-001 Can you help me with a task?
   > /broadcast Hello everyone!
   ```

### Development and Debugging

1. **Launch with Full Debugging:**
   ```bash
   openagents --verbose --log-level DEBUG launch-network config.yaml
   ```

2. **Test Agent Configuration:**
   ```bash
   openagents --verbose launch-agent test-agent.yaml --runtime 30
   ```

3. **Monitor Network Activity:**
   ```bash
   openagents --verbose connect --ip localhost
   ```

### Production Deployment

1. **Start Production Network:**
   ```bash
   openagents --log-level WARNING launch-network production-config.yaml
   ```

2. **Deploy Service Agents:**
   ```bash
   openagents launch-agent service-agent-1.yaml --host prod.example.com
   openagents launch-agent service-agent-2.yaml --host prod.example.com
   ```

3. **Administrative Console:**
   ```bash
   openagents connect --ip prod.example.com --id admin-console
   ```

## Error Handling and Troubleshooting

### Common Issues

1. **Connection Failures:**
   - Verify network configuration
   - Check firewall settings
   - Ensure network coordinator is running

2. **Agent Launch Failures:**
   - Validate configuration syntax
   - Check required environment variables
   - Verify protocol compatibility

3. **Protocol Loading Issues:**
   - Enable verbose mode for detailed error information
   - Check protocol dependencies
   - Verify protocol manifest files

### Debugging Commands

```bash
# Test network connectivity
openagents --verbose connect --ip <host> --port <port>

# Validate configuration
openagents --log-level DEBUG launch-agent <config> --runtime 5

# Monitor protocol activity
openagents --verbose launch-network <config> --runtime 10
```

## Integration and Automation

### Scripting Support
The CLI supports automation through:
- Exit codes for success/failure detection
- JSON output formats (future enhancement)
- Environment variable configuration
- Batch configuration processing

### CI/CD Integration
Example automated testing:
```bash
#!/bin/bash
# Start test network
openagents launch-network test-config.yaml --runtime 60 &
NETWORK_PID=$!

# Deploy test agents
openagents launch-agent test-agent-1.yaml --runtime 50 &
openagents launch-agent test-agent-2.yaml --runtime 50 &

# Wait for completion
wait

# Cleanup
kill $NETWORK_PID 2>/dev/null || true
```

## Future Enhancements

The OpenAgents CLI is continuously evolving with planned features including:

- **Enhanced Discovery**: Automatic network discovery and connection
- **Agent Marketplace**: Deploy agents from a community marketplace
- **Performance Monitoring**: Built-in network and agent performance metrics
- **Configuration Templates**: Pre-built configurations for common use cases
- **Interactive Setup Wizards**: Guided configuration creation
- **Plugin System**: Extensible command and feature system

---

For more detailed information about specific features, please refer to the individual feature documentation in this directory or visit the main OpenAgents documentation.