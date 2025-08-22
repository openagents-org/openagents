# OpenAgents Studio Command

The `openagents studio` command provides a Jupyter-like web interface for OpenAgents, combining network launching and frontend serving in a single command.

## Overview

Similar to how `jupyter notebook` starts both a server and opens a web interface, `openagents studio` launches:

1. **OpenAgents Network**: A centralized network server for agent communication
2. **Studio Frontend**: A React-based web interface for interacting with the network
3. **Browser Integration**: Automatically opens the studio in your default browser

## Usage

```bash
# Basic usage with default settings
openagents studio

# Custom network and frontend ports
openagents studio --port 8571 --studio-port 8051

# Use custom network configuration
openagents studio --config my-network-config.yaml

# Don't open browser automatically
openagents studio --no-browser

# Custom host (for external access)
openagents studio --host 0.0.0.0
```

## Command Options

| Option | Default | Description |
|--------|---------|-------------|
| `--host` | `localhost` | Network host address |
| `--port` | `8570` | Network port for agent connections |
| `--studio-port` | `8055` | Studio frontend port |
| `--config` | (auto-generated) | Path to custom network configuration file |
| `--no-browser` | `false` | Don't automatically open browser |

## What It Does

1. **Dependency Check**: Automatically installs studio frontend dependencies if needed
2. **Network Launch**: Creates and starts an OpenAgents network with:
   - Centralized topology
   - WebSocket transport
   - Simple messaging and agent discovery modules
3. **Frontend Start**: Launches the React development server
4. **Browser Opening**: Opens the studio interface automatically (unless `--no-browser`)
5. **Monitoring**: Displays real-time logs from both network and frontend
6. **Graceful Shutdown**: Ctrl+C cleanly stops both services

## Default Configuration

When no custom config is provided, the studio uses a default configuration with:

- **Network Name**: "OpenAgentsStudio"
- **Mode**: Centralized
- **Transport**: WebSocket
- **Mods**: Simple messaging + Agent discovery
- **Security**: Simplified (no encryption for local development)

## Example Output

```
🚀 Starting OpenAgents Studio...
Starting studio frontend on port 8055...
🌐 Starting network on localhost:8570...
Network 'OpenAgentsStudio' started successfully
🌐 Opening studio in browser: http://localhost:8055
```

## Use Cases

- **Development**: Quick setup for testing agents and protocols
- **Demos**: Easy way to showcase OpenAgents capabilities
- **Learning**: Interactive environment for exploring multi-agent systems
- **Prototyping**: Rapid iteration on agent interactions

## Requirements

- Node.js and npm (for frontend)
- OpenAgents framework installed
- Available ports for network and frontend

## Troubleshooting

**Port Conflicts**: Use different ports with `--port` and `--studio-port`

**Dependencies**: The command will automatically install frontend dependencies

**Browser Issues**: Use `--no-browser` and manually navigate to the displayed URL

**Network Issues**: Check that the specified ports are available and not blocked by firewall
