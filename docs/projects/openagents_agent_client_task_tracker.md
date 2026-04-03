# OpenAgents Agent Client — Task Tracker

**Last updated:** 2026-03-20

## Repository Layout

```
openagents/
├── src/openagents/              # Python SDK (backend, ONM, adapters)
├── packages/
│   ├── agent-connector/         # @openagents-org/agent-connector (Node.js library + CLI)
│   └── launcher/       # OpenAgents Launcher — desktop app (Windows/macOS/Linux)
└── workspace/
    ├── backend/                 # workspace backend (FastAPI)
    └── frontend/                # workspace frontend
```

---

## Part 1: Completed (Python SDK + Desktop App)

| # | Task | Files | Status |
|---|------|-------|--------|
| 1 | Daemon manager — asyncio task runner, auto-restart, cross-platform signals | `daemon.py` | Done |
| 2 | Daemon config v2 — flat agents/networks, v1 auto-migration | `daemon_config.py` | Done |
| 3 | Plugin registry — `AgentPlugin` base, built-ins, entry_points, catalog | `plugin_registry.py` | Done |
| 4 | Plugin `check_ready()` — credential/config detection per agent type | `plugin_registry.py` | Done |
| 5 | `scan_agents()` — machine-wide agent readiness scan | `plugin_registry.py` | Done |
| 6 | Agent setup extraction — shared register/join/adapter logic | `agent_setup.py` | Done |
| 7 | CLI `start` command — idempotent, creates agent + prompts workspace + starts daemon | `cli.py` | Done |
| 8 | CLI `stop` command — stop daemon (individual agent stop is TODO) | `cli.py` | Done |
| 9 | CLI `connect` — token-only join (no workspace ID needed) | `cli.py` | Done |
| 10 | CLI `disconnect` — detach agent from network | `cli.py` | Done |
| 11 | CLI `workspace create` — create workspace, get token | `cli.py` | Done |
| 12 | CLI `workspace join <token>` — join with token-only | `cli.py` | Done |
| 13 | CLI `workspace list` — list configured workspaces | `cli.py` | Done |
| 14 | Backend `POST /v1/token/resolve` — resolve workspace from token | `network.py` | Done |
| 15 | Backend `POST /v1/join` — support token-only (no network ID) | `network.py` | Done |
| 16 | SDK `resolve_token()` — client method for token resolution | `workspace_client.py` | Done |
| 17 | SDK `join_network()` — optional network param | `workspace_client.py` | Done |
| 18 | Install script — `curl \| bash`, auto-installs Python, detects agents | `install.sh` | Done |
| 19 | Bare `openagents` scan — shows agent readiness on no subcommand | `cli.py` | Done |
| 20 | CLI `up/down/status` — daemon lifecycle | `cli.py` | Done |
| 21 | CLI `install` — install agent runtimes with npm detection | `cli.py` | Done |
| 22 | CLI `search` — browse agent catalog | `cli.py` | Done |
| 23 | CLI `autostart` — systemd/launchd/Task Scheduler | `cli.py` | Done |
| 24 | Cross-platform daemonize — Unix fork + Windows DETACHED_PROCESS | `daemon.py` | Done |
| 25 | Config v1→v2 migration | `daemon_config.py` | Done |
| 26 | Commit all uncommitted changes (plugin registry, CLI, daemon, config, install) | all | Done |
| 27 | Update concept doc — `create` → `start` in user-facing examples | `openagents_agent_client_concept.md` | Done |
| 28 | Integration tests for `POST /v1/token/resolve` and token-only `POST /v1/join` | `test_network.py` | Done |
| 29 | Local agent process management — subprocess launch via `get_launch_command()` | `daemon.py`, `plugin_registry.py` | Done |
| 30 | Individual agent stop via file-based command (`daemon.cmd`) | `daemon.py`, `daemon_config.py`, `cli.py` | Done |
| 31 | Hot reload — SIGHUP re-reads config, starts/stops agents as needed | `daemon.py`, `cli.py` | Done |
| 32 | Workspace token rotation — `POST /v1/workspaces/{id}/rotate-token` | `workspaces.py`, `test_workspaces.py` | Done |
| 33 | Workspace member removal — `DELETE /v1/workspaces/{id}/members/{name}` | `workspaces.py`, `test_workspaces.py` | Done |
| 34 | CLI `workspace members` — list agents in a workspace via discover API | `cli.py` | Done |
| 35 | BaseAdapter extraction — common poll/heartbeat/dispatch/control logic | `adapters/base.py`, `adapters/claude.py`, `adapters/openclaw.py`, `adapters/codex.py` | Done |
| 36 | Network manifest — `GET /.well-known/openagents.json` | `workspace/backend/app/main.py`, `test_network.py` | Done |
| 37 | Workspace auto-open browser — `--no-browser` flag on `start` | `cli.py` | Done |
| 38 | `openagents update` — self-update + agent runtime check | `cli.py` | Done |
| 39 | Remote agent catalog client — 24h cache + offline fallback | `plugin_registry.py` | Done |
| 40 | CLI split — 6,154-line `cli.py` into 9 domain modules | `cli.py`, `cli_shared.py`, `cli_helpers.py`, `cli_network.py`, `cli_agent.py`, `cli_identity.py`, `cli_daemon.py`, `cli_packages.py`, `cli_legacy.py` | Done |
| 41 | `yaml-agent` plugin type — YAML-defined agents managed by daemon | `plugin_registry.py` | Done |
| 42 | Package split — `openagents[sdk]` optional extra for heavy deps | `pyproject.toml`, SDK files | Done |
| 43 | `openagents logs` — view and follow daemon logs with agent filtering | `cli_daemon.py` | Done |
| 44 | Windows installer — `install.ps1` for native PowerShell | `install.ps1` | Done |
| 45 | Homebrew formula template for `brew install openagents` | `Formula/openagents.rb` | Done |
| 46 | Agent registry API — model, CRUD endpoints, 15 tests | `openagents-web: models.py, agent_registry.py, test_agent_registry.py` | Done |
| 47 | Repository restructure — layered architecture (3 phases) | `src/openagents/client/`, `src/openagents/sdk/`, `src/openagents/core/` | Done |
| 48 | CI pipeline split — client-tests (fast) + sdk-tests (full) | `.github/workflows/pytest.yml` | Done |

