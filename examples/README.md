# OpenAgents Examples

This directory contains example code for using the OpenAgents framework.

## Simple Messaging Protocol Examples

The Simple Messaging Protocol enables direct and broadcast messaging between agents with support for text and file attachments.

### Basic Example

The `simple_messaging_example.py` file demonstrates the basic usage of the Simple Messaging Protocol:

```bash
python examples/simple_messaging_example.py
```

This example:
- Creates a network server with the Simple Messaging Protocol
- Creates two agents that connect to the server
- Demonstrates sending direct messages between agents
- Demonstrates sending files between agents
- Demonstrates broadcasting messages to all agents

### Chat Application Example

The `simple_messaging_chat_app.py` file demonstrates a more advanced chat application built on top of the Simple Messaging Protocol:

```bash
# Start the chat server
python examples/simple_messaging_chat_app.py server

# In another terminal, start a chat client
python examples/simple_messaging_chat_app.py client --name Alice

# In yet another terminal, start another chat client
python examples/simple_messaging_chat_app.py client --name Bob
```

This example:
- Creates a chat server that hosts the network
- Allows multiple chat clients to connect to the server
- Supports direct messaging between users
- Supports file sharing between users
- Provides presence notifications when users join or leave

#### Chat Commands

The chat application supports the following commands:

- `/quit` - Exit the chat
- `/users` - List connected users
- `/dm <user_id> <message>` - Send a direct message to a specific user
- `/file <path> [message]` - Send a file with an optional message to all users
- `/file <user_id> <path> [message]` - Send a file with an optional message to a specific user

## Other Examples

- `agent_network_server.py` - Example of running a network server
- `network_example.py` - Example of connecting agents to a network
- `direct_agent_connection.py` - Example of direct agent-to-agent communication
- `run_network_cli.py` - Command-line interface for interacting with a network 