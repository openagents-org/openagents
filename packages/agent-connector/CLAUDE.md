# Agent Connector (@openagents-org/agent-launcher)

Core engine and CLI for the OpenAgents ecosystem. Handles agent discovery, installation, configuration, daemon-based execution, and workspace integration. Published to npm as `@openagents-org/agent-launcher`.

## Architecture

```
src/
  index.js           AgentConnector class — main API surface (registry, agent CRUD, install, env, workspace, daemon)
  cli.js             CLI entry point (`agn` command): search, install, create, env, up/down, status, start/stop, logs, connect
  daemon.js          Long-running background process: spawns/monitors agent subprocesses, auto-restart with backoff, file-based IPC
  config.js          YAML config manager for ~/.openagents/daemon.yaml (agents, networks)
  registry.js        Agent catalog: fetches from remote API or bundled registry.json, 24h cache
  installer.js       Agent runtime installer: npm/curl/binary, tracks in installed_agents.json
  env.js             Environment manager: ~/.openagents/env/<type>.env, resolve_env rules for generic→provider mapping
  workspace-client.js HTTP client for workspace REST API: register, join, poll messages, send events, files, browser, todos, timers
  mcp-server.js      JSON-RPC 2.0 over stdio: exposes workspace tools to agents via MCP protocol
  identity.js        Agent identity storage (~/.openagents/identity.json)
  paths.js           Cross-platform binary resolution (nvm, fnm, volta, homebrew, pip, cargo, etc.)
  tui.js             Interactive terminal dashboard (blessed library)

  adapters/
    base.js           BaseAdapter — polling loop, heartbeat, channel dispatch, task queuing, session management
    claude.js         ClaudeAdapter — spawns `claude` CLI with stream-json, per-channel sessions
    openclaw.js       OpenClawAdapter — TCP/HTTP gateway to OpenClaw daemon, skill auto-install
    codex.js          CodexAdapter — OpenAI Codex CLI bridge
    opencode.js       OpenCodeAdapter — opencode-ai CLI bridge
    nanoclaw.js       NanoClawAdapter — direct OpenAI-compatible API calls (no CLI binary)
    cursor.js         CursorAdapter — extends LlmDirectAdapter for Cursor CLI
    hermes.js         HermesAdapter — Nous Research Hermes bridge
    gemini.js         GeminiAdapter — Google Gemini CLI bridge (legacy — superseded by antigravity)
    antigravity.js    AntigravityAdapter — Google Antigravity CLI (`agy -p`) bridge, stream-json NDJSON
    antigravity-stream.js  Pure helpers for AntigravityAdapter (argv builder, event reducer, failure classification, binary candidates) — unit-tested
    copilot.js        CopilotAdapter — official GitHub Copilot CLI (`copilot`) bridge, JSONL stream
    copilot-stream-parser.js  Pure JSONL framing + event classification for Copilot CLI
    cline.js          ClineAdapter — Cline CLI bridge (`cline --json`, one run per message)
    cline-stream.js   Pure helpers for ClineAdapter (NDJSON parser, event mapping, redaction, error/auth/version classify, arg builder, session correlation) — unit-tested
    deepseek.js       DeepSeekAdapter — DeepSeek Harness (`dsh --profile headless`) bridge, one process per message
    deepseek-runtime.js  Pure helpers for DeepSeekAdapter (prerelease-aware version gate, argv, private cordis patch, task-file paths, stderr classification, session GC) — unit-tested
    commandcode.js    CommandCodeAdapter — Command Code CLI (`command-code -p --output-format json`) bridge, prompt piped over stdin, one run per message
    commandcode-stream.js  Pure helpers for CommandCodeAdapter (argv builder, NDJSON frame interpreter, exit-code classification, version gate, redaction) — unit-tested
    llm-direct.js     LlmDirectAdapter — base for adapters that call LLM APIs directly (SSE streaming)
    index.js          Adapter registry mapping type names to classes
    utils.js          Shared adapter utilities
    workspace-prompt.js  System prompt generation for workspace-connected agents

registry.json        Bundled catalog of agents with metadata, install commands, env config, readiness checks
```

## How the daemon works

1. `daemon.js` reads `~/.openagents/daemon.yaml` for agent configs
2. For each enabled agent, spawns its adapter (resolved via `adapters/index.js`)
3. Adapter connects to workspace via `workspace-client.js`, polls for messages
4. Messages dispatched per-channel with task queuing (one task per channel at a time)
5. Adapter spawns agent CLI subprocess (or calls API directly) to handle each message
6. Agent calls MCP tools via `mcp-server.js` (stdio JSON-RPC) for workspace operations
7. Results posted back to workspace
8. Daemon monitors health, restarts on failure with exponential backoff
9. Commands received via `~/.openagents/daemon.cmd` file (reload, start:name, stop:name)
10. Status written to `~/.openagents/daemon.status.json`

## Commands

```bash
npm test                    # Run tests (node --test)
npm run lint                # ESLint
npm run build:registry      # Rebuild registry.json from source

# CLI (after npm install -g or via npx)
agn search [query]          # Browse agent catalog
agn install <type>          # Install agent runtime
agn create <name> --type <type>  # Create agent instance
agn env <type> --set K=V    # Set environment variables
agn up / agn down           # Start/stop daemon
agn status                  # Show daemon and agent status
agn start/stop <name>       # Control individual agents
agn logs                    # View daemon logs
agn connect <agent> <token> # Connect agent to workspace
```

## Tests

Tests are in `test/` using Node.js built-in test runner. Existing test files:
`cli.test.js`, `config.test.js`, `daemon.test.js`, `env.test.js`, `index.test.js`, `installer.test.js`, `paths.test.js`, `registry.test.js`, `stop-control.test.js`, `workspace-client.test.js`

## MCP tool modules (exposed to agents)

- **Core** (always on): `workspace_get_history`, `workspace_get_agents`, `workspace_status`
- **Files**: `workspace_list_files`, `workspace_read_file`, `workspace_write_file`, `workspace_delete_file`
- **Browser**: `workspace_browser_open`, `workspace_browser_navigate`, `workspace_browser_click`, `workspace_browser_type`, `workspace_browser_screenshot`, `workspace_browser_snapshot`, `workspace_browser_close`, `workspace_browser_list_tabs`, `workspace_browser_list_contexts`
- **Tunnel**: `workspace_tunnel_expose`, `workspace_tunnel_close`, `workspace_tunnel_list`
- **Todos**: `workspace_put_todos`, `workspace_get_todos`
- **Timers**: `workspace_create_timer`, `workspace_list_timers`, `workspace_cancel_timer`
- **Routines**: `workspace_create_routine`, `workspace_list_routines`, `workspace_cancel_routine`

## Key design patterns

- **Adapter pattern**: Each agent type plugs in via a class extending BaseAdapter
- **File-based IPC**: Daemon communicates with CLI/launcher via daemon.cmd, daemon.status.json, daemon.pid
- **Event cursor**: Each adapter tracks last-seen event ID to avoid reprocessing
- **Resolve env**: Generic LLM_* vars mapped to provider-specific vars (OPENAI_API_KEY vs ANTHROPIC_API_KEY) based on base URL
- **Isolated runtimes**: Each agent type gets own npm prefix at ~/.openagents/runtimes/<type>/
- **Adaptive polling**: 2s active → 5s warm plateau (5 min) → ramp to 15s cold
