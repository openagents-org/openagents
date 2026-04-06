# OpenAgents Agent Client: The Anaconda for Local Agents

**Status:** Implementation In Progress
**Created:** 2026-03-08

---

## 1. Vision

OpenAgents aims to be **the Anaconda for AI agents** — a unified client that lets developers install, manage, and connect any local AI agent to collaborative online workspaces. Just as Anaconda made it trivial to install Python packages and manage environments, OpenAgents makes it trivial to install agent runtimes, spin up persistent connections, and let multiple agents collaborate in shared workspaces.

```
openagents install aider          # install an agent runtime
openagents start claude           # start a local agent
openagents connect my-bot ws-123  # attach agent to a network
openagents up                     # start all agents
openagents search coding          # discover available agent types
openagents autostart              # auto-start on login
```

The end state: a developer opens their laptop, and their agents are already online — connected to shared workspaces where they collaborate with other agents and humans, across machines and across users.

---

## 2. The Problem

### Fragmented Agent Landscape

AI agents are multiplying — Claude Code, Codex CLI, Aider, Goose, Cline, SWE-agent, and more. Each has its own installation method, its own CLI, its own way of running. There is no unified way to:

1. **Discover** what agents exist and which are installed
2. **Install** agents across different package managers (pip, npm, binaries)
3. **Connect** agents to shared collaboration environments
4. **Manage** multiple agent processes that survive laptop sleep/wake cycles

### Today's Painful Workflow

Connecting agents to an OpenAgents workspace currently requires:

- **One terminal tab per agent** — `openagents connect claude --name bot-1 --join ws123 --token xxx`
- **Manual restart** when the laptop sleeps/wakes — agents go offline silently
- **Per-agent-type setup** — users must install Claude Code, OpenClaw, etc. separately
- **No persistent configuration** — users re-type flags every time
- **No cross-agent collaboration** — agents run in isolation, unaware of each other

---

## 3. Solution Architecture

The OpenAgents platform is organized into three layers. Each layer has a clear responsibility, and the boundaries between them are defined by the ONM protocol.

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: NETWORKS (remote)                                 │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  OpenAgents   │  │  Custom SDK  │  │  Any ONM-        │  │
│  │  Workspace    │  │  Network     │  │  compatible      │  │
│  │  (hosted)     │  │  (self-host) │  │  network         │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │             │
│         └────────┬────────┘────────────────────┘            │
│                  │                                          │
│           Network Manifest (ONM)                            │
│           GET /.well-known/openagents.json                  │
│                                                             │
├──────────────────┼──────────────────────────────────────────┤
│  Layer 2: CONNECTOR (protocol bridge)                       │
│                  │                                          │
│           ONM Event Protocol                                │
│           (WebSocket / HTTP / gRPC)                          │
│                  │                                          │
│           ┌──────┴──────┐                                   │
│           │  Connector  │  auth, discovery, reconnect,      │
│           │             │  transport negotiation             │
│           └──────┬──────┘                                   │
│                  │                                          │
├──────────────────┼──────────────────────────────────────────┤
│  Layer 1: CLIENT (local machine)                            │
│                  │                                          │
│  ┌───────────────┴───────────────┐                          │
│  │  OpenAgents Client            │                          │
│  │  - Plugin registry (Anaconda) │                          │
│  │  - Daemon (process manager)   │                          │
│  │  - Agent lifecycle            │                          │
│  └───┬──────┬──────┬──────┬──────┘                          │
│      │      │      │      │                                 │
│   Claude  Aider  Codex  YAML                                │
│    agent   agent  agent  agent                              │
└─────────────────────────────────────────────────────────────┘
```

**Key principle:** An agent never connects to a network directly. It runs under the client (Layer 1), which delegates connectivity to the connector (Layer 2), which speaks ONM protocol to the network (Layer 3). This separation means any agent can connect to any network — the client and connector handle all the plumbing.

### Layer 1: Client (Local Machine)

The client is the **Anaconda** part — it manages what's installed on the developer's machine and keeps agent processes alive.

**Plugin Registry.** A pluggable system for agent types. Built-in agents (claude, openclaw, codex) ship with the package. Third-party agents register via Python entry_points:

```toml
# In a third-party package's pyproject.toml:
[project.entry-points."openagents.plugins"]
aider = "openagents_aider:AiderPlugin"
```

Each plugin implements the `AgentPlugin` base class:

```python
class AgentPlugin(ABC):
    name: str                    # "claude", "aider", etc.
    label: str                   # "Claude Code CLI"
    install_command: str         # "pip install aider-chat"

    def is_installed(self) -> bool: ...
    def which(self) -> Optional[str]: ...
    def create_adapter(self, workspace_id, channel_name, token,
                       agent_name, endpoint, options=None) -> adapter: ...
    def health_check(self) -> bool: ...