### Desktop App (Electron) — Completed

| # | Task | Status |
|---|------|--------|
| D1 | Scaffold Electron app — main process, preload, renderer | Done |
| D2 | System tray with agent status menu | Done |
| D3 | PythonManager — detect Python, check SDK version | Done |
| D4 | AgentManager — read daemon.yaml, env files, status, logs | Done |
| D5 | YAML parser for daemon.yaml (PyYAML indent-0 list format) | Done |
| D6 | Custom JSON store (replaced electron-store ESM issue) | Done |
| D7 | Windows path quoting fix (`C:\Program Files` spaces) | Done |
| D8 | Bypass interactive CLI prompts (use Python SDK directly) | Done |
| D9 | Dashboard tab — agent cards with status, start/stop | Done |
| D10 | Agents tab — add/remove agents, context menu actions | Done |
| D11 | Install tab — Python/SDK status, agent catalog with install/update/uninstall | Done |
| D12 | Logs tab — read daemon.log with agent filter | Done |
| D13 | Settings tab — start on boot, minimize to tray | Done |
| D14 | Configure agent — modal with env fields, save, test connection | Done |
| D15 | Workspace connect/disconnect/create/join-with-token | Done |
| D16 | Fix CSP — replace inline onclick with data-action event delegation | Done |
| D17 | Fix workspace polling — remove member filter from poll_pending | Done |
| D18 | Uninstall agent types — derive uninstall cmd + clear install markers | Done |
| D19 | Hide Electron menu bar on Windows/Linux | Done |
| D20 | Signal daemon reload after config changes | Done |

---

## Part 2: Desktop App — Pending

| # | Task | Priority | Status | Notes |
|---|------|----------|--------|-------|
| D21 | Fix GBK encoding — garbled error messages on Chinese locale Windows | Medium | Done | chcp 65001, PYTHONIOENCODING=utf-8, setEncoding('utf-8') on streams |
| D22 | Auto-install dependencies — Node.js, Git, etc. when installing agent type | Low | Done | Checks required deps before install, warns if missing |
| D23 | Login for agent types — agent-specific login (e.g. `claude login`) | Low | Done | Login button in agent actions modal, runs agent-specific login commands |
| D24 | Daemon start/stop toggle — explicit daemon on/off button | Low | Done | Clickable daemon status bar toggles start/stop |
| D25 | Activity log panel — live action feed on dashboard | Low | Done | Captures toast events as activity feed on dashboard |
| D26 | Responsive agent cards — adapt layout to window size | Low | Done | CSS grid on wide screens, collapsed sidebar on narrow |
| D27 | Loading states — spinners during async operations | Low | Done | Spinner animation on buttons during async ops |
| D28 | Auto-refresh logs — scroll to bottom, periodic refresh on logs tab | Low | Done | 3s auto-refresh with toggle checkbox |
| D29 | Workspace URL display — show full URL, not just slug | Low | Done | Full URLs with tokens in Settings tab |
| D30 | Move app from `workspace/apps/launcher/` to `packages/launcher/` | High | Done | Already moved in repo restructure |

