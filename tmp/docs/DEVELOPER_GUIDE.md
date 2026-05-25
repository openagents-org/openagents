# OpenAgents Workspace — Developer Guide

## Architecture Overview

```
workspace/backend/    — FastAPI + SQLAlchemy + PostgreSQL (Railway)
workspace/frontend/   — Next.js 16 + React 19 + Tailwind (Vercel)
packages/agent-connector/ — Node.js agent daemon + MCP tools (npm: @openagents-org/agent-launcher)
```

## Backend (workspace/backend/)

### Stack
- FastAPI, SQLAlchemy 2.0, PostgreSQL (SQLite for tests), Alembic migrations
- Entry point: `app/main.py`

### Event System (ONM)
Everything is an event flowing through a mod pipeline:
1. **AuthMod** (priority 0) — Verify workspace token or Firebase bearer
2. **WorkspaceMod** (priority 50) — Route messages, manage sessions, channel CRUD
3. **PersistenceMod** (priority 90) — Save to `events` table

Key event types:
- `workspace.message.posted` — Chat message (payload: content, message_type, sender_type)
- `network.agent.join/leave` — Agent presence
- `network.channel.create/delete` — Thread lifecycle
- `workspace.agent.control` — Mode changes, stop signals

### API Routers (all prefixed `/v1`)
| Router | Prefix | Purpose |
|--------|--------|---------|
| `events.py` | `/v1/events` | Post/poll ONM events |
| `network.py` | `/v1` | Agent join/leave/heartbeat/discover |
| `workspaces.py` | `/v1/workspaces` | Workspace CRUD, settings |
| `browser.py` | `/v1/browser` | Shared browser tabs |
| `files.py` | `/v1/files` | File upload/download |
| `routines.py` | `/v1/routines` | Recurring scheduled tasks |
| `timers.py` | `/v1/timers` | One-shot delayed messages |
| `todos.py` | `/v1/todos` | Task tracking |

### Models (app/models.py)
Core: `EventRecord`, `Workspace`, `WorkspaceMember`, `Channel`, `ChannelMember`
Features: `BrowserTab`, `BrowserContext`, `FileRecord`, `TodoRecord`, `TimerRecord`, `RoutineRecord`

### Auth
- `X-Workspace-Token` header = `workspace.password_hash`
- `Authorization: Bearer <firebase_token>` for email-based access
- No token = open workspace

### Adding a New Feature (Backend)
1. Add model to `app/models.py` if new table needed
2. Create alembic migration in `alembic/versions/` (numbered: 001_, 002_, etc.)
3. Add router in `app/routers/` with endpoints
4. Register router in `app/main.py` (`app.include_router(...)`)
5. If background processing needed, add to `_timer_loop()` in `app/main.py`
6. If channel locking needed, update guards in `app/mods/workspace_mod.py`

### Key Patterns
- **Workspace resolution**: `_resolve_workspace(db, network_id_or_slug)` + `_verify_workspace_access(workspace, token, auth_header)`
- **Event emission**: `await _emit_event(event, workspace, db, token=...)`
- **Response format**: `success_response(data)` or `json_response(ResponseCode.ERROR, "message")`
- **JSONB settings**: Store feature flags in `workspace.settings` dict (e.g., `browser_enabled`, `browserfabric_api_key`)

### Background Timer Loop (app/main.py)
Runs every 10 seconds:
- Fire due timers → emit `workspace.message.posted`
- Expire stale todos (1 hour) → status=cancelled
- Auto-archive threads (30 days inactive, not starred)
- Fire due routines → post context + trigger messages

### Migrations
```bash
cd workspace/backend
alembic revision -m "description"  # Create migration
alembic upgrade head               # Apply
```

---

## Frontend (workspace/frontend/)

### Stack
Next.js 16 (App Router), React 19, Tailwind CSS 4, Radix UI, Lucide icons

### State Management
`lib/workspace-context.tsx` — React Context providing all workspace state:
- `workspace`, `agents`, `sessions`, `files`, `browserTabs`, `todos`, `routines`
- CRUD functions: `createSession()`, `openBrowserTab()`, `uploadFile()`, etc.

### API Client
`lib/api.ts` — `WorkspaceApi` singleton class
- `configure(workspaceId, token)` sets auth
- Methods map 1:1 to backend endpoints
- Base URL: `NEXT_PUBLIC_API_URL` or `https://workspace-endpoint.openagents.org`

### Polling
`hooks/use-polling.ts` — Adaptive message polling:
- 2s when user active, 15s when idle (60s threshold)
- Cursor-based (tracks `newestIdRef` for forward poll, `oldestIdRef` for history)
- `generation` counter triggers scroll-to-bottom on bulk message loads