```

The registry also maintains a **catalog** of known agents (installed or not), enabling `openagents search` to show agents the user hasn't installed yet.

The `yaml-agent` plugin type allows SDK-built agents defined in YAML config files to be managed by the client just like any other agent type. This replaces the old `openagents agents start <folder>` command — YAML-defined agents are now first-class plugins.

**Daemon Manager.** A single background process that manages all agent connections:

```
~/.openagents/
  daemon.yaml          # persistent config (workspaces + agents)
  daemon.pid           # PID file for running daemon
  daemon.log           # log output
  daemon.status.json   # live status for `openagents status`
  identity.json        # agent identities and API keys
```

Key design decisions:

- **In-process asyncio tasks, not subprocesses.** Each adapter runs as a coroutine in one event loop. Simpler, lower memory, trivial health monitoring.
- **Config-driven, not flag-driven.** `openagents create` + `openagents connect` build the config. `openagents up` reads it. Users can also hand-edit `daemon.yaml`.
- **Auto-reconnect on wake.** Exponential backoff (2s → 60s) handles laptop sleep/wake transparently.
- **Cross-platform.** Works on Linux (double-fork daemon), macOS (launchd), and Windows (DETACHED_PROCESS + Task Scheduler).

### Layer 2: Connector (Protocol Bridge)

The connector is the shared abstraction between agents and networks. It handles everything adapters shouldn't have to think about:

- **Network manifest discovery** — fetch `/.well-known/openagents.json` to learn what the network supports (see below)
- **Authentication** — token, API key, or progressive verification (ONM levels 0-3)
- **Transport negotiation** — pick the best available transport (WebSocket, HTTP polling, gRPC) based on the manifest
- **Channel discovery** — find channels and rejoin on reconnect
- **Event routing** — receive events from the network, dispatch to the adapter; send adapter responses back
- **Reconnection** — exponential backoff, transparent sleep/wake recovery

Today, each adapter reimplements this logic. The connector extracts it into a shared layer so adapters become thin — they only translate between the agent's native I/O and ONM events.

**Network Manifest.** Every ONM-compatible network (hosted workspace or custom SDK network) exposes a manifest at a well-known URL. The connector fetches this to learn how to connect:

```json
// GET https://workspace-endpoint.openagents.org/.well-known/openagents.json
{
  "onm_version": "1.0",
  "network_id": "5a0bf4d7-...",
  "name": "my-project",
  "description": "Multi-agent coding workspace",
  "transports": [
    {"type": "http", "url": "https://workspace-endpoint.openagents.org/v1"},
    {"type": "websocket", "url": "wss://workspace-endpoint.openagents.org/ws"}
  ],
  "auth": {
    "methods": ["token", "api_key"],
    "verification_level": 1
  },
  "capabilities": ["channels", "files", "events", "presence"],
  "mods": ["messaging", "file_storage", "browser"]
}
```

This manifest is the **contract** between the connector and the network. A custom SDK network that exposes this manifest is automatically compatible with the client. The connector doesn't need to know whether it's talking to the hosted workspace or a self-hosted network — it reads the manifest and adapts.

This should also be formalized in the [OpenAgents Network Model](../openagents_network_model.md) spec as a required discovery mechanism.

### Layer 3: Networks (Remote)

A network is any ONM-compatible remote service that agents connect to. There are currently two flavors, but the architecture supports any number:

**OpenAgents Workspace (hosted).** The default, managed network at `workspace.openagents.org`. Provides:

- **Channels** — conversation threads where agents and humans interact
- **Events** — all communication flows as typed ONM events
- **Shared context** — file uploads, artifacts, and resources accessible to all participants
- **Web UI** — browser-based interface for monitoring and interacting with agents
- **Cross-user collaboration** — invite other developers' agents via workspace tokens

**Custom SDK Network (self-hosted).** Built with `openagents[sdk]` and launched with `openagents network start`. A developer defines a network with custom mods, transports, and agent configurations. Could be a game world, a research environment, a CI pipeline — anything.

Both flavors speak ONM and expose a network manifest. The client doesn't care which one it's connecting to.

**The new mental model for `openagents network start`:** It launches a *network service* (Layer 3). It does NOT launch agents. Agents connect to it separately through the client:

```bash
# Terminal 1: Launch a custom network (Layer 3)
openagents network start --config my-network.yaml

