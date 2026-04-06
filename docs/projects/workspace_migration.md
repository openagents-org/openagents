# Workspace Migration: Open Source & ONM Alignment

**Status:** Design
**Created:** 2026-03-03
**Parent:** [agent_workspace.md](agent_workspace.md), [openagents_network_model.md](../openagents_network_model.md)

---

## 1. Goal

Move the OpenAgents Workspace (frontend + backend) from the private `openagents-web` monorepo into the open-source `openagents` SDK repo. Simultaneously, redesign the backend to align with the OpenAgents Network Model (ONM) — replacing the CRUD REST API with an event-native architecture.

After migration:
- `openagents` repo contains everything: SDK, workspace backend, workspace frontend
- `workspace.openagents.org` is deployed from the `openagents` repo
- The workspace backend speaks the ONM event protocol
- Anyone can `docker compose up` to run their own workspace

---

## 2. Repository Structure

```
openagents/                              # SDK repo root
│
├── sdk/sdk/src/openagents/                      # Python SDK package (pip install openagents)
│   ├── core/
│   │   ├── events.py                    # 🆕 ONM Event envelope model
│   │   ├── addressing.py                # 🆕 ONM address parsing & validation
│   │   ├── pipeline.py                  # 🆕 ONM mod pipeline runner
│   │   ├── mods.py                      # 🆕 Mod base classes (Guard, Transform, Observe)
│   │   ├── network.py                   # Existing network runtime
│   │   ├── workspace.py                 # Existing SDK workspace client
│   │   ├── workspace_manager.py         # Existing SDK workspace manager
│   │   ├── agent_identity.py            # Existing identity
│   │   └── ...
│   ├── workspace/                       # Existing workspace SDK module
│   ├── models/                          # Existing data models
│   └── ...
│
├── workspace/                           # 🆕 Self-contained workspace product
│   │
│   ├── backend/
│   │   ├── app/
│   │   │   ├── __init__.py
│   │   │   ├── main.py                  # FastAPI entry point
│   │   │   ├── config.py               # Environment-based config (DATABASE_URL, etc.)
│   │   │   ├── database.py             # SQLAlchemy engine + session (generic PostgreSQL)
│   │   │   ├── models.py               # Workspace-specific ORM models
│   │   │   ├── response.py             # Response helpers (success_response, etc.)
│   │   │   ├── pagination.py           # Pagination utilities
│   │   │   │
│   │   │   ├── mods/                   # Workspace-specific ONM mods
│   │   │   │   ├── __init__.py
│   │   │   │   ├── auth.py             # mod/auth — verify workspace token
│   │   │   │   ├── workspace.py        # mod/workspace — session routing, presence, delegation
│   │   │   │   └── persistence.py      # mod/persistence — save events to PostgreSQL
│   │   │   │
│   │   │   └── routers/
│   │   │       ├── __init__.py
│   │   │       ├── events.py           # POST /v1/events, GET /v1/events (ONM core)
│   │   │       ├── network.py          # /v1/join, /v1/leave, /v1/discover, /v1/profile
│   │   │       ├── workspaces.py       # Workspace CRUD (create, list, get, delete)
│   │   │       ├── skill.py            # SKILL.md generation
│   │   │       └── compat.py           # Legacy CRUD convenience endpoints (optional)
│   │   │
│   │   ├── tests/
│   │   │   ├── conftest.py
│   │   │   ├── test_events.py
│   │   │   ├── test_pipeline.py
│   │   │   ├── test_mods.py
│   │   │   ├── test_workspaces.py
│   │   │   ├── test_network.py
│   │   │   └── test_compat.py
│   │   │
│   │   ├── alembic/
│   │   │   ├── env.py
│   │   │   └── versions/
│   │   │       └── 001_initial.py      # Initial schema (events table, workspaces, etc.)
│   │   │
│   │   ├── alembic.ini
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   │
│   ├── frontend/
│   │   ├── app/                        # Next.js app router
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx                # Landing / create workspace
│   │   │   ├── not-found.tsx
│   │   │   └── [workspaceId]/
│   │   │       └── page.tsx            # Main workspace view
│   │   │
│   │   ├── components/
│   │   │   ├── layout/                 # Sidebar, toolbar, 3-pane layout
│   │   │   ├── files/                  # File browser components
│   │   │   └── ui/                     # Shadcn/Radix primitives
│   │   │
│   │   ├── lib/
│   │   │   ├── api.ts                  # Event-based API client
│   │   │   ├── types.ts               # TypeScript types (Event, Channel, etc.)
│   │   │   ├── auth.ts                # Auth utilities
│   │   │   ├── auth-context.tsx       # React auth context
│   │   │   ├── workspace-context.tsx  # Workspace state management
│   │   │   └── helpers.ts
│   │   │
│   │   ├── hooks/
│   │   ├── styles/
│   │   ├── public/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── next.config.ts
│   │   ├── tailwind.config.ts
│   │   └── Dockerfile
│   │
│   ├── docker-compose.yml              # One-command local dev
│   ├── Makefile                        # dev, test, build, migrate
│   └── README.md
│
├── docs/
│   ├── openagents_network_model.md
│   └── projects/
│       ├── agent_workspace.md
│       └── workspace_migration.md      # This file
│
├── pyproject.toml                      # SDK package config (unchanged)
└── ...
```

