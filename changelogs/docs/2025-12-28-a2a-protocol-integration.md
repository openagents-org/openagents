# A2A Protocol Integration: Technical Documentation

## Overview

OpenAgents v0.8.0 introduces full support for the Agent2Agent (A2A) protocol, enabling interoperability with AI agents built on different frameworks. A2A is now served via HTTP transport at `/a2a`, alongside MCP (`/mcp`) and Studio (`/studio`).

## What Changed

### New Feature: A2A via HTTP Transport

A2A protocol can now be served from the HTTP transport on port 8700 (default), eliminating the need for a separate A2A transport on port 8900.

**Configuration:**
```yaml
transports:
  - type: "http"
    config:
      port: 8700
      serve_a2a: true      # Enable A2A at /a2a
      serve_mcp: true      # Enable MCP at /mcp
      serve_studio: true   # Enable Studio at /studio
```

### A2A Endpoints on HTTP Transport

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/a2a/.well-known/agent.json` | GET | Agent Card discovery |
| `/a2a` | GET | Server info |
| `/a2a` | POST | JSON-RPC 2.0 methods |
| `/a2a` | OPTIONS | CORS preflight |

### Unified Agent Registry

Both local agents (gRPC, WebSocket) and remote A2A agents are now managed in a single unified registry:

```python
# topology.agent_registry contains all agents
local_agents = topology.get_local_agents()   # gRPC, WebSocket, HTTP
remote_agents = topology.get_remote_agents() # A2A remote agents
```

### AgentConnection Model Extensions

The `AgentConnection` model now supports A2A-specific fields:

```python
class AgentConnection(BaseModel):
    agent_id: str
    transport_type: TransportType

    # A2A-specific fields (for remote agents)
    agent_card: Optional[AgentCard] = None
    remote_status: Optional[RemoteAgentStatus] = None
    announced_at: Optional[float] = None
    last_health_check: Optional[float] = None
    failure_count: int = 0

    def is_remote(self) -> bool:
        return self.transport_type == TransportType.A2A and self.address is not None

    def is_healthy(self) -> bool:
        return self.remote_status == RemoteAgentStatus.ACTIVE
```

### RemoteAgentStatus Enum

New status tracking for remote A2A agents:

```python
class RemoteAgentStatus(str, Enum):
    ACTIVE = "active"       # Healthy and reachable
    STALE = "stale"         # Failed health checks
    REFRESHING = "refreshing"  # Card refresh in progress
```

## Configuration

### HTTP Transport with A2A

```yaml
transports:
  - type: "http"
    config:
      port: 8700
      serve_a2a: true

      # Agent Card configuration
      a2a_agent:
        name: "My Network"
        version: "1.0.0"
        description: "OpenAgents A2A Server"
        url: "http://localhost:8700/a2a"  # Optional, auto-detected
        provider:
          organization: "My Company"
          url: "https://example.com"

      # Authentication (optional)
      a2a_auth:
        type: "bearer"
        token: "my-secret-token"      # Direct token
        # OR
        token_env: "A2A_AUTH_TOKEN"   # From environment
```

### Standalone A2A Transport

For dedicated A2A deployments (separate port):

```yaml
transports:
  - type: "a2a"
    config:
      port: 8900
      host: "0.0.0.0"
      agent:
        name: "Standalone A2A"
```

### Remote Agent Management

Configure health checking for remote A2A agents:

```yaml
network:
  remote_agents:
    card_refresh_interval: 300    # Refresh Agent Cards every 5 min
    health_check_interval: 60     # Health check every 1 min
    max_failures_before_stale: 3  # Mark stale after 3 failures
    remove_after_failures: 10     # Remove after 10 failures
    request_timeout: 5            # HTTP request timeout
