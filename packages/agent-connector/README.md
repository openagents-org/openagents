# @openagents-org/agent-connector

Agent management CLI and library for [OpenAgents](https://openagents.org) — install, configure, and run AI coding agents from your terminal.

## Install

```bash
npm install -g @openagents-org/agent-connector
```

## CLI Usage

```bash
# Browse available agents
agent-connector search

# Install an agent runtime
agent-connector install openclaw
agent-connector install claude

# Create and configure an agent
agent-connector create my-agent --type openclaw
agent-connector env openclaw --set LLM_API_KEY=sk-...
agent-connector env openclaw --set LLM_BASE_URL=https://api.openai.com/v1

# Start the daemon (runs agents in background)
agent-connector up

# Check status
agent-connector status

# View logs
agent-connector logs

# Connect this device (formerly "node") to a workspace with a pairing code
# from Workspace → Devices → Connect a device. Pair once; agents created on
# this device can then join without a token. `agn node ...` still works.
agent-connector device connect XXXX-XXXX
agent-connector device status

# Connect an agent to a paired workspace
agent-connector connect my-agent --workspace <slug>

# Stop
agent-connector down
```

Run `agent-connector help` for the full command list.

Only the person who connected a device controls it from the workspace
(remote add/start/stop of its agents); a workspace admin can only unpair it.
Every request the connector makes for an agent carries `X-Agent-Name`, so the
workspace applies that agent's permissions rather than treating the call as an
anonymous machine.

## Library Usage

```js
const { AgentConnector } = require('@openagents-org/agent-connector');

const connector = new AgentConnector();

// Browse catalog
const catalog = await connector.getCatalog();

// Install a runtime
await connector.install('openclaw');

// Agent CRUD
connector.addAgent({ name: 'my-agent', type: 'openclaw' });
connector.saveAgentEnv('openclaw', { LLM_API_KEY: 'sk-...' });

// Daemon lifecycle
const daemon = connector.createDaemon();
await daemon.start();
```

## Supported Agents

| Agent | Type | Install |
|-------|------|---------|
| [OpenClaw](https://github.com/openagents/openclaw) | `openclaw` | npm |
| [Claude Code](https://claude.ai/claude-code) | `claude` | npm |
| [Codex](https://github.com/openai/codex) | `codex` | npm |
| [Aider](https://aider.chat) | `aider` | curl |
| [Goose](https://github.com/block/goose) | `goose` | curl |
| [Amp](https://ampcode.com) | `amp` | curl |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini` | npm |
| And more... | | |

## Requirements

- Node.js 18+
- No Python required

## License

MIT
