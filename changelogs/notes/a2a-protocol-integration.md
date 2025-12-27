# A2A Protocol Integration

**Date:** 2025-12-27
**Branch:** `claude/a2a-protocol-python-qoMKa`
**Commit:** `8a64009`

## Overview

Implementation of the Agent2Agent (A2A) protocol for OpenAgents, enabling interoperability with external A2A-compatible agents built on different frameworks (LangGraph, CrewAI, Pydantic AI, etc.).

## What is A2A?

The Agent2Agent (A2A) Protocol is an open standard originally developed by Google and now managed by the Linux Foundation. It enables seamless communication and collaboration between AI agents regardless of their underlying framework.

- **Protocol:** JSON-RPC 2.0 over HTTP(S)
- **Discovery:** Agent Cards at `/.well-known/agent.json`
- **Specification:** https://a2a-protocol.org/latest/specification/

### A2A vs MCP

| Protocol | Purpose |
|----------|---------|
| **MCP** | Agent-to-Tool communication |
| **A2A** | Agent-to-Agent communication |

Both are complementary standards for building robust agentic applications.

---

## Architecture Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Dependencies | Hybrid (built-in + optional SDK) | Minimal deps, extensible |
| 2 | Architecture | Transport pattern | Consistent with MCP |
| 3 | Agent Card | Config + introspection | Flexible, maintainable |
| 4 | Task Store | Pluggable (in-memory default) | Simple start, extensible |
| 5 | Event Mapping | Task-centric | Preserves A2A semantics |
| 6 | Streaming | Polling only (MVP) | Incremental complexity |
| 7 | Authentication | Pluggable (bearer default) | Simple, extensible |
| 8 | Client Scope | Full client | Complete functionality |
| 9 | Skill Exposure | Network-level + dynamic | Skills from agents/mods |
| 10 | Errors | Mapped with details | Debug-friendly |

---

## Implementation

### New Files

| File | Lines | Description |
|------|-------|-------------|
| `src/openagents/models/a2a.py` | ~450 | A2A Pydantic models |
| `src/openagents/utils/a2a_converters.py` | ~280 | Event names and converters |
| `src/openagents/core/a2a_task_store.py` | ~280 | Task storage abstraction |
| `src/openagents/core/transports/a2a.py` | ~650 | A2A server transport |
| `src/openagents/core/connectors/a2a_connector.py` | ~500 | A2A client connector |

### Modified Files

| File | Change |
|------|--------|
| `models/transport.py` | Added `TransportType.A2A = "a2a"` |
| `core/transports/__init__.py` | Exported `A2ATransport`, `create_a2a_transport` |
| `core/connectors/__init__.py` | Exported `A2ANetworkConnector` |

---

## Event Names

All A2A-related events follow the pattern: `agent.task.{category}.{action}`

### Task Lifecycle Events
```
agent.task.created
agent.task.submitted
agent.task.working
agent.task.completed
agent.task.failed
agent.task.canceled
agent.task.rejected
agent.task.input_required
agent.task.auth_required
```

### Task Operation Events
```
agent.task.message.received
agent.task.message.sent
agent.task.get
agent.task.list
agent.task.cancel
agent.task.artifact.added
agent.task.artifact.updated
agent.task.status.updated
```

### Task Notification Events
```
agent.task.notification.sent
agent.task.notification.failed
agent.task.notification.config.set
agent.task.notification.config.deleted
agent.task.notification.subscribed
agent.task.notification.unsubscribed
```

### Task Context Events
```
agent.task.context.created
agent.task.context.continued
agent.task.context.closed
```

### Task Outbound Events
```
agent.task.outbound.created
agent.task.outbound.sent
agent.task.outbound.received
agent.task.outbound.completed
agent.task.outbound.failed
agent.task.outbound.agent_discovered
agent.task.outbound.agent_unavailable
```

### Transport Events
```
agent.task.transport.started
agent.task.transport.stopped
agent.task.transport.error
```

---

## Data Models

### Core Types

```python
# Task states
class TaskState(str, Enum):
    UNKNOWN = "unknown"
    SUBMITTED = "submitted"
    WORKING = "working"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"
    REJECTED = "rejected"
    INPUT_REQUIRED = "input-required"
    AUTH_REQUIRED = "auth-required"

# Message roles
class Role(str, Enum):
    USER = "user"
    AGENT = "agent"

# Part types
class PartType(str, Enum):
    TEXT = "text"
    FILE = "file"
    DATA = "data"
```