### What Lives Where

| Component | Location | Installable? |
|-----------|----------|--------------|
| ONM primitives (Event, Pipeline, Mod, Addressing) | `sdk/sdk/src/openagents/core/` | Yes — part of `pip install openagents` |
| Workspace backend (FastAPI) | `workspace/backend/` | No — deployed as a service |
| Workspace frontend (Next.js) | `workspace/frontend/` | No — deployed as a service |
| Workspace mods (auth, persistence, etc.) | `workspace/backend/app/mods/` | No — workspace-specific |
| SDK workspace client | `sdk/sdk/src/openagents/core/workspace.py` | Yes — used by `openagents connect` |

The SDK is a **library** (`pip install`). The workspace is a **product** (`docker compose up`).
The workspace backend imports the SDK for shared ONM primitives.

---

## 3. ONM Primitives in the SDK

These live in `sdk/sdk/src/openagents/core/` and are shared by both the SDK runtime and the workspace product.

### 3.1 Event Envelope — `core/events.py`

```python
from pydantic import BaseModel, Field
from typing import Any, Optional
from datetime import datetime
import ulid

class Event(BaseModel):
    """The universal unit of communication in the OpenAgents Network Model."""
    id: str = Field(default_factory=lambda: str(ulid.new()))
    type: str                           # e.g., "workspace.message.posted"
    source: str                         # e.g., "openagents:claude-agent"
    target: str                         # e.g., "channel/session-abc", NEVER null
    payload: Any = None                 # Schema depends on type
    metadata: dict = Field(default_factory=dict)  # in_reply_to, etc.
    timestamp: int = Field(default_factory=lambda: int(datetime.utcnow().timestamp() * 1000))
    network: str = ""                   # Network ID where event originated
    visibility: str = "channel"         # public | channel | direct | mod_only


# Core event types
class EventTypes:
    # Agent lifecycle
    AGENT_JOIN = "network.agent.join"
    AGENT_LEAVE = "network.agent.leave"
    AGENT_DISCOVER = "network.agent.discover"
    AGENT_DISCOVER_RESPONSE = "network.agent.discover.response"
    AGENT_ANNOUNCE = "network.agent.announce"

    # Channel lifecycle
    CHANNEL_CREATE = "network.channel.create"
    CHANNEL_DELETE = "network.channel.delete"
    CHANNEL_JOIN = "network.channel.join"
    CHANNEL_LEAVE = "network.channel.leave"

    # System
    PING = "network.ping"
    PONG = "network.pong"
    EVENT_ACK = "network.event.ack"
    EVENT_ERROR = "network.event.error"
    EVENTS_QUERY = "network.events.query"
    EVENTS_RESPONSE = "network.events.response"

    # Resource operations
    RESOURCE_REGISTER = "network.resource.register"
    RESOURCE_INVOKE = "network.resource.invoke"
    RESOURCE_INVOKE_RESULT = "network.resource.invoke.result"
    RESOURCE_DISCOVER = "network.resource.discover"


# Workspace extension event types
class WorkspaceEventTypes:
    MESSAGE_POSTED = "workspace.message.posted"
    MESSAGE_STATUS = "workspace.message.status"
    SESSION_CREATED = "workspace.session.created"
    SESSION_UPDATED = "workspace.session.updated"
    INVITATION_CREATED = "workspace.invitation.created"
    INVITATION_ACCEPTED = "workspace.invitation.accepted"
    INVITATION_REJECTED = "workspace.invitation.rejected"
```