---

## Part 3: Node.js Agent Connector — `@openagents-org/agent-connector`

**Goal:** Extract agent management into a standalone Node.js package that works as both a CLI tool (Linux/headless) and a library (Electron app on Windows/macOS). Eliminates the Python dependency for users who only run Node-based agents.

**Why:** The current Electron app shells out to `python -m openagents` for every operation. This requires Python 3.10+ installed, causes subprocess quoting/encoding bugs on Windows, and doubles memory usage (Python daemon + Node agent). Most supported agents are Node.js — requiring both runtimes is unnecessary friction.

**Design principles:**
- CLI-first: `npx @openagents-org/agent-connector up` works on headless Linux
- Library: `require('@openagents-org/agent-connector')` for Electron app
- Cross-platform: Windows, macOS, Linux — first-class support for all three
- Remote-first registry with bundled offline fallback
- Zero Python dependency for Node-based agent workflows

### Package Structure

```
packages/agent-connector/
├── src/
│   ├── index.js              # main export — AgentConnector class
│   ├── config.js             # daemon.yaml read/write
│   ├── env.js                # ~/.openagents/env/<type>.env read/write + resolve_env
│   ├── registry.js           # remote agent catalog fetch + cache + offline fallback
│   ├── installer.js          # npm/pip install/uninstall + install markers
│   ├── daemon.js             # process spawn/monitor/stop, PID file, log rotation
│   ├── workspace-client.js   # HTTP client for workspace API
│   ├── utils.js              # testLLMConnection helper
│   └── cli.js                # CLI entry point
├── registry.json             # bundled fallback catalog
├── package.json
├── bin/
│   └── agent-connector       # CLI binary → src/cli.js
└── test/
```

### Tasks

| # | Task | Priority | Status | Notes |
|---|------|----------|--------|-------|
| N1 | Scaffold package — package.json, directory structure, bin entry | High | Done | `@openagents-org/agent-connector`, MIT license, bin entry for CLI |
| N2 | `config.js` — read/write `daemon.yaml`, agent/network CRUD | High | Done | YAML parser + serializer, agent/network CRUD, status/PID/cmd/logs |
| N3 | `env.js` — read/write env files, `resolve_env` rules | High | Done | Load/save/delete env files, conditional resolve_env rules |
| N4 | `registry.js` — fetch agent catalog from remote API + cache | High | Done | Remote → 24h cache → bundled fallback, background refresh |
| N5 | Generate `registry.json` — YAML plugin defs to JSON build step | High | Done | `scripts/build-registry.js`, 13 agent entries |
| N6 | `installer.js` — install/uninstall agent runtimes | High | Done | npm/pip/pipx install/uninstall, dual marker format, binary detection |
| N7 | `daemon.js` — agent process lifecycle management | High | Done | Spawn, auto-restart + backoff, PID file, status, cmd protocol, signals, daemonize |
| N8 | `workspace-client.js` — workspace API HTTP client | High | Done | Register, create, join, resolve, heartbeat, disconnect, events, messages |
| N9 | `cli.js` — CLI commands for Linux/headless use | High | Done | 18 commands: up, down, status, list, create, remove, start, stop, install, uninstall, search, runtimes, connect, disconnect, env, test-llm, logs, workspace. Zero dependencies. |
| N10 | Cross-platform PATH detection | Medium | Done | paths.js: nvm/fnm/volta, Homebrew, pip, cargo, npm global, Windows Program Files |
| N11 | Agent health check — binary existence + version check | Medium | Done | healthCheck() returns { installed, binary, version } |
| N12 | Log management — write, rotate, tail, filter | Medium | Done | Rotate at 10MB, tailLogs() with byte offset for incremental reads |
| N13 | Config hot-reload — watch `daemon.yaml` for changes | Medium | Done | fs.watch + 1s debounce, diff agent names, start/stop as needed |
| N14 | `autostart` — register as system service | Low | Done | systemd (Linux), launchd (macOS), Task Scheduler (Windows) |
| N15 | Tests — unit tests for all modules | High | Done | 73 tests passing (config, env, registry, installer, daemon, workspace-client, CLI, paths) |
| N16 | CI pipeline — lint, test, publish | Medium | Done | GitHub Actions on ubuntu/macos/windows with Node 18/20/22, auto-publish on main |
| N17 | Wire Electron app to use package directly | High | Done | Replaced agent-manager.js (690→210 lines), removed PythonManager, updated Install tab UI |
| N18 | Global install CLI — `npm install -g @openagents-org/agent-connector` | Medium | Done | Tested on macOS + Windows, v0.2.7 published, .cmd shim works |