### Key Models

- **Task**: Unit of work with status, artifacts, history
- **A2AMessage**: Message with role and parts
- **Artifact**: Output produced by task
- **AgentCard**: Agent identity and capabilities
- **AgentSkill**: Individual agent capability

---

## Configuration

### Network YAML

```yaml
network:
  name: "my-network"

  transports:
    - type: "a2a"
      config:
        port: 8900
        host: "0.0.0.0"

        # Agent identity (skills collected dynamically)
        agent:
          name: "MyAgentNetwork"
          version: "1.0.0"
          description: "OpenAgents network via A2A"

        # Optional authentication
        auth:
          type: "bearer"
          token_env: "A2A_AUTH_TOKEN"
```

### Agent Registration with Skills

Agents declare skills when registering:

```python
connector = GRPCNetworkConnector(
    agent_id="travel-agent",
    metadata={
        "skills": [
            {
                "id": "book_flight",
                "name": "Book Flight",
                "description": "Book airline tickets",
                "input_modes": ["text"],
                "output_modes": ["text", "data"]
            }
        ]
    }
)
```

---

## API Endpoints

### A2A Transport (Server)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/.well-known/agent.json` | GET | Agent Card discovery |
| `/` | GET | Server info |
| `/` | POST | JSON-RPC methods |

### JSON-RPC Methods

| Method | Description |
|--------|-------------|
| `message/send` | Send message, create/continue task |
| `tasks/get` | Get task by ID |
| `tasks/list` | List tasks with filtering |
| `tasks/cancel` | Cancel a task |

---

## Usage Examples

### Server (Transport)

```python
from openagents.core.transports import A2ATransport

transport = A2ATransport(config={
    "port": 8900,
    "agent": {
        "name": "MyNetwork",
        "description": "A2A-enabled network"
    }
})

await transport.initialize()
# Server running at http://localhost:8900
# Agent card at http://localhost:8900/.well-known/agent.json
```

### Client (Connector)

```python
from openagents.core.connectors import A2ANetworkConnector

# Connect to remote A2A agent
connector = A2ANetworkConnector(
    a2a_server_url="https://remote-agent.example.com",
    agent_id="my-agent",
    auth_token="secret"
)

await connector.connect_to_server()
print(f"Connected to: {connector.agent_card.name}")
print(f"Skills: {[s.name for s in connector.agent_card.skills]}")

# Send message and wait for completion
task = await connector.send_and_wait("Hello!", timeout=30.0)
print(f"Status: {task.status.state}")
print(f"Artifacts: {task.artifacts}")

await connector.disconnect()
```

### Event Handling

```python
from openagents.utils.a2a_converters import (
    A2ATaskEventNames,
    a2a_message_to_event,
    event_to_a2a_message
)

# Convert A2A message to OpenAgents event
event = a2a_message_to_event(message, task_id, context_id)
# event.event_name == "agent.task.message.received"

# Convert back
message = event_to_a2a_message(event)
```

---

## Task Store

Abstract interface with in-memory default:

```python
from openagents.core.a2a_task_store import InMemoryTaskStore

store = InMemoryTaskStore(max_tasks=10000)

# Create task
task = await store.create_task(task)

# Update status
await store.update_task_state(task_id, TaskState.WORKING)

# Add artifact
await store.add_artifact(task_id, artifact)

# List tasks
tasks = await store.list_tasks(context_id="ctx_123")
```

Future implementations can add PostgreSQL, Redis, SQLite backends.

---

## Dynamic Skill Collection

Skills are collected at runtime from:

1. **Agent Metadata**: Skills declared in `metadata.skills` during registration
2. **Mod Tools**: Tools exposed by loaded mods

Skill ID format: `{source}.{skill_id}`
- `travel-agent.book_flight` - From agent
- `mod.workspace.create_file` - From mod

---

## Future Enhancements

- [ ] SSE streaming for real-time task updates
- [ ] Push notification webhook support
- [ ] Per-agent A2A endpoints
- [ ] Persistent task stores (PostgreSQL, Redis)
- [ ] gRPC binding support
- [ ] OAuth2 authentication flows
- [ ] Agent-to-agent bidirectional communication

---

## References

- [A2A Protocol Specification](https://a2a-protocol.org/latest/specification/)
- [A2A Python SDK](https://github.com/a2aproject/a2a-python)
- [Google A2A Announcement](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