### 3.2 Addressing — `core/addressing.py`

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class Address:
    network: str            # "local" if within current network
    entity_type: str        # "agent", "openagents", "human", "channel", "mod", "group", "resource", "core"
    name: str               # The entity name/path
    raw: str                # Original string

    @property
    def is_local(self) -> bool:
        return self.network == "local"

    @property
    def is_broadcast(self) -> bool:
        return self.raw == "agent:broadcast"

    @property
    def is_core(self) -> bool:
        return self.entity_type == "core"

    @property
    def is_channel(self) -> bool:
        return self.entity_type == "channel"

    def __str__(self) -> str:
        if self.is_local:
            return f"{self.entity_type}:{self.name}" if self.entity_type in ("agent", "openagents", "human") else self.raw
        return f"{self.network}::{self.entity_type}:{self.name}"


def parse_address(raw: str) -> Address:
    """Parse an ONM address string into an Address object.

    Examples:
        "agent:charlie"          → Address(network="local", entity_type="agent", name="charlie")
        "openagents:claude-7f3a" → Address(network="local", entity_type="openagents", name="claude-7f3a")
        "human:user@example.com" → Address(network="local", entity_type="human", name="user@example.com")
        "channel/session-abc"    → Address(network="local", entity_type="channel", name="session-abc")
        "mod/persistence"        → Address(network="local", entity_type="mod", name="persistence")
        "core"                   → Address(network="local", entity_type="core", name="")
        "agent:broadcast"        → Address(network="local", entity_type="agent", name="broadcast")
        "net123::agent:charlie"  → Address(network="net123", entity_type="agent", name="charlie")
        "charlie"                → Address(network="local", entity_type="agent", name="charlie")
    """
    # Step 1: network scoping
    if "::" in raw:
        network, entity = raw.split("::", 1)
    else:
        network, entity = "local", raw

    # Step 2: entity type
    if entity == "core":
        return Address(network=network, entity_type="core", name="", raw=raw)

    for prefix in ("channel/", "mod/", "group/", "resource/"):
        if entity.startswith(prefix):
            entity_type = prefix.rstrip("/")
            name = entity[len(prefix):]
            return Address(network=network, entity_type=entity_type, name=name, raw=raw)

    for prefix in ("agent:", "openagents:", "human:"):
        if entity.startswith(prefix):
            entity_type = prefix.rstrip(":")
            name = entity[len(prefix):]
            return Address(network=network, entity_type=entity_type, name=name, raw=raw)

    # Bare string → defaults to agent:{string}
    return Address(network=network, entity_type="agent", name=entity, raw=raw)
```

### 3.3 Pipeline — `core/pipeline.py`

```python
from abc import ABC, abstractmethod
from typing import List, Optional
from openagents.core.events import Event
import fnmatch
import logging

logger = logging.getLogger(__name__)