# Terminal 2: Create agents (Layer 1) and connect to network (Layer 2)
openagents create claude --name researcher
openagents create aider --name coder
openagents connect researcher localhost:8080
openagents connect coder localhost:8080
openagents up
```

The workspace is what transforms isolated local agents into a collaborative multi-agent system. An agent running on Alice's laptop can collaborate with an agent running on Bob's server, coordinated through a shared network — whether that's the hosted workspace or a custom SDK network.

### Package Split

The three layers map to an optional dependency split:

```
pip install openagents          # Layer 1 + 2 (client + connector)
                                # Lightweight: typer, rich, pyyaml, aiohttp, websockets
                                # CLI: search, install, create, connect, up, down, status

pip install openagents[sdk]     # + Layer 3 (network building)
                                # Adds: grpcio, cryptography, pynacl, framework bridges
                                # CLI: network start, studio
                                # Exports: AgentNetwork, mods, transports, WorkerAgent
```

The base package is what 90% of users need — manage agents, connect to workspaces. The `[sdk]` extra is for developers building custom networks.

### Dual Path: CLI vs Programmatic

Both paths to connecting agents are supported:

**CLI path** (most users): `openagents create claude` → `openagents connect` → `openagents up`. The client manages everything.

**Programmatic path** (SDK developers): Build agents in Python using `AgentClient`, `WorkerAgent`, or framework bridges (LangChain, CrewAI). These agents can connect directly to a network via the SDK, bypassing the client CLI. The underlying ONM protocol is shared — a programmatic agent and a CLI-managed agent are indistinguishable to the network.

---

## 4. Command-Line Interface Design

The CLI is built with [Typer](https://typer.tiangolo.com/) and uses [Rich](https://rich.readthedocs.io/) for terminal output. Commands are organized around the three-layer architecture and the three user personas.

### Command Map

```
openagents                       # (bare) scan machine, show agent status
  │
  │  ── Layer 1: Client (Anaconda) ──────────────────────────
  │
  ├── start <type>           # Create agent + prompt for workspace + start daemon
  ├── stop [name]            # Stop daemon or individual agent
  ├── install <type>         # Install an agent runtime
  ├── search [query]         # Browse available agent types
  ├── runtimes               # Show what's installed
  ├── remove <name>          # Remove an agent from config
  ├── up                     # Start daemon, run all configured agents
  ├── down                   # Stop daemon
  ├── status                 # Show running agents and health
  ├── autostart              # Auto-start daemon on login
  │
  │  ── Layer 2: Connector ──────────────────────────────────
  │
  ├── connect <name> [net]   # Attach agent to network (token-only supported)
  ├── disconnect <name>      # Detach an agent from its network
  ├── workspace              # (subcommand group)
  │   ├── create             #   Create a new workspace, get token
  │   ├── join <token>       #   Join workspace with token
  │   └── list               #   List configured workspaces
  ├── login                  # Store API key / authenticate
  ├── rename <new_name>      # Rename an agent identity
  ├── mcp-server             # Expose a network as MCP tools
  │
  │  ── Layer 3: Networks (requires openagents[sdk]) ────────
  │
  ├── network                # (subcommand group)
  │   ├── init [path]        #   Scaffold a new network project
  │   ├── start              #   Launch a network service
  │   └── list               #   List running networks
  ├── studio                 # Launch network monitoring UI
  │
  │  ── Meta ────────────────────────────────────────────────
  │
  ├── version                # Show version
  └── help                   # Show help
```

**Key changes from previous design:**

- **`start` is the primary command.** `openagents start claude` does everything: creates agent if needed, prompts for workspace if none configured, starts daemon. Idempotent — running twice is a no-op.
- **Token-only workspace join.** `openagents workspace join <token>` and `openagents connect my-bot --token <token>` work without specifying a workspace ID. The server resolves the workspace from the token via `POST /v1/token/resolve`.
- **`workspace` command group.** `openagents workspace create` creates a workspace and returns a shareable token. `openagents workspace join <token>` joins with just a token. No workspace ID needed.
- **`create` + `connect` separation preserved.** `openagents start claude` combines them for convenience. Power users can still `openagents start claude` (Layer 1) then `openagents connect claude --token xxx` (Layer 2) separately.
- **No more `connect` subcommand group.** The old `openagents connect claude --name X --join Y --token Z` combined creation + network attachment in one command. Now they're split. (Old `connect` commands remain as hidden aliases for backward compatibility.)
- **No more `agents start <folder>`.** YAML-defined agents become a `yaml-agent` plugin type, managed by `start` + `up` like everything else.
- **`network` subcommand group** replaces the old `init` (workspace scaffold). `network init` scaffolds a network project. `network start` launches it. Both require `openagents[sdk]`.
- **Commands grouped by layer.** Layer 1 commands work with zero network access. Layer 2 commands talk to remote services. Layer 3 commands require the SDK extra.

### Layer 1 Commands: Client (Anaconda)

These commands work locally. No network connection or account required.

#### `openagents search [query]`

Browse available agent types. Shows installed plugins and catalog entries.

```
$ openagents search
                         Available Agents
  Name       Label             Status        Install Command
 ────────────────────────────────────────────────────────────
  claude     Claude Code CLI   installed     (built-in)
  codex      OpenAI Codex CLI  installed     (built-in)
  openclaw   OpenClaw          not installed pip install openclaw
  aider      Aider             available     pip install aider-chat
  goose      Goose             available     pip install goose-ai
  cline      Cline             available     npm install -g cline

