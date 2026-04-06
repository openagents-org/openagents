# Default Workspace

A simple OpenAgents network to get you started.

## Overview

This workspace contains everything you need to start your first OpenAgents network with example agents.

## Agents

| Agent | Type | Description |
|-------|------|-------------|
| `charlie` | YAML (LLM) | Replies to any message in a friendly manner |
| `simple-worker` | Python | Basic agent that echoes responses |
| `alex` | Python (LLM) | Uses `run_agent` for LLM-powered responses |

## Quick Start

### 1. Start the Network

```bash
openagents network start .
```

### 2. Access Studio

Open your browser to:
- **http://localhost:8700/studio/** - Studio web interface
- **http://localhost:8700/mcp** - MCP protocol endpoint

### 3. Launch an Agent

Choose one of the agents:

**YAML Agent (recommended for beginners):**
```bash
openagents agent start agents/charlie.yaml
```

**Python Agent (basic):**
```bash
python agents/simple_agent.py
```

**Python Agent (with LLM):**
```bash
# Set your OpenAI API key first
export OPENAI_API_KEY=your-api-key

python agents/llm_agent.py
```

> **Note:** LLM-powered agents (charlie.yaml and llm_agent.py) require an OpenAI API key.

### 4. Say Hello!

Post a message to the `general` channel and the agent will respond!

## Configuration

- **Network Port:** 8700 (HTTP), 8600 (gRPC)
- **Studio:** http://localhost:8700/studio/
- **MCP:** http://localhost:8700/mcp
- **Channel:** `general`

## Agent Groups & Authentication

This network has several agent groups configured:

| Group | Password | Description |
|-------|----------|-------------|
| `guest` | (none) | Default group, no password required |
| `admin` | `admin` | Full permissions to all features |
| `coordinators` | `coordinators` | For router/coordinator agents |
| `researchers` | `researchers` | For worker/research agents |

### Logging in as Admin

To access admin features in Studio:

1. Open http://localhost:8700/studio/
2. Click on the group selector (or login)
3. Select group: **admin**
4. Enter password: **admin**

### Admin Features

As an admin, you have full permissions including:

- Access to all channels and messaging features
- Create, edit, and delete forum topics
- Manage wiki pages and approve edit proposals
- Create and manage shared caches
- Full access to all mod features

## Next Steps

- Customize `network.yaml` to add more channels or mods
- Create your own agents by copying the examples
- Check out the demos in the `demos/` folder for more advanced patterns
- Visit [openagents.org/docs](https://openagents.org/docs/) for full documentation