class Mod(ABC):
    """Base class for all mods in the event pipeline."""
    name: str
    intercepts: List[str]       # Event type patterns (e.g., "workspace.message.*")
    priority: int               # Lower = earlier in pipeline
    mode: str                   # "guard" | "transform" | "observe"

    def matches(self, event_type: str) -> bool:
        return any(fnmatch.fnmatch(event_type, pattern) for pattern in self.intercepts)

    @abstractmethod
    async def process(self, event: Event, context: "PipelineContext") -> Optional[Event]:
        """Process an event. Return None from a guard to reject. Return modified event from transform."""
        ...


class GuardMod(Mod):
    mode = "guard"

class TransformMod(Mod):
    mode = "transform"

class ObserveMod(Mod):
    mode = "observe"


class PipelineContext:
    """Context passed through the pipeline, accumulating side-effect events."""
    def __init__(self, network_id: str, agent_address: str):
        self.network_id = network_id
        self.agent_address = agent_address
        self.side_effects: List[Event] = []

    def emit(self, event: Event):
        """Emit a side-effect event (e.g., mod/presence emitting agent.leave)."""
        self.side_effects.append(event)


class EventRejected(Exception):
    """Raised when a guard mod rejects an event."""
    def __init__(self, mod_name: str, reason: str):
        self.mod_name = mod_name
        self.reason = reason
        super().__init__(f"Event rejected by {mod_name}: {reason}")


class Pipeline:
    """Ordered event pipeline. Events flow through guard → transform → observe mods."""

    def __init__(self, mods: Optional[List[Mod]] = None):
        self.mods = sorted(mods or [], key=lambda m: m.priority)

    def add_mod(self, mod: Mod):
        self.mods.append(mod)
        self.mods.sort(key=lambda m: m.priority)

    async def process(self, event: Event, context: PipelineContext) -> Event:
        for mod in self.mods:
            if not mod.matches(event.type):
                continue

            if mod.mode == "guard":
                result = await mod.process(event, context)
                if result is None:
                    raise EventRejected(mod.name, "rejected by guard")
                event = result

            elif mod.mode == "transform":
                result = await mod.process(event, context)
                if result is not None:
                    event = result

            elif mod.mode == "observe":
                await mod.process(event, context)
                # Observers cannot modify or reject

        return event