Install with: openagents install <name>
```

With a query, filters by name/label/description/tags:

```
$ openagents search coding
  aider, goose, cline, swebench
```

#### `openagents install <type>`

Install an agent runtime. Detects the method from the catalog:

- `pip install ...` → runs via current Python interpreter
- `npm install ...` → runs directly
- Manual instructions → printed for the user

```
$ openagents install aider
Installing Aider...
  Command: /usr/bin/python -m pip install aider-chat
Run? [y/n]: y
...
Successfully installed Aider
```

#### `openagents runtimes`

Show installed runtimes with paths and configured agents.

```
$ openagents runtimes
  claude     Claude Code CLI   installed   /usr/local/bin/claude
  openclaw   OpenClaw          not installed
  codex      OpenAI Codex CLI  installed   /usr/bin/codex

3 agent(s) configured:
  my-coder (claude) → my-project
  aider-helper (aider) → my-project
  reviewer-bot (claude) → (local)
```

#### `openagents start <type>`

Start an agent — creates it if it doesn't exist, prompts for workspace setup on first run, and starts the daemon. This is the **primary command** and the recommended entry point for new users.

```
openagents start <type> [OPTIONS]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--name NAME` | `-n` | same as type | Agent name |
| `--path PATH` | `-p` | — | Working directory for the agent |
| `--role ROLE` | `-r` | `worker` | Agent role (used when later connected) |

```
$ openagents start claude --name my-bot
Claude Code CLI — Ready (logged in)
Created my-bot (claude).

Set up a workspace? [1] Create / [2] Join / [3] Skip: 3
Starting daemon...
  my-bot    claude    (local)    running
```

```
$ openagents start claude --name project-coder --path ~/projects/my-app
Created project-coder (claude), working dir: ~/projects/my-app
```

**Auto-naming** (no `--name`): defaults to the agent type name (e.g. "claude"). If that name is taken, auto-generates a unique name.

```
$ openagents start claude
Claude Code CLI — Ready (logged in)
Created claude (claude).
```

```
$ openagents start claude --path ~/projects/my-app
Created claude-my-app-4k2m (claude), working dir: ~/projects/my-app
```

The `start` command is idempotent — running it again for an existing agent is a no-op (just ensures the daemon is running). The old `create` command is preserved as a hidden alias for backward compatibility.

After `start`, the agent exists in `daemon.yaml`. If connected to a network, it goes online. Otherwise it runs as a local-only process. To attach it to a network later, use `openagents connect`.

#### `openagents remove <name>`

Remove an agent from the daemon config. Automatically disconnects from any network. Prompts for confirmation.

```
$ openagents remove reviewer-bot
Remove reviewer-bot (claude)? [y/n]: y
Removed reviewer-bot
```

#### `openagents up`

Start the daemon. Runs all configured agents — both local-only and network-connected.

```
openagents up [OPTIONS]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--config PATH` | `-c` | `~/.openagents/daemon.yaml` | Path to daemon config |
| `--foreground` | `-f` | `false` | Run in foreground (don't daemonize) |

```
$ openagents up
Starting 3 agent(s)...

  Agent              Type      Network        State
 ─────────────────────────────────────────────────────
  my-coder           claude    my-project     online
  aider-helper       aider     my-project     online
  reviewer-bot       claude    (local)        running

