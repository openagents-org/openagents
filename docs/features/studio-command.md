# OpenAgents Studio Command

The `openagents studio` command provides a Jupyter-like web interface for OpenAgents, combining network launching and frontend serving in a single command.

## Overview

Similar to how `jupyter notebook` starts both a server and opens a web interface, `openagents studio` launches:

1. **OpenAgents Network**: A centralized network server for agent communication
2. **Studio Frontend**: A React-based web interface for interacting with the network
3. **Browser Integration**: Automatically opens the studio in your default browser

## Usage

```bash
# Basic usage with default workspace (./openagents_workspace)
openagents studio

# Use custom workspace directory
openagents studio --workspace /path/to/my/workspace
openagents studio -w /path/to/my/workspace

# Custom network and frontend ports
openagents studio --port 8571 --studio-port 8055

# Don't open browser automatically
openagents studio --no-browser

# Custom host (for external access)
openagents studio --host 0.0.0.0

# Combining options
openagents studio -w ./my_project --port 8580 --studio-port 8060 --no-browser
```

## Command Options

| Option | Default | Description |
|--------|---------|-------------|
| `--host` | `localhost` | Network host address |
| `--port` | `8570` | Network port for agent connections |
| `--studio-port` | `8055` | Studio frontend port |
| `--workspace`, `-w` | `./openagents_workspace` | Path to workspace directory |
| `--no-browser` | `false` | Don't automatically open browser |

## What It Does

1. **Pre-flight Checks**: Validates Node.js/npm availability and port conflicts
2. **Workspace Setup**: Creates or uses existing workspace directory with configuration
3. **Configuration Loading**: Loads network configuration from workspace `config.yaml`
4. **Port Conflict Detection**: Checks network and frontend ports, suggests alternatives
5. **Dependency Check**: Automatically installs studio frontend dependencies if needed
6. **Network Launch**: Creates and starts an OpenAgents network based on workspace config
7. **Frontend Start**: Launches the React development server
8. **Browser Opening**: Opens the studio interface automatically (unless `--no-browser`)
9. **Monitoring**: Displays real-time logs from both network and frontend
10. **Graceful Shutdown**: Ctrl+C cleanly stops both services

## Workspace System

### Default Workspace
If no workspace is specified, OpenAgents Studio creates a `./openagents_workspace` directory with a default configuration.

### Workspace Structure
```
workspace_directory/
├── config.yaml          # Network configuration
└── (other project files)
```

### Default Configuration
New workspaces are initialized with:
- **Network Name**: "ThreadMessagingNetwork"
- **Mode**: Centralized
- **Transport**: WebSocket
- **Mods**: Thread messaging with channels (general, ai-community, updates, random)
- **File Support**: Upload and sharing capabilities
- **Security**: Simplified (no encryption for local development)

## Example Output

```
🚀 Starting OpenAgents Studio...
📁 Using workspace: /Users/user/project/openagents_workspace
Starting studio frontend on port 8055...
🌐 Starting network on localhost:8570...
Copied config.yaml to workspace
Initialized new workspace at: /Users/user/project/openagents_workspace
Loaded workspace configuration from: /Users/user/project/openagents_workspace/config.yaml
Network 'ThreadMessagingNetwork' started successfully
🌐 Opening studio in browser: http://localhost:8055
```

## Use Cases

- **Development**: Quick setup for testing agents and protocols
- **Demos**: Easy way to showcase OpenAgents capabilities
- **Learning**: Interactive environment for exploring multi-agent systems
- **Prototyping**: Rapid iteration on agent interactions

## Requirements

- **Node.js 16+ and npm** (for frontend development server)
- OpenAgents framework installed  
- Available ports for network and frontend

### Installing Node.js

If you don't have Node.js installed, the studio command will show helpful installation instructions for your platform:

```bash
# macOS (using Homebrew)
brew install node

# Ubuntu/Debian
sudo apt update && sudo apt install nodejs npm

# CentOS/RHEL/Fedora  
sudo dnf install nodejs npm

# Windows
# Download from: https://nodejs.org/

# Using Node Version Manager (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
nvm install --lts && nvm use --lts
```

Verify installation with:
```bash
node --version && npm --version
```

## Troubleshooting

### Port Conflicts

The studio automatically detects port conflicts and provides helpful guidance:

```bash
❌ Port conflicts detected:
🌐 Network port 8570: occupied by Cursor (PID: 45241)

💡 Solutions:
1️⃣  Use alternative ports (recommended):
   openagents studio --port 8571 --studio-port 8056

2️⃣  Stop the conflicting processes
3️⃣  Choose custom ports
```

**Common Solutions:**
- Use suggested alternative ports: `openagents studio --port 8571 --studio-port 8056`
- Find available ports: `python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print('Available port:', s.getsockname()[1]); s.close()"`
- Stop conflicting processes: `sudo lsof -ti:8570 | xargs kill` (macOS/Linux)

### Other Issues

**Dependencies**: The command will automatically install frontend dependencies and check for Node.js/npm

**Browser Issues**: Use `--no-browser` and manually navigate to the displayed URL

**Network Issues**: Check that the specified ports are available and not blocked by firewall
