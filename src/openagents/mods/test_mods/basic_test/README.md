# Basic Test Mod

A comprehensive testing mod for the OpenAgents framework that provides both network-level and agent-level testing capabilities.

## Overview

The Basic Test Mod is designed to help developers test and debug OpenAgents applications by providing:

- Event processing and logging
- Agent registration tracking
- State management
- Configurable test behaviors
- Custom event responses
- Message handling and threading

## Components

### Network Mod (`BasicTestNetworkMod`)

The network-level component provides:

- **Agent Registration Tracking**: Monitors agent connections and disconnections
- **Event Processing**: Logs and processes all events passing through the network
- **State Management**: Maintains comprehensive state information for testing
- **Event Interception**: Can intercept and stop event processing for testing
- **Custom Responses**: Can return custom responses for specific event types

#### Key Features

- Tracks all registered agents
- Maintains event history (configurable limit)
- Provides network-wide state information
- Supports test-specific event handling (`test.ping`, `test.get_state`)
- Configurable event interception mode

### Agent Adapter (`BasicTestAgentAdapter`)

The agent-level component provides:

- **Event Processing**: Logs incoming and outgoing events for individual agents
- **Tool Provision**: Provides testing tools for agents to use
- **Message Threading**: Supports message threading for conversation tracking
- **Custom Handlers**: Allows registration of custom message handlers

#### Available Tools

1. **test_ping**: Send a test ping to the network
2. **get_test_state**: Get the current state of the test adapter
3. **send_test_message**: Send a test message to another agent or broadcast

## Usage

### Basic Setup

```python
# The mod is automatically loaded when included in the mod configuration
# No additional setup required
```

### Network Mod Usage

```python
# Access the network mod through the network instance
network_mod = network.get_mod("basic_test")

# Get current state
state = network_mod.get_state()
print(f"Registered agents: {state['agent_count']}")
print(f"Events processed: {state['event_count']}")

# Set custom response for testing
network_mod.set_test_response("custom.event", {
    "success": True,
    "payload": {"test": "response"}
})

# Enable event interception mode
network_mod.set_intercept_mode(True)

# Get event history
recent_events = network_mod.get_event_history(limit=5)
```

### Agent Adapter Usage

```python
# Access through agent's mod system
test_adapter = agent.get_mod_adapter("basic_test")

# Register custom message handler
def handle_custom_message(payload, source_id):
    print(f"Received custom message from {source_id}: {payload}")

test_adapter.register_message_handler("custom.message", handle_custom_message)

# Enable test mode
test_adapter.set_test_mode(True)

# Get adapter state
state = await test_adapter._handle_get_state({})
print(f"Agent events processed: {state['state']['event_count']}")
```

### Using Tools

Agents can use the provided tools:

```python
# Send a test ping
result = await agent.use_tool("test_ping", {"message": "Hello network!"})

# Get test state
state = await agent.use_tool("get_test_state", {})

# Send test message to specific agent
result = await agent.use_tool("send_test_message", {
    "target_agent": "agent_123",
    "message": "Test message",
    "event_name": "test.custom"
})

# Broadcast test message
result = await agent.use_tool("send_test_message", {
    "message": "Broadcast test message"
})
```

## Configuration

The mod can be configured through the network or agent configuration:

```json
{
    "mods": {
        "basic_test": {
            "max_event_history": 100,
            "log_all_events": true,
            "intercept_events": false
        }
    }
}
```

## Testing Scenarios

### Event Flow Testing

1. Enable event logging to monitor all events
2. Send test events and verify they're processed correctly
3. Use event interception to test error handling

### Agent Registration Testing

1. Monitor agent connections and disconnections
2. Verify agent metadata is properly stored
3. Test agent discovery functionality

### State Management Testing

1. Verify state is maintained correctly across events
2. Test state persistence and recovery
3. Monitor resource usage and cleanup

### Message Threading Testing

1. Send threaded messages and verify thread creation
2. Test message ordering and threading logic
3. Verify thread cleanup and management

## Events

### Processed Events

- `test.ping`: Network ping with response
- `test.get_state`: State information request
- `test.agent_ping`: Agent-specific ping
- `test.message`: General test message
- `agent.connected`: Agent connection events
- `agent.disconnected`: Agent disconnection events

### Generated Events

- `test.ping`: Ping events sent by agents
- `test.message`: Test messages sent by agents
- `test.response`: Responses to test events

## Development

This mod serves as a reference implementation for:

- Proper mod structure and organization
- Event processing patterns
- State management techniques
- Tool implementation
- Message handling and threading

It can be extended or modified to support additional testing scenarios as needed.