Daemon running (PID 12345).
```

Agents with a network connection go through the connector (Layer 2) to authenticate, discover channels, and start receiving events. Local-only agents simply run as managed processes.

#### `openagents down`

Stop the daemon. Gracefully disconnects all agents.

```
openagents down
```

#### `openagents status`

Show live status of all managed agents.

```
$ openagents status
Daemon: running (PID 12345, uptime 2h 15m)

  Agent              Type      Network        State          Restarts
 ──────────────────────────────────────────────────────────────────────
  my-coder           claude    my-project     online         0
  aider-helper       aider     my-project     online         0
  reviewer-bot       claude    (local)        running        0
  helper-bot         claude    bobs-network   reconnecting   1
```

#### `openagents autostart`

Set up auto-start on login using the platform-native mechanism.

```
openagents autostart [--remove]
```

| Platform | Mechanism |
|----------|-----------|
| Linux | systemd user service |
| macOS | launchd plist |
| Windows | Task Scheduler |

### Layer 2 Commands: Connector

These commands interact with remote networks. They manage identity, authentication, and network membership.

#### `openagents connect <name> <network>`

Attach an existing agent to a network. The agent must already exist (via `create`). Inspired by `docker network connect`.

```
openagents connect <agent_name> <network> [OPTIONS]
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--token TOKEN` | `-t` | — | Network authentication token |
| `--role ROLE` | `-r` | `worker` | Agent role in the network |
| `--endpoint URL` | — | auto-detected | API endpoint (overrides manifest discovery) |

```
$ openagents connect my-bot my-workspace --token xxx
Connected my-bot (claude) → my-workspace
```

```
$ openagents connect my-bot localhost:8080
Connected my-bot (claude) → localhost:8080
```

The network argument can be a workspace slug, a URL, or a network ID. The connector resolves it by:
1. If it looks like a URL → fetch `/.well-known/openagents.json` manifest
2. If it matches a known workspace slug in config → use stored endpoint
3. Otherwise → try as workspace slug on `workspace-endpoint.openagents.org`

#### `openagents disconnect <name>`

Detach an agent from its network. The agent stays in config as local-only.

```
$ openagents disconnect my-bot
Disconnected my-bot from my-workspace. Agent will run locally.
```

#### `openagents login`

Store credentials for connecting to networks.

```
openagents login --api-key KEY
```

#### `openagents join <invite_token>`

Accept a network invitation. Adds the network to `daemon.yaml` so agents can be assigned to it.

```
$ openagents join inv_abc123
Joined network "alice-project" (workspace.openagents.org)
Create and connect agents:
  openagents start claude --name my-agent
  openagents connect my-agent alice-project
```

#### `openagents invitations`

Check pending network invitations.

```
$ openagents invitations
  inv_abc123  alice-project  from alice@example.com  pending
```

#### `openagents rename <new_name>`

Rename an agent identity.

```
openagents rename new-name --agent old-name
```

#### `openagents mcp-server`

Expose a network's resources as MCP tools, so external LLMs (Claude Desktop, etc.) can interact with the network.

```
openagents mcp-server --network my-project --token xxx
```

### Layer 3 Commands: Networks (requires `openagents[sdk]`)

These commands are for developers building custom agent networks. They require `pip install openagents[sdk]`.

#### `openagents network init [path]`

Scaffold a new network project.

```
$ openagents network init my-game-network
Created my-game-network/
  network.yaml          # network config
  mods/                 # custom mods directory
    __init__.py

Next: edit network.yaml, then run:
  openagents network start --config my-game-network/network.yaml
```

#### `openagents network start`

Launch a network service. The network exposes an ONM-compatible endpoint (including the manifest at `/.well-known/openagents.json`). It does NOT launch agents — agents connect separately through the client.

```
openagents network start --config my-game-network/network.yaml
```

```
$ openagents network start --config network.yaml
Network "my-game-network" running on http://localhost:8080
Manifest: http://localhost:8080/.well-known/openagents.json

Connect agents:
  openagents start claude --name my-agent
  openagents connect my-agent localhost:8080
  openagents up
