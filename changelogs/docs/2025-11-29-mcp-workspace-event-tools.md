# MCP Workspace Tools & Event Tools Guide

## Overview

OpenAgents MCP transport supports three sources of tools that are exposed to external agents:

1. **Network Mods** - Tools from mods via `get_tools()` method
2. **Workspace Tools** - Python functions with `@tool` decorator in `tools/` folder
3. **Event Tools** - AsyncAPI operations with `x-agent-tool` extension in `events/` folder

This guide covers workspace tools, event tools, and external access configuration.

## Workspace Tools

### Directory Structure

```
workspace/
├── network.yaml
├── tools/
│   ├── search.py
│   ├── file_ops.py
│   └── analysis.py
└── ...
```

### The @tool Decorator

Mark functions as MCP tools using the `@tool` decorator:

```python
# tools/search.py
from openagents import tool

@tool
async def search_web(query: str, max_results: int = 5) -> str:
    """Search the web for information.

    Args:
        query: The search query string
        max_results: Maximum number of results to return

    Returns:
        Search results as formatted text
    """
    # Implementation
    return f"Results for: {query}"
```

### Decorator Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `str` | Function name | Override the tool name |
| `description` | `str` | Docstring | Override the tool description |
| `input_schema` | `dict` | Auto-generated | Override the JSON schema |

```python
@tool(
    name="web_search",
    description="Search the internet for information"
)
async def search(query: str) -> str:
    ...
```

### Schema Generation

The decorator automatically generates JSON schema from type hints:

| Python Type | JSON Schema Type |
|-------------|------------------|
| `str` | `string` |
| `int` | `integer` |
| `float` | `number` |
| `bool` | `boolean` |
| `list`, `List[T]` | `array` |
| `dict`, `Dict[K, V]` | `object` |
| `Optional[T]` | Type of T (not required) |

**Example:**

```python
@tool
async def create_task(
    title: str,
    priority: int = 1,
    tags: Optional[List[str]] = None
) -> dict:
    """Create a new task."""
    ...
```

**Generated Schema:**

```json
{
  "type": "object",
  "properties": {
    "title": {"type": "string"},
    "priority": {"type": "integer"},
    "tags": {"type": "array"}
  },
  "required": ["title"]
}
```

### Sync vs Async Functions

Both sync and async functions are supported:

```python
@tool
async def async_tool(query: str) -> str:
    """Async tool - recommended for I/O operations."""
    result = await some_async_operation(query)
    return result

@tool
def sync_tool(data: dict) -> str:
    """Sync tool - for CPU-bound operations."""
    return process_data(data)
```

## Event Tools

### Directory Structure

```
workspace/
├── network.yaml
├── events/
│   ├── task_coordination.yaml
│   └── notifications.yaml
└── ...
```

### AsyncAPI 3.0 with x-agent-tool

Expose AsyncAPI operations as MCP tools using the `x-agent-tool` extension:

```yaml
# events/task_coordination.yaml
asyncapi: '3.0.0'
info:
  title: Task Coordination Events
  version: '1.0.0'

channels:
  task/delegate:
    address: task.delegate
    messages:
      task.delegate:
        $ref: '#/components/messages/TaskDelegate'

operations:
  delegateTask:
    action: send
    channel:
      $ref: '#/channels/task~1delegate'
    summary: Delegate a task to a specific agent
    x-agent-tool:
      enabled: true
      name: delegate_task
      description: "Delegate a task to a worker agent"

components:
  messages:
    TaskDelegate:
      name: task.delegate
      payload:
        $ref: '#/components/schemas/TaskDelegatePayload'

  schemas:
    TaskDelegatePayload:
      type: object
      required: [task_id, task_type, instructions]
      properties:
        task_id:
          type: string
          description: Unique identifier for the task
        task_type:
          type: string
          enum: ["download", "analyze", "convert"]
        instructions:
          type: string
          description: Detailed instructions
```

### x-agent-tool Extension

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | `boolean` | Yes | Must be `true` to expose as tool |
| `name` | `string` | No | Tool name (defaults to operation ID) |
| `description` | `string` | No | Tool description (defaults to operation summary) |

### Tool Property Derivation

Tool properties are derived with fallback chains:

| Property | Priority |
|----------|----------|
| `name` | `x-agent-tool.name` → operation ID → channel address |
| `description` | `x-agent-tool.description` → operation `summary` |
| `inputSchema` | Message payload schema from AsyncAPI |

### Event Tool Execution

When an event tool is called:

1. MCP transport receives `tools/call` request
2. Tool is identified as an event tool
3. Event is emitted to the network with payload from tool arguments
4. Success response is returned immediately (fire-and-forget)

```
MCP Client                    MCPTransport                   Network
    │                              │                            │
    ├─── tools/call ──────────────>│                            │
    │    name: "delegate_task"     │                            │
    │    args: {task_id, ...}      │                            │
    │                              │                            │
    │                              ├─── emit_event() ──────────>│
    │                              │    event: "task.delegate"  │
    │                              │    payload: {task_id, ...} │
    │                              │                            │
    │<── Success response ─────────┤                            │
    │    "Event emitted"           │                            │
```

## External Access Configuration

### Configuration Schema

```yaml
# network.yaml
external_access:
  # Agent group for MCP clients (default: "guest")
  default_agent_group: "guest"

  # Authentication (optional)
  auth_token: "secret-token"        # Direct token
  auth_token_env: "MCP_AUTH_TOKEN"  # Or from environment variable

  # Instructions for external agents
  instruction: "instructions.md"    # File path or inline text

  # Tool filtering
  exposed_tools:      # Whitelist (if set, only these tools are exposed)
    - search_web
    - delegate_task
  excluded_tools:     # Blacklist (these tools are hidden)
    - admin_reset
    - debug_dump
```

### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default_agent_group` | `string` | `"guest"` | Agent group assigned to MCP clients |
| `auth_token` | `string` | `null` | Bearer token for authentication |
| `auth_token_env` | `string` | `null` | Environment variable for auth token |
| `instruction` | `string` | `null` | Instructions for external agents |
| `exposed_tools` | `list[string]` | `null` | Whitelist of tool names |
| `excluded_tools` | `list[string]` | `null` | Blacklist of tool names |

### Authentication

Authentication is **optional by default**. When configured:

```yaml
external_access:
  auth_token: "my-secret-token"
```

Clients must include the token in requests:

```http
Authorization: Bearer my-secret-token
```

**Authentication Flow:**

| Scenario | Result |
|----------|--------|
| `auth_token` not set | No authentication required |
| `auth_token` set, valid token provided | Access granted |
| `auth_token` set, no token provided | 401 Unauthorized |
| `auth_token` set, invalid token provided | 401 Unauthorized |

### Tool Filtering

Filtering follows this logic:

1. Start with all collected tools
2. If `exposed_tools` is set, keep only those tools (whitelist)
3. Remove any tools in `excluded_tools` (blacklist)

**Examples:**

```yaml
# Only expose specific tools
external_access:
  exposed_tools:
    - search_web
    - get_status

# Hide sensitive tools
external_access:
  excluded_tools:
    - admin_reset
    - delete_all

# Combine both (whitelist then blacklist)
external_access:
  exposed_tools:
    - search_web
    - analyze
    - admin_status
  excluded_tools:
    - admin_status  # Removed even though in whitelist
```

## Tool Collection Flow

```
                    ┌─────────────────────────┐
                    │   NetworkToolCollector  │
                    └───────────┬─────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐       ┌───────────────┐       ┌───────────────┐
│  Network Mods │       │   Workspace   │       │ Custom Events │
│  get_tools()  │       │   tools/*.py  │       │ events/*.yaml │
└───────┬───────┘       └───────┬───────┘       └───────┬───────┘
        │                       │                       │
        │  List[AgentTool]      │  @tool decorator      │ x-agent-tool
        └───────────────────────┼───────────────────────┘
                                │
                                ▼
                        ┌───────────────┐
                        │ Merge + Check │
                        │   Conflicts   │
                        └───────┬───────┘
                                │
                                ▼
                        ┌───────────────┐
                        │ filter_tools  │ ◄── external_access config
                        └───────┬───────┘
                                │
                                ▼
                        ┌───────────────┐
                        │   MCP Tools   │
                        └───────────────┘
```

### Name Conflict Handling

Tool names must be unique across all sources. Conflicts cause startup failure:

```
ValueError: Tool name conflict: 'search' is defined in both
'mod:search_mod' and 'workspace'. Tool names must be unique.
```

## Edge Cases

| Case | Handling |
|------|----------|
| No `tools/` folder | Skip workspace tools (no error) |
| Empty `tools/` folder | Skip workspace tools (no error) |
| Invalid Python in `tools/*.py` | Log error, skip file, continue |
| Function missing `@tool` | Skip function |
| No `events/` folder | Skip event tools (no error) |
| Invalid AsyncAPI YAML | Log error, skip file |
| Operation missing `x-agent-tool` | Skip operation |
| `x-agent-tool.enabled: false` | Skip operation |
| Tool name conflicts | Fail at startup |
| `exposed_tools` has invalid name | Log warning, skip name |
| `excluded_tools` has invalid name | Log warning, skip name |
| All tools filtered out | Return empty list (valid) |
| Invalid payload schema | Use permissive `object` schema |

## API Reference

### WorkspaceToolLoader

```python
from openagents.core.workspace_tool_loader import WorkspaceToolLoader

loader = WorkspaceToolLoader("/path/to/workspace")
tools = loader.load_tools()  # List[AgentTool]
```

### EventToolLoader

```python
from openagents.core.event_tool_loader import EventToolLoader

loader = EventToolLoader("/path/to/workspace", network=network)
tools = loader.load_tools()  # List[AgentTool]
```

### NetworkToolCollector

```python
from openagents.core.network_tool_collector import NetworkToolCollector

collector = NetworkToolCollector(network, workspace_path="/path/to/workspace")
all_tools = collector.collect_all_tools()  # Collects from all sources

# Filter tools based on external_access config
filtered = collector.filter_tools(
    exposed_tools=["tool1", "tool2"],
    excluded_tools=["tool3"]
)

# Convert to MCP format
mcp_tools = collector.to_mcp_tools_filtered(
    exposed_tools=config.exposed_tools,
    excluded_tools=config.excluded_tools
)
```

## Files Reference

| File | Description |
|------|-------------|
| `src/openagents/core/tool_decorator.py` | `@tool` decorator implementation |
| `src/openagents/core/workspace_tool_loader.py` | Workspace tool discovery |
| `src/openagents/core/event_tool_loader.py` | AsyncAPI event tool loader |
| `src/openagents/core/network_tool_collector.py` | Tool aggregation and filtering |
| `src/openagents/models/external_access.py` | External access config model |
| `src/openagents/core/transports/mcp.py` | MCP transport with auth |

## Related Documentation

- [MCP Server Transport PRD](https://github.com/openagents-org/openagents/issues/133)
- [AsyncAPI 3.0 Specification](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
- [MCP Protocol Specification](https://modelcontextprotocol.io/)