### Desktop App Distribution

| # | Task | Priority | Status | Notes |
|---|------|----------|--------|-------|
| N19 | macOS app — DMG, code signing, auto-update | Low | Pending | electron-builder, Apple Developer cert |
| N20 | Windows app — NSIS installer, code signing, auto-update | Low | Pending | electron-builder, EV cert, bundle Node.js if not detected |
| N21 | Linux app — AppImage + .deb + .rpm | Low | Pending | electron-builder, universal + distro-specific |

### Migration Path

**Phase 1 — Core library (N1-N6):** Scaffold, port config/env/registry/installer. Mostly file I/O and HTTP. Electron app unchanged.

**Phase 2 — Daemon + workspace (N7-N8):** Port process manager and workspace client. Daemon is the complex piece (signals, auto-restart, cross-platform).

**Phase 3 — CLI (N9):** Build CLI for headless Linux. Commands mirror existing `openagents` CLI.

**Phase 4 — Electron integration (N17):** Wire Electron app to use package directly. The real payoff — no more subprocess calls.

**Phase 5 — Distribution (N18-N21):** npm global install, platform-specific app packaging.

### What Stays in Python

- **Workspace backend** (`workspace/backend/`) — FastAPI + PostgreSQL, server-side
- **ONM primitives** (`src/openagents/core/onm_*.py`) — shared protocol definitions
- **Python SDK** (`src/openagents/sdk/`) — custom agents/networks in Python
- **Python-based agents** (Aider, SWE-bench) — connector just runs `pip install` + spawns binary
- **Adapters** (`src/openagents/adapters/`) — agent protocol bridges, run inside daemon

### API Surface

```js
const { AgentConnector } = require('@openagents-org/agent-connector');
const connector = new AgentConnector({ configDir: '~/.openagents' });

// Registry
await connector.getCatalog();                      // [{name, label, installed, ...}]
await connector.getEnvFields('openclaw');           // [{name, required, description}]

// Install / Uninstall
await connector.install('openclaw');                // npm install -g openclaw@latest
await connector.uninstall('openclaw');              // npm uninstall -g openclaw
await connector.isInstalled('openclaw');            // true/false

// Agent CRUD
connector.listAgents();                            // [{name, type, state, network, env}]
connector.addAgent({ name, type });
connector.removeAgent('my-agent');
connector.getAgentEnv('openclaw');
connector.saveAgentEnv('openclaw', { LLM_API_KEY });

// Daemon lifecycle
await connector.start();                           // start all agents
await connector.stop();                            // stop all
await connector.startAgent('my-agent');
await connector.stopAgent('my-agent');
connector.getStatus();                             // {agents: {name: {state, restarts}}}
connector.getLogs({ agent: 'my-agent', lines: 100 });

// Workspace
await connector.connectWorkspace('my-agent', slug);
await connector.disconnectWorkspace('my-agent');
await connector.createWorkspace('my-ws');
await connector.listWorkspaces();
await connector.testLLM({ LLM_API_KEY, LLM_BASE_URL, LLM_MODEL });
```

---

## Part 4: Legacy Pending (Python SDK)

| # | Task | Priority | Notes |
|---|------|----------|-------|
| P8 | `network start` refactor | Low | Separate network launching (Layer 3) from agent launching |
| P9 | Community plugins | Low | Publish `openagents-aider`, `openagents-goose` as pip packages |
| P10 | Agent registry API — seed data + deployment | Medium | Seed agents into DB, deploy to `endpoint.openagents.org` |
| P11 | Remote agents via SSH tunnel | Low | Agents on remote servers via SSH tunnel |
| P25 | Update internal docs — agent workspace concept | Medium | Reflect latest concept in internal docs |
| P27 | README rewrite — three-layer narrative | High | Full rewrite with layered narrative |