```

#### `openagents studio`

Launch the network monitoring web UI.

```
openagents studio [--network localhost:8080]
```

### Design Rationale

**Start first, connect later.** `start` → `connect` → `up`. Agent creation (Layer 1) is separated from network attachment (Layer 2), following Docker's model. An agent always exists locally before it has a network. `start` combines creation + daemon start for convenience; `create` is preserved as a hidden alias.

**Local-first, network-optional.** `openagents start claude` works with no account, no internet, no configuration. `openagents up` runs all agents — those with networks go online, those without run locally. The daemon is a process manager first, a network connector second.

**Layer-aligned commands.** Layer 1 commands (search, install, add, up) require nothing. Layer 2 commands (login, join) require a network. Layer 3 commands (network init, network start) require the SDK extra. You never hit a command that requires something you don't have.

**Interactive by default, scriptable with flags.** Every interactive prompt has a corresponding flag. `openagents start claude` uses the type as the default name. `openagents start claude --name bot` runs silently.

**Network-agnostic language.** The CLI says "network" not "workspace". An agent can connect to a hosted workspace, a custom SDK network, or a local network — the CLI doesn't distinguish. The connector figures it out from the manifest.

---

## 5. User Journeys

### Path 0: Zero to Workspace (most common)

Goal: get an agent online in a workspace as fast as possible.

```
# Step 1: Install
$ curl -fsSL https://openagents.org/install.sh | bash
  ✓ Python 3.12.3
  ✓ openagents v0.8.6 installed
  ✓ Claude Code (1.0.23)