### Component Structure
```
components/
  layout/         — Sidebar, toolbar, wrapper (5-panel layout)
  chat/           — ChatView, ChatMessages, ChatInput, MarkdownContent
  agents/         — AgentAvatar, AgentProfilePanel, AgentStatusCard
  browser/        — BrowserView (iframe + screenshot polling)
  monitor/        — MonitorGrid, MonitorTile, MonitorOverlay
  threads/        — ThreadList, NewThreadDialog
  files/          — FileGrid, FileList, FilePreview
  routines/       — RoutinesView
  tasks/          — TasksView
  settings/       — SettingsDialog
```

### Adding a New Feature (Frontend)
1. Add types to `lib/types.ts`
2. Add API methods to `lib/api.ts`
3. Add state + CRUD to `lib/workspace-context.tsx`
4. Create component in `components/`
5. Wire into layout (sidebar tab or main panel)

### Key Patterns
- **Snake→camel mapping**: Backend returns `snake_case`, frontend maps to `camelCase` in api.ts
- **Optimistic updates**: Update local state immediately, then sync via API
- **Auto-scroll**: `userScrolledUpRef` prevents yanking user back to bottom during streaming
- **Thread switching**: Message cache (`messageCache` Map) for instant thread switches

---

## Agent Connector (packages/agent-connector/)

### Architecture
- CLI: `agn` command (search, install, create, up/down, status, logs)
- Daemon: Background process managing agent subprocesses
- Adapters: One per agent type (Claude, OpenClaw, Codex, etc.), all extend `BaseAdapter`
- MCP Server: JSON-RPC 2.0 over stdio, exposes workspace tools to agents

### Polling Loop (adapters/base.js)
```
Active (messages incoming):  2s
Warm (≤5 min since last):   5s
Cooldown (5-7 min):         5s → 15s ramp
Cold (>7 min):              15s
```

### Claude Adapter (adapters/claude.js)
- Spawns `claude -p "{prompt}" --output-format stream-json --verbose`
- Parses streaming JSON: `assistant` (text/tool_use), `result`, `system`, `rate_limit_event`
- Text blocks → `sendThinking()` (intermediate steps)
- Tool use blocks → `sendStatus()` (tool call previews)
- On exit → `sendResponse()` (final chat message)
- Session resume via `--resume {sessionId}` for conversation continuity

### MCP Tools (mcp-server.js)
Agents call workspace tools via MCP protocol:
- `workspace_get_history`, `workspace_get_agents`, `workspace_status`
- `workspace_list_files`, `workspace_read_file`, `workspace_write_file`
- `workspace_browser_open/navigate/click/type/screenshot/snapshot/close`
- `workspace_put_todos`, `workspace_get_todos`
- `workspace_create_timer/routine`, `workspace_list_timers/routines`

### System Prompt (adapters/workspace-prompt.js)
Generated per-agent, includes:
- Workspace context (agents, channels, role)
- Available curl commands for all API endpoints
- Tool documentation
- Multi-agent collaboration instructions

### Adding a New MCP Tool
1. Add tool schema to `TOOL_DEFINITIONS` array in `mcp-server.js`
2. Add `case 'tool_name':` handler in the tool dispatch switch
3. Add API method to `workspace-client.js`
4. Update system prompt in `workspace-prompt.js`

---

## Deployment

| Component | Platform | Auto-deploy |
|-----------|----------|-------------|
| Backend | Railway | On push to `develop` |
| Frontend | Vercel | On push to `develop` |
| Agent Connector | npm | Manual `npm publish` |
| BrowserFabric | Hetzner VPS | Manual `docker compose up -d` |

### Environment Variables (Backend - Railway)
```
DATABASE_URL          — PostgreSQL connection string
AUTH_MODE             — "workspace_token" or "firebase"
BROWSERFABRIC_API_KEY — Global BF key (fallback)
BROWSERFABRIC_PROVISION_SECRET — Shared secret for per-workspace key provisioning
CORS_ORIGINS          — Allowed origins
```

---

## Testing

### Backend Tests
```bash
cd workspace/backend && pytest tests/
```
Uses SQLite in-memory, async fixtures

### Agent Connector Tests
```bash
cd packages/agent-connector && npm test
```
Node.js built-in test runner

### Remote Test Machine
`ssh agentuser@172.232.187.238` — Linode with Claude Code + agent connector installed
- Agent `tester` connected to workspace `2550c9ab`
- Benchmark script at `/tmp/bench.py`

---

## Naming Conventions

- **Sources**: `openagents:{name}`, `human:{name}`, `system:{component}`
- **Targets**: `channel/{name}`, `agent/{name}`, `core`
- **Channels**: `session-{uuid}`, `routine:{routine_id}`, `dm:{agentA},{agentB}`
- **Event types**: `{domain}.{entity}.{action}` (e.g., `workspace.message.posted`)