```

## JSON-RPC Methods

### Standard A2A Methods

**message/send** - Send message, create/continue task
```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [{"type": "text", "text": "Hello"}]
    },
    "contextId": "optional-context",
    "taskId": "optional-existing-task"
  },
  "id": "1"
}
```

**tasks/get** - Get task by ID
```json
{
  "jsonrpc": "2.0",
  "method": "tasks/get",
  "params": {"id": "task-123", "historyLength": 10},
  "id": "2"
}
```

**tasks/list** - List tasks
```json
{
  "jsonrpc": "2.0",
  "method": "tasks/list",
  "params": {"contextId": "ctx-1", "limit": 100, "offset": 0},
  "id": "3"
}
```

**tasks/cancel** - Cancel task
```json
{
  "jsonrpc": "2.0",
  "method": "tasks/cancel",
  "params": {"id": "task-123"},
  "id": "4"
}
```

### OpenAgents Extension Methods

**agents/announce** - Remote agent joins network
```json
{
  "jsonrpc": "2.0",
  "method": "agents/announce",
  "params": {
    "url": "https://remote-agent.example.com",
    "agent_id": "preferred-id",
    "metadata": {"custom": "data"}
  },
  "id": "5"
}
```

**agents/withdraw** - Remote agent leaves network
```json
{
  "jsonrpc": "2.0",
  "method": "agents/withdraw",
  "params": {"agent_id": "my-agent"},
  "id": "6"
}
```

**agents/list** - List all agents
```json
{
  "jsonrpc": "2.0",
  "method": "agents/list",
  "params": {
    "include_local": true,
    "include_remote": true,
    "status": "active"
  },
  "id": "7"
}
```

**events/send** - Send event through network
```json
{
  "jsonrpc": "2.0",
  "method": "events/send",
  "params": {
    "event_name": "task.complete",
    "source_id": "agent-1",
    "destination_id": "agent-2",
    "payload": {"result": "data"}
  },
  "id": "8"
}
```

## Skill Collection

Skills are dynamically collected from multiple sources:

1. **Local Agents** - `metadata.skills` from registered agents
2. **Remote A2A Agents** - `skills` from Agent Cards
3. **Mods** - Tools exposed by loaded mods

Skill ID format:
- `{agent_id}.{skill_id}` - Local agent skills
- `remote.{agent_id}.{skill_id}` - Remote agent skills
- `mod.{mod_id}.{tool_name}` - Mod tools

## Cross-Protocol Routing

Events are routed based on destination agent's transport type:

```python
# Routing logic in NetworkTopology
connection = topology.agent_registry.get(destination_id)
if connection.transport_type == TransportType.GRPC:
    # Route via gRPC transport
elif connection.transport_type == TransportType.A2A:
    # Route via A2A (HTTP POST to connection.address)
elif connection.transport_type == TransportType.WEBSOCKET:
    # Route via WebSocket
```

## API Reference

### HttpTransport A2A Methods

```python
# HTTP Transport with A2A
transport = HttpTransport(config={
    'serve_a2a': True,
    'a2a_agent': {'name': 'My Network'},
})

# Internal methods (prefixed with _a2a_)
transport._a2a_generate_agent_card()
transport._a2a_handle_announce_agent(params)
transport._a2a_handle_list_agents(params)
transport._a2a_handle_send_event(params)
```

### NetworkTopology Remote Agent Methods

```python
# Announce remote agent
connection = await topology.announce_remote_agent(
    url="https://remote.example.com",
    preferred_id="my-agent",
    metadata={"custom": "data"},
)

# Withdraw remote agent
success = await topology.withdraw_remote_agent("my-agent")

# Get agents by type
local = topology.get_local_agents()
remote = topology.get_remote_agents(status=RemoteAgentStatus.ACTIVE)

# Get agent by URL
agent = topology.get_agent_by_url("https://remote.example.com")

# Health check
is_healthy = await topology.health_check_remote_agent("agent-id")
```

## Files Changed

### New Configuration Options

| File | Option | Type | Default | Description |
|------|--------|------|---------|-------------|
| `http.py` | `serve_a2a` | bool | `false` | Enable A2A at `/a2a` |
| `http.py` | `a2a_agent` | dict | `{}` | Agent Card config |
| `http.py` | `a2a_auth` | dict | `{}` | Authentication config |

### Modified Files

| File | Changes |
|------|---------|
| `src/openagents/core/transports/http.py` | Added A2A handlers under `/a2a` |
| `src/openagents/models/transport.py` | Added `RemoteAgentStatus`, extended `AgentConnection` |
| `src/openagents/core/topology.py` | Added remote agent management methods |
| `tests/a2a/test_cross_protocol_communication.py` | Updated to use HTTP `/a2a` |

## Migration Guide

### From Standalone A2A Transport

If you were using the standalone A2A transport on port 8900:

**Before:**
```yaml
transports:
  - type: "a2a"
    config:
      port: 8900
```

**After:**
```yaml
transports:
  - type: "http"
    config:
      port: 8700
      serve_a2a: true
```

Update client configurations:
- Old: `http://localhost:8900/`
- New: `http://localhost:8700/a2a`

### Agent Card URL

If specifying custom Agent Card URL, update the path:

```yaml
a2a_agent:
  url: "http://localhost:8700/a2a"  # Include /a2a suffix
```

## Troubleshooting

### A2A Routes Not Available

Ensure `serve_a2a: true` is set in HTTP transport config:

```yaml
transports:
  - type: "http"
    config:
      serve_a2a: true  # Must be explicitly enabled
```

### Remote Agent Health Check Failures

Check network connectivity and agent availability:

```python
# Check agent status
agents = await topology.get_remote_agents()
for agent in agents:
    print(f"{agent.agent_id}: {agent.remote_status} (failures: {agent.failure_count})")
```

### Authentication Errors

Verify token configuration:

```yaml
a2a_auth:
  type: "bearer"
  token_env: "A2A_TOKEN"  # Ensure env var is set
```

```bash
export A2A_TOKEN="your-secret-token"
```