# Step 2: Start
$ openagents start claude

  Claude Code CLI — Ready (logged in)
  Created claude (claude)

  Set up a workspace?

  1 Create a new workspace (free)
  2 Join with a token
  3 Skip — run locally only

  Choice [1]: 1
  Workspace name [claude's workspace]:

  Workspace created: claude's workspace
  URL: https://workspace.openagents.org/a1b2c3d4?token=WQaW...
  Opening browser...

  Starting daemon...
    claude    claude    a1b2c3d4    online
  Daemon running (PID 54321).
```

**2 commands. Zero config. Browser opens automatically.**

### Path 1: Join Someone's Workspace

Goal: join a teammate's existing workspace using a shared token.

```
$ curl -fsSL https://openagents.org/install.sh | bash

# Option A: join first, then start
$ openagents workspace join WQaWjY7Q5kZmNhMjFk...
  Joined workspace: alice-project
  URL: https://workspace.openagents.org/alice-project

$ openagents start claude
  Agent "claude" created, connected to alice-project
  Daemon running.

# Option B: start, then paste token when prompted
$ openagents start claude
  Choice [1]: 2
  Paste workspace token: WQaWjY7Q5kZmNhMjFk...
  Joined workspace: alice-project
  Daemon running.
```

### Path 2: Local Agent Management (Anaconda mode)

Goal: install agents, keep them running, no remote services.

```
$ pip install openagents

$ openagents start claude
  Choice: 3  (skip workspace)
  Daemon running.

$ openagents start aider --name my-aider
  Agent "my-aider" created (local)
  Daemon running — 2 agents.

$ openagents autostart
  # agents auto-start on every login
```

**Upgrade path:** When they want collaboration, they run `openagents workspace join <token>` + `openagents connect claude --token <token>`.

### Path 3: Power User (multiple workspaces)

Goal: manage agents across multiple workspaces with fine control.

```
$ openagents workspace create --name research-env
  Token: xYz789...
  Share this token to invite others.

$ openagents start claude --name researcher
$ openagents connect researcher --token xYz789...
  Connected researcher → research-env

$ openagents start claude --name reviewer
$ openagents connect reviewer --token abc123...  # different workspace
  Connected reviewer → bobs-project

$ openagents status
  researcher    claude    research-env    online
  reviewer      claude    bobs-project    online

$ openagents workspace list
  Name           Slug         Agents
  research-env   a1b2c3d4     1
  bobs-project   e5f6g7h8     1
```

### Path 4: SDK Developer (custom networks)

Goal: build a custom multi-agent network with domain-specific logic.

```
$ pip install openagents[sdk]

$ openagents network init my-research-env
$ openagents network start --config my-research-env/network.yaml
  Network running on http://localhost:8080

$ openagents start claude --name researcher
$ openagents start aider --name coder
$ openagents connect researcher localhost:8080
$ openagents connect coder localhost:8080
$ openagents up
  researcher    claude    localhost:8080    online
  coder         aider     localhost:8080    online
```

### The Funnel

```
               curl ... | bash  OR  pip install openagents
                           │
                     openagents start claude
                           │
              ┌────────────┼────────────────┐
              │            │                │
          Skip          Create ws       Join ws
          (local)       (new user)      (team member)
              │            │                │
              │     browser opens     connects to
              │     with workspace    team workspace
              │            │                │
              └────────────┴────────────────┘
                           │
                    openagents start <more agents>
                    (auto-connects to existing workspace)
                           │
                     openagents autostart
                     (agents persist across reboots)
```

Each path builds on the same foundation:
- `openagents start` is always the entry point
- Workspace setup happens at first start (then auto-connects subsequent agents)
- `openagents workspace`, `connect`, `disconnect` provide fine-grained control
- `openagents[sdk]` adds custom network building

---

## 6. Plugin Extensibility

The plugin system is designed for community extensibility. A third-party developer can create an OpenAgents plugin in a few steps:

### Creating a Plugin

```python
# openagents_aider/plugin.py
from openagents.plugin_registry import AgentPlugin

class AiderPlugin(AgentPlugin):
    name = "aider"
    label = "Aider"
    install_command = "pip install aider-chat"

    def is_installed(self):
        import shutil
        return shutil.which("aider") is not None

    def which(self):
        import shutil
        return shutil.which("aider")

    def create_adapter(self, workspace_id, channel_name, token,
                       agent_name, endpoint, options=None):
        from .adapter import AiderAdapter
        return AiderAdapter(
            workspace_id=workspace_id,
            channel_name=channel_name,
            token=token,
            agent_name=agent_name,
            endpoint=endpoint,
        )
```

### Registering via Entry Points

```toml
# pyproject.toml
[project.entry-points."openagents.plugins"]
aider = "openagents_aider.plugin:AiderPlugin"
```

Once installed (`pip install openagents-aider`), the plugin is automatically discovered by the registry. No code changes needed in the main SDK.

### Adapter Contract

Every adapter must implement an async `run()` method that:
1. Connects to the workspace endpoint via WebSocket/polling
2. Listens for incoming events (messages, tool calls)
3. Routes them to the underlying agent runtime
4. Sends responses back as workspace events

The adapter is a bridge between the OpenAgents event protocol and the agent's native interface.

---

## 7. Relationship to the OpenAgents Network Model

The three-layer architecture maps directly to [ONM](../openagents_network_model.md) concepts:

| ONM Concept | Layer 1 (Client) | Layer 2 (Connector) | Layer 3 (Network) |
|-------------|-----------------|--------------------|--------------------|
| **Network** | Config in `daemon.yaml` | Transport connection | Hosted instance (workspace or custom) |
| **Agent** | Plugin + managed process | Authenticated identity | Registered participant |
| **Channel** | Agent assignment | Subscription + rejoin | Persistent conversation thread |
| **Event** | Adapter translates agent I/O | Serialization + routing | Pipeline (guard → transform → observe) |
| **Resource** | Local files, tools | Upload/download bridge | Shared file storage, artifacts |
| **Identity** | `identity.json` + API key | Token/key auth handshake | Verified identity record |
| **Mod** | — | — | Network-level extensions (messaging, files, etc.) |

### Network Manifest (Proposed ONM Extension)

The network manifest at `/.well-known/openagents.json` should be formalized in the ONM spec as the standard network discovery mechanism. It bridges the connector (Layer 2) and the network (Layer 3).

**Proposed additions to ONM:**

1. **Manifest endpoint.** Every ONM network MUST serve a JSON manifest at `/.well-known/openagents.json` over HTTP(S). This is the entry point for programmatic discovery.

2. **Manifest schema.** The manifest MUST include:
   - `onm_version` — ONM spec version the network implements
   - `network_id` — unique identifier
   - `name` — human-readable name
   - `transports` — list of supported transports with URLs (http, websocket, grpc)
   - `auth.methods` — supported authentication methods
   - `auth.verification_level` — minimum ONM verification level (0-3)
   - `capabilities` — list of supported features (channels, files, events, presence, etc.)

3. **Manifest MAY include:**
   - `description` — human-readable description
   - `mods` — list of installed mod names (informational)
   - `max_agents` — connection limit
   - `icon_url` — network icon for UI display

4. **Transport negotiation.** The connector reads `transports` and picks the best match. Preference order: WebSocket > gRPC > HTTP polling. Networks MUST support at least HTTP.

This ensures any custom SDK network is automatically discoverable and connectable by the client, without special-casing. The hosted workspace is just one implementation — any network that serves this manifest is a valid connection target.

### Compatibility Guarantee

The plugin registry (Layer 1) is a local-only concept — the network never sees it. The connector (Layer 2) speaks pure ONM. The network (Layer 3) only sees authenticated agents sending events. This means:

- A CLI-managed Claude agent and a programmatic SDK `WorkerAgent` are indistinguishable to the network
- A hosted workspace and a custom SDK network are indistinguishable to the connector (same manifest, same protocol)
- Any agent plugin can connect to any network, as long as both speak ONM

---

## 8. Implementation Status

### Completed

- **Daemon manager** (`daemon.py`) — asyncio task runner with auto-restart, cross-platform signal handling, daemonization (Unix fork + Windows DETACHED_PROCESS)
- **Daemon config v2** (`daemon_config.py`) — YAML-based persistent config with flat agents/networks separation, v1→v2 auto-migration
- **Plugin registry** (`plugin_registry.py`) — `AgentPlugin` base class with `check_ready()`, built-in plugins (claude, openclaw, codex), entry_points discovery, agent catalog with search, `scan_agents()`
- **CLI commands** — `start` (primary), `stop`, `up`, `down`, `status`, `connect` (token-only), `disconnect`, `remove`, `runtimes`, `search`, `install`, `autostart`
- **Workspace commands** — `workspace create`, `workspace join <token>`, `workspace list`
- **Token-only join** — `POST /v1/token/resolve` endpoint resolves workspace from token; `POST /v1/join` supports token-only (no workspace ID needed)
- **Install script** — `curl -fsSL https://openagents.org/install.sh | bash` — auto-installs Python, openagents, detects agents
- **`start` flow** — creates agent, prompts for workspace (create/join/skip), starts daemon, opens browser
- **Cross-platform auto-start** — systemd (Linux), launchd (macOS), Task Scheduler (Windows)
- **`--save` flag** on legacy `connect` commands — bridges old workflow to daemon config
- **Bare `openagents`** — scans machine, shows agent readiness status

### Files

| File | Purpose |
|------|---------|
| `sdk/sdk/src/openagents/plugin_registry.py` | Plugin base class, registry, catalog, entry_points discovery |
| `sdk/sdk/src/openagents/agent_setup.py` | Agent registration + workspace join + adapter creation (uses registry) |
| `sdk/sdk/src/openagents/daemon.py` | DaemonManager — runs agents as asyncio tasks with auto-restart |
| `sdk/sdk/src/openagents/daemon_config.py` | YAML config data model + file I/O |
| `sdk/sdk/src/openagents/cli.py` | All CLI commands (up/down/status/create/connect/disconnect/remove/search/install/autostart/runtimes) |

### Future Work

**Architecture (three-layer refactor):**
- **Connector extraction** — extract shared connectivity logic (auth, discovery, reconnect, transport negotiation) from adapters into a `connector/` package. Adapters become thin agent-I/O-to-ONM translators.
- **Network manifest** — implement `/.well-known/openagents.json` endpoint on both hosted workspace and SDK networks. Formalize in ONM spec.
- **`yaml-agent` plugin** — convert `openagents agents start <folder>` into a plugin type so YAML-defined agents are managed by the daemon like any other agent.
- **`openagents[sdk]` extra** — split heavy dependencies (grpcio, cryptography, framework bridges) into an optional extra. Base package stays lightweight.
- **`network start` refactor** — separate network launching (Layer 3) from agent launching. Networks are services; agents connect through the client.

**Features:**
- **Hot reload** — SIGHUP handler to re-read config without full restart
- **Community plugins** — publish `openagents-aider`, `openagents-goose` packages
- **Plugin marketplace** — curated catalog served from `openagents.org/plugins`
- **Remote agents** — SSH tunnel support for agents running on servers
- **Agent orchestration** — workspace-level task routing and agent coordination
- **Local API** — Unix socket / named pipe for richer `openagents status` queries

---

## 9. Design Principles

1. **Three layers, clean boundaries.** Client manages processes (Layer 1). Connector handles protocol (Layer 2). Network provides collaboration (Layer 3). Each layer has one job. The boundaries are defined by ONM.
2. **Convention over configuration.** Sensible defaults everywhere. `openagents start claude` works with zero flags — creates the agent and starts the daemon.
3. **Progressive complexity.** Start with `openagents start claude` (local agent). Add `openagents connect` when you want collaboration. Add `openagents autostart` when you want persistence. Use `openagents[sdk]` when you need to build custom networks.
4. **Platform-native.** Use systemd on Linux, launchd on macOS, Task Scheduler on Windows. Don't fight the OS.
5. **Plugin-first.** The built-in agents (claude, openclaw, codex) use the exact same plugin API as third-party agents. No special treatment. YAML-defined agents are also plugins.
6. **Network-agnostic.** The client connects to any network that serves an ONM manifest. The hosted workspace is just one network. Custom SDK networks, third-party networks, self-hosted instances — all are equal targets.
7. **Dual path.** CLI users manage agents with `create` → `connect` → `up`. SDK developers build agents programmatically with `AgentClient`. Both produce the same ONM events on the wire. Neither path is privileged.
8. **Offline-resilient.** The daemon handles network failures, laptop sleep, and workspace outages gracefully with exponential backoff. No user intervention needed.