```

---

## 4. Database Schema

The workspace backend uses two categories of tables:

### 4.1 Core Event Store

```sql
-- The universal event log. Every interaction is an event.
CREATE TABLE events (
    id              TEXT PRIMARY KEY,            -- ULID (sortable, unique)
    network_id      UUID NOT NULL,               -- workspace ID
    type            TEXT NOT NULL,                -- "workspace.message.posted"
    source          TEXT NOT NULL,                -- "openagents:claude-agent"
    target          TEXT NOT NULL,                -- "channel/session-abc"
    payload         JSONB,                        -- event-type-specific data
    metadata        JSONB DEFAULT '{}',           -- in_reply_to, etc.
    timestamp       BIGINT NOT NULL,             -- unix ms
    visibility      TEXT DEFAULT 'channel',       -- public|channel|direct|mod_only
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_network_type ON events (network_id, type);
CREATE INDEX idx_events_network_target ON events (network_id, target);
CREATE INDEX idx_events_network_timestamp ON events (network_id, timestamp);
```

### 4.2 Workspace State Tables (Materialized from Events)

These tables are projections that `mod/workspace` and `mod/persistence` maintain as they process events. They enable efficient queries (e.g., "list all channels in this workspace") without scanning the event log.

```sql
-- Workspace = Network
CREATE TABLE workspaces (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT UNIQUE,                  -- short URL slug
    name            TEXT NOT NULL,
    creator_email   TEXT,                          -- NULL for anonymous
    password_hash   TEXT,                          -- anonymous access control
    settings        JSONB DEFAULT '{}',
    status          TEXT DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

-- Membership = agent in network
CREATE TABLE workspace_members (
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    agent_name      TEXT NOT NULL,
    role            TEXT DEFAULT 'member',         -- master | member | observer
    status          TEXT DEFAULT 'offline',        -- online | offline
    last_heartbeat  TIMESTAMPTZ,
    joined_at       TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, agent_name)
);

-- Channel = session/thread
CREATE TABLE channels (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                  -- "session-{uuid}" or custom
    title           TEXT,                           -- human-readable title
    created_by      TEXT,
    master_agent    TEXT,                           -- per-channel master
    status          TEXT DEFAULT 'active',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Channel membership (per-thread participants)
CREATE TABLE channel_members (
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    agent_name      TEXT NOT NULL,
    PRIMARY KEY (channel_id, agent_name)
);

-- Invitations
CREATE TABLE invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    target_agent    TEXT NOT NULL,
    invite_token    TEXT NOT NULL UNIQUE,
    status          TEXT DEFAULT 'pending',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);
```

### 4.3 Agent Identity

The workspace needs to know about agents but doesn't own the identity table. Two options:

**Option A: Shared database** (used for `workspace.openagents.org`)
- Workspace connects to the same PostgreSQL that has the `agent_ids` table
- `workspace_members.agent_name` references `agent_ids.agent_name`

**Option B: Standalone** (used for self-hosted)
- Workspace manages its own agent table:
```sql
CREATE TABLE agents (
    agent_name      TEXT PRIMARY KEY,
    display_name    TEXT,
    agent_type      TEXT,                -- "claude", "codex", "gemini", etc.
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```
- No global identity registry — agents are local to this workspace deployment

The config determines which mode: `IDENTITY_MODE=shared|standalone`.

---

## 5. Event Flow Examples

### 5.1 Human Sends a Chat Message

```
Frontend: POST /v1/events
{
    "type": "workspace.message.posted",
    "source": "human:user@example.com",
    "target": "channel/session-abc",
    "payload": {
        "content": "Fix the login bug",
        "message_type": "chat"
    }
}

Pipeline:
  mod/auth (guard)       → verify workspace token, resolve source address
  mod/workspace (transform) → determine routing:
                              channel master is "openagents:claude-agent"
                              add metadata.target_agents = ["openagents:claude-agent"]
  mod/persistence (observe) → INSERT INTO events (...)

Response: { "id": "01HXY...", "type": "workspace.message.posted", ... }
```

### 5.2 Agent Polls for Events

```
Agent: GET /v1/events?after=01HXY...&target=openagents:claude-agent

Pipeline:
  mod/auth (guard)      → verify agent token
  mod/persistence       → SELECT FROM events WHERE target IN
                          ('openagents:claude-agent', 'channel/session-abc', 'agent:broadcast')
                          AND timestamp > ...

Response: { "events": [...], "has_more": false }
```

### 5.3 Agent Joins Network

```
Agent: POST /v1/join
{ "agent_name": "claude-agent", "token": "ws_abc123..." }

Internally emits:
  Event {
    type: "network.agent.join",
    source: "openagents:claude-agent",
    target: "core",
    payload: { agent_name: "claude-agent" }
  }

Pipeline:
  mod/auth (guard)       → verify workspace token
  mod/workspace (transform) → add agent to workspace_members, set status=online
  mod/persistence (observe) → store event
```

### 5.4 Create a New Channel (Session)

```
Frontend: POST /v1/events
{
    "type": "network.channel.create",
    "source": "human:user@example.com",
    "target": "core",
    "payload": {
        "name": "session-{uuid}",
        "title": "Fix login bug",
        "participants": ["openagents:claude-agent", "openagents:codex-a2b1"],
        "master": "openagents:claude-agent"
    }
}

Pipeline:
  mod/auth (guard)       → verify user has permission to create channels
  mod/workspace (transform) → INSERT INTO channels, INSERT INTO channel_members
  mod/persistence (observe) → store event

Response: Event with channel details in payload
```

---

## 6. API Surface

### 6.1 ONM Core Endpoints

```
POST /v1/join                    Join the network (agent lifecycle)
POST /v1/leave                   Leave the network
POST /v1/events                  Send any event
GET  /v1/events                  Poll events (filter by after, target, channel, type)
POST /v1/heartbeat               Agent presence heartbeat
GET  /v1/discover                Discover agents, channels, resources
GET  /v1/profile                 Network profile (metadata, transports, capabilities)
```

### 6.2 Workspace Management Endpoints

These are NOT part of the ONM spec — they're workspace-product CRUD for managing the workspace itself:

```
POST /v1/workspaces              Create a new workspace (→ creates network)
GET  /v1/workspaces              List user's workspaces
GET  /v1/workspaces/{id}         Get workspace details
PATCH /v1/workspaces/{id}        Update workspace settings
DELETE /v1/workspaces/{id}       Delete workspace

GET  /v1/workspaces/{id}/skill.md   Get SKILL.md for this workspace
```

### 6.3 Convenience Endpoints (Optional Compat Layer)

Thin translations from REST to events, for gradual migration:

```
POST /v1/ws/{id}/sessions                → emits network.channel.create
POST /v1/ws/{id}/sessions/{sid}/messages → emits workspace.message.posted
GET  /v1/ws/{id}/sessions/{sid}/messages → queries events by channel
GET  /v1/ws/{id}/agents                  → queries workspace_members
POST /v1/ws/{id}/heartbeat              → emits network.ping
```

These call the pipeline internally — they're syntactic sugar, not a separate code path.

---

## 7. Decoupling from openagents-web

### 7.1 What Moves to workspace/

| From openagents-web | To workspace/ | Changes |
|---------------------|---------------|---------|
| `backend/app/routers/agent_workspaces.py` | `workspace/backend/app/routers/` (split) | Rewrite as event-native |
| `backend/app/models.py` (workspace models only) | `workspace/backend/app/models.py` | New schema (events table, channels, etc.) |
| `backend/app/pagination.py` | `workspace/backend/app/pagination.py` | Copy as-is |
| `backend/app/response.py` | `workspace/backend/app/response.py` | Copy as-is |
| `backend/tests/test_agent_workspaces.py` | `workspace/backend/tests/` | Rewrite for event API |
| `workspace_frontend/` (entire directory) | `workspace/frontend/` | Update API calls to event-based |

### 7.2 What Stays in openagents-web

| Component | Reason |
|-----------|--------|
| `backend/app/routers/agent_ids.py` | Global agent registry — shared by all products |
| `backend/app/routers/agent_auth.py` | Agent auth service — shared |
| `backend/app/routers/agent_profiles.py` | Agent profiles — shared |
| `backend/app/routers/agent_register.py` | Agent registration — shared |
| `backend/app/routers/reputation.py` | Reputation — shared |
| `backend/app/routers/workspace.py` | User dashboard (list workspaces) — could proxy to workspace backend |
| `frontend/` | Main site (openagents.org) |
| `agentid_frontend/` | Agent ID management |
| All other frontends/backends | Product-specific |

### 7.3 Auth Decoupling

Current: Firebase JWT via `verify_firebase_token()`.

New: Pluggable auth with workspace token as the primary method.

```python
# workspace/backend/app/config.py
class Config:
    DATABASE_URL: str                        # Required
    AUTH_MODE: str = "workspace_token"       # workspace_token | jwt | firebase
    JWT_SECRET: str = ""                     # For JWT mode
    FIREBASE_PROJECT_ID: str = ""            # For Firebase mode
    IDENTITY_MODE: str = "standalone"        # standalone | shared
    SHARED_DB_URL: str = ""                  # For shared identity mode
```

For `workspace.openagents.org`: `AUTH_MODE=firebase`, `IDENTITY_MODE=shared`.
For self-hosted: `AUTH_MODE=workspace_token`, `IDENTITY_MODE=standalone`.

---

## 8. Frontend Changes

### 8.1 API Client Migration

The frontend API client shifts from endpoint-per-action to event-based:

```typescript
// workspace/frontend/lib/types.ts

export interface Event {
  id: string;
  type: string;
  source: string;
  target: string;
  payload: any;
  metadata: Record<string, unknown>;
  timestamp: number;
  network: string;
  visibility: string;
}

// Workspace-specific payload types
export interface MessagePayload {
  content: string;
  messageType: 'chat' | 'status' | 'delegation';
  mentions?: string[];
}

export interface ChannelPayload {
  name: string;
  title?: string;
  participants?: string[];
  master?: string;
}
```

```typescript
// workspace/frontend/lib/api.ts

class WorkspaceApi {
  // Core event methods
  async sendEvent(event: Partial<Event>): Promise<Event> { ... }
  async pollEvents(after?: string, target?: string, channel?: string): Promise<Event[]> { ... }

  // Convenience wrappers
  async sendMessage(channelId: string, content: string, mentions?: string[]) {
    return this.sendEvent({
      type: 'workspace.message.posted',
      target: `channel/${channelId}`,
      payload: { content, messageType: 'chat', mentions },
    });
  }

  async createChannel(title: string, participants?: string[], master?: string) {
    return this.sendEvent({
      type: 'network.channel.create',
      target: 'core',
      payload: { title, participants, master },
    });
  }

  // Network endpoints
  async join(agentName: string, token: string): Promise<void> { ... }
  async discover(): Promise<DiscoverResponse> { ... }
  async heartbeat(): Promise<void> { ... }

  // Workspace management (not event-based)
  async createWorkspace(name: string, agentName: string): Promise<Workspace> { ... }
  async getWorkspace(id: string): Promise<Workspace> { ... }
}
```

### 8.2 UI Components

Mostly unchanged — the 3-pane layout, sidebar, thread list, chat view all stay.
Changes are mainly in how data flows:
- `WorkspaceSession` → `Channel` (rename)
- `WorkspaceMessage` → `Event` with `workspace.message.posted` type
- Message polling → Event polling (same HTTP pattern, different response shape)

---

## 9. Docker Compose

```yaml
# workspace/docker-compose.yml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: openagents_workspace
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://postgres:dev@db:5432/openagents_workspace
      AUTH_MODE: workspace_token
      IDENTITY_MODE: standalone
    ports:
      - "8000:8000"
    depends_on:
      db:
        condition: service_healthy

  frontend:
    build: ./frontend
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8000
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

---

## 10. Deployment: workspace.openagents.org

For the hosted product:

```yaml
# Production config (not in repo — deployment pipeline)
environment:
  DATABASE_URL: postgresql://...supabase...
  AUTH_MODE: firebase
  IDENTITY_MODE: shared
  SHARED_DB_URL: postgresql://...same-supabase...
  FIREBASE_PROJECT_ID: openagents-prod
```

**Deployment pipeline options:**
1. **Same server, new process** — workspace backend runs alongside openagents-web backend
2. **Separate service** — workspace backend is its own deployment, shares the database
3. **Monorepo import** — openagents-web imports workspace backend as a package/submodule

Option 2 (separate service) is cleanest. The workspace backend is a standalone FastAPI app.
Nginx routes `workspace.openagents.org` to the workspace frontend,
and the workspace frontend calls the workspace backend API.

For the transition period, both the old (openagents-web) and new (workspace/) backends can run
side by side, with nginx routing by path prefix.

---

## 11. Migration Plan

### Phase A: Scaffold & Copy (Non-Breaking) ✅

Create the `workspace/` directory structure. Copy the frontend as-is. Create a minimal backend
that replicates the current CRUD API (working product, same behavior, different codebase).
Add Alembic, configurable DB, remove Firebase dependency. Docker Compose for local dev.

**Result:** `workspace/` is a working, self-contained clone of the current workspace.

### Phase B: ONM Primitives in SDK ✅

Add `Event`, `Pipeline`, `Mod`, `Address` to `sdk/sdk/src/openagents/core/`.
Unit tests for all primitives. No changes to workspace yet.

**Result:** SDK ships ONM primitives. `pip install openagents` includes them.

### Phase C: Event-Native Backend ✅

Replace CRUD router with event-native endpoints (`POST /v1/events`, `GET /v1/events`).
Implement workspace mods (auth, workspace, persistence). Add `events` table.
Keep compat layer for the frontend during transition.

**Result:** Backend speaks ONM. Old endpoints still work via compat layer.

### Phase D: Frontend Migration ✅

Update frontend API client to use events. Replace session/message types with channel/event types.
Remove compat layer once frontend is fully migrated.

**Result:** Full stack is event-native.

**Completed changes:**
- `types.ts`: Added `eventToMessage()`, `networkAgentToWorkspaceAgent()`, `networkChannelToSession()` converters. Updated `Workspace` type (added `slug`, removed `sessions` array).
- `api.ts`: Replaced CRUD endpoints with event-native methods. `sendMessage()` → `POST /v1/events` (`workspace.message.posted`). `pollMessages()` → `GET /v1/events` (channel filter + converter). `createChannel()` → `network.channel.create` event. `getWorkspace()` → `/v1/workspaces/{id}`. Agent/invitation methods → stubs pending migration.
- `workspace-context.tsx`: Initial load uses `getWorkspace()` + `discover()`. Single 15s discovery poll replaces separate agent (15s) and session (30s) polls. `createSession()` emits channel creation event.
- `use-polling.ts`: No changes needed — API client conversion layer preserves `WorkspaceMessage[]` interface.
- Chat components: No changes needed — all use `WorkspaceMessage`/`WorkspaceSession` types which are populated by converters.

### Phase E: Deploy & Sunset ✅

SDK migration to event-native endpoints + production deployment infrastructure.

**SDK changes:**
- `WorkspaceClient` rewritten: all methods use `/v1/events`, `/v1/heartbeat`, `/v1/leave`, `/v1/discover`, `/v1/workspaces`
- `WorkspaceInfo.session_id` → `channel_name`
- Auth header: `Authorization: Bearer` → `X-Workspace-Token`
- `poll_pending()` uses event ID cursor + client-side `target_agents` filter
- `_event_to_message()` converts ONM events to message-compatible dicts
- Adapters (Claude, OpenClaw, Codex): `session_id` → `channel_name`, event ID cursor
- MCP server: `--session-id` → `--channel-name`
- CLI: updated to pass `channel_name` everywhere

**Deployment:**
- `entrypoint.sh`: runs `alembic upgrade head` before starting uvicorn
- Frontend port: `start` script uses port 3000 (matches Dockerfile EXPOSE)
- `docker-compose.prod.yml`: production compose (no volume mounts, no reload)
- `nginx.conf`: reverse proxy (`/v1/` → backend, `/` → frontend)

**Result:** One codebase, one deployment.

---

## 12. Open Questions

### Q1: SDK Workspace Client Update

The SDK's `openagents connect` command currently talks to CRUD endpoints. When do we update it
to speak events? Phase C (alongside backend) or Phase D (alongside frontend)?

→ Probably Phase C — the SDK should be the first consumer of the event API.

### Q2: Data Migration

Existing workspaces on `workspace.openagents.org` have data in the old schema
(`workspace_messages`, `workspace_sessions`). Migration strategy:
- **Option A:** Write a migration script that converts old rows to events
- **Option B:** Keep old data accessible via read-only compat queries, new data goes to events
- **Option C:** Clean break — existing workspaces continue on old backend during transition

### Q3: Workspace CRUD vs. Events

Workspace creation (`POST /v1/workspaces`) is inherently a CRUD operation — you're creating
a network, not sending an event within one. Same for listing workspaces, updating settings.
These should remain REST endpoints, not event-based. The event API is for within-network communication.

### Q4: Agent Identity Foreign Key

In standalone mode, `workspace_members.agent_name` has no FK to a shared `agent_ids` table.
Should we validate agent names during join, or just accept any string?

→ Accept any string. The workspace is the authority for its own membership.
