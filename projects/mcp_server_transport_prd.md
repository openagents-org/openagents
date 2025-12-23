# MCP Server Transport PRD

## == Overview / Objective

When an OpenAgents network is running, it should serve as an MCP (Model Context Protocol) server that exposes:
1. **README as `instructions`** - in the MCP initialize response
2. **Tools from network mods** - via `get_tools()` method
3. **Custom tools from workspace** - auto-discovered from `tools/` folder
4. **Custom events as tools** - auto-discovered from `events/` folder with `x-agent-tool` extension

This enables external agents to easily connect to the network and use its capabilities without joining as a full agent.

**Protocol Version:** MCP 2025-03-26 (Streamable HTTP)

---

## == Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Transport mode | **Streamable HTTP** | Latest MCP standard (2025-03-26), replaces SSE-only |
| Endpoint | **Single `/mcp` endpoint** | Per MCP spec - POST for requests, GET for SSE stream |
| Session management | **`Mcp-Session-Id` header** | Required by Streamable HTTP spec |
| Tool naming | **Original names, fail on conflict** | Simpler, catches config issues early |
| Tool filtering | **Whitelist + Blacklist (combined)** | Start with exposed_tools, then remove excluded_tools |
| Instructions priority | `external_access.instruction` → `network_profile.readme` → `network_profile.description` | Dedicated external_access section for access control |
| Authentication | **Developer configurable** | Flexible for different deployment scenarios |
| Workspace tools | **Auto-discover from `tools/` folder** | Easy custom tool creation without writing a full mod |
| Workspace tool format | **Decorated async functions** | Simple, Pythonic, minimal boilerplate |
| Event tools | **`x-agent-tool` AsyncAPI extension** | Declarative, co-located with event definition |
| Event tool execution | **Fire-and-forget (emit event)** | Simple, matches event semantics |

---

## == Functional Requirements

### FR1: MCP Transport Type (Streamable HTTP)
- Add MCP as a new transport type in the `transports` array
- Single endpoint `/mcp` supporting POST and GET methods
- Configurable port (default: 8800)
- Session management via `Mcp-Session-Id` header

### FR2: Streamable HTTP Protocol
- **POST /mcp**: Receive JSON-RPC requests, return JSON or SSE stream
- **GET /mcp**: Open SSE stream for server-to-client notifications
- **DELETE /mcp**: Terminate session (optional)
- Support `Accept: application/json, text/event-stream` header

### FR3: Tool Exposure
- Collect tools from three sources:
  1. **Network mods** - via `get_tools()` method
  2. **Workspace tools** - auto-discovered from `{workspace}/tools/` folder
  3. **Event tools** - auto-discovered from `{workspace}/events/` folder with `x-agent-tool` extension
- Fail at startup if tool name conflicts exist (across all sources)
- Convert `AgentTool` to MCP tool format

### FR4: Tool Filtering
- Support `external_access.exposed_tools` whitelist (if set, start with only these tools)
- Support `external_access.excluded_tools` blacklist (remove these tools from the set)
- **Combined behavior**: If both set, start with `exposed_tools`, then remove `excluded_tools`
- If neither set, expose all tools (default)

### FR5: Instructions
- Support `external_access.instruction` field (highest priority)
- Support `network_profile.readme` field (second priority)
- Fall back to `network_profile.description` (third priority)
- `instruction` can be inline text or path to `.md`/`.txt` file

### FR6: Authentication
- Optional bearer token authentication via `external_access.auth_token` or `auth_token_env`
- **If `auth_token` is configured**: Authentication is required, return 401 for missing/invalid tokens
- **If `auth_token` is not configured**: MCP endpoint is open (no auth required)
- Token validated via `Authorization: Bearer <token>` header

### FR7: Workspace Tools
- Auto-discover tools from `{workspace}/tools/` folder
- Support `.py` files with `@tool` decorated async functions
- Each tool function becomes an MCP tool with:
  - `name`: Function name (or decorator override)
  - `description`: From docstring or decorator
  - `inputSchema`: Auto-generated from function signature/type hints
- Tools are loaded at network startup
- Name conflicts with mod tools cause startup failure

### FR8: Custom Events as Tools
- Auto-discover event definitions from `{workspace}/events/` folder
- Support AsyncAPI 3.0 `.yaml` files
- Operations with `x-agent-tool.enabled: true` become MCP tools
- Tool properties derived from:
  - `name`: `x-agent-tool.name` → operation ID → channel address (fallback chain)
  - `description`: `x-agent-tool.description` → operation `summary` (fallback)
  - `inputSchema`: From message payload schema in AsyncAPI
- When tool is called, emit the corresponding event to the network
- Subject to `external_access.exposed_tools` / `excluded_tools` filtering
- Name conflicts with mod/workspace tools cause startup failure

### FR9: Agent Group Assignment
- MCP clients are assigned to `external_access.default_agent_group`
- Default value: `"guest"` if not specified
- If `default_agent_group` not defined in `agent_groups`, auto-create with minimal permissions
- The assigned group determines permissions for tool execution context

---

## == Configuration Schema

```yaml
network:
  transports:
    - type: "http"
      config:
        port: 8700
    - type: "mcp"
      config:
        port: 8800
        endpoint: "/mcp"  # Default: /mcp

network_profile:
  name: "My Network"
  description: "Brief description"  # Third priority for instructions
  readme: |  # Second priority for instructions
    # My Network

    Detailed documentation...

# Dedicated section for external agent access control
external_access:
  # Agent group assignment for MCP clients
  default_agent_group: "guest"  # All MCP clients get this group (default: "guest")

  # Authentication (optional - if set, auth is required)
  auth_token: null        # If set, Bearer token required for MCP access
  auth_token_env: null    # Or read token from environment variable

  # Instructions for external agents (highest priority)
  instruction: null  # Inline text or path to .md/.txt file

  # Tool filtering (combined: start with whitelist, remove blacklist)
  exposed_tools: null    # If set, only these tools are exposed
  excluded_tools: null   # If set, these tools are removed from exposed set
```

### Tool Filtering Examples

```yaml
# Example 1: Expose all tools (default)
external_access: null

# Example 2: Whitelist only specific tools
external_access:
  exposed_tools: ["search", "query", "summarize"]

# Example 3: Blacklist sensitive tools
external_access:
  excluded_tools: ["admin_delete", "config_update"]

# Example 4: Combined - whitelist with exceptions
external_access:
  exposed_tools: ["search", "query", "admin_read", "admin_write"]
  excluded_tools: ["admin_write"]  # Result: search, query, admin_read
```

### Workspace Tools Examples

**Folder Structure:**
```
workspace/
├── network.yaml
├── tools/
│   ├── __init__.py        # Optional
│   ├── search_tools.py    # Multiple tools per file
│   └── weather.py         # Single tool per file
└── ...
```

**Tool Definition (`tools/weather.py`):**
```python
from openagents.tools import tool

@tool
async def get_weather(city: str, units: str = "celsius") -> str:
    """Get current weather for a city.

    Args:
        city: Name of the city
        units: Temperature units (celsius or fahrenheit)

    Returns:
        Weather information for the city
    """
    # Implementation here
    return f"Weather in {city}: 22°{units[0].upper()}, Sunny"


@tool(name="forecast", description="Get 5-day weather forecast")
async def get_forecast(city: str) -> str:
    """Get weather forecast."""
    return f"5-day forecast for {city}..."
```

**Tool Definition (`tools/search_tools.py`):**
```python
from openagents.tools import tool

@tool
async def search_documents(query: str, limit: int = 10) -> str:
    """Search documents in the knowledge base."""
    # Implementation
    return f"Found {limit} results for: {query}"


@tool
async def search_web(query: str, count: int = 5) -> str:
    """Search the web for information."""
    # Implementation
    return f"Web results for: {query}"
```

### Custom Events as Tools Examples

**Folder Structure:**
```
workspace/
├── network.yaml
├── tools/
│   └── ...
├── events/
│   ├── task_coordination.yaml   # AsyncAPI 3.0 event definitions
│   └── file_operations.yaml
└── ...
```

**Event Definition with `x-agent-tool` Extension (`events/task_coordination.yaml`):**
```yaml
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
    # Expose as MCP tool
    x-agent-tool:
      enabled: true
      name: delegate_task          # Optional, defaults to operation ID
      description: "Delegate a task to a worker agent"  # Optional, defaults to summary

components:
  messages:
    TaskDelegate:
      name: task.delegate
      payload:
        $ref: '#/components/schemas/TaskDelegatePayload'

  schemas:
    TaskDelegatePayload:
      type: object
      required: [task_id, task_type, instructions, assigned_agent]
      properties:
        task_id:
          type: string
          description: Unique identifier for the task
        task_type:
          type: string
          enum: ["download", "analyze", "convert"]
        instructions:
          type: string
          description: Detailed instructions for the task
        assigned_agent:
          type: string
          description: ID of the agent to execute the task
```

**Resulting MCP Tool:**
```json
{
  "name": "delegate_task",
  "description": "Delegate a task to a worker agent",
  "inputSchema": {
    "type": "object",
    "required": ["task_id", "task_type", "instructions", "assigned_agent"],
    "properties": {
      "task_id": { "type": "string", "description": "Unique identifier for the task" },
      "task_type": { "type": "string", "enum": ["download", "analyze", "convert"] },
      "instructions": { "type": "string", "description": "Detailed instructions for the task" },
      "assigned_agent": { "type": "string", "description": "ID of the agent to execute the task" }
    }
  }
}
```

---

## == Architecture

### Streamable HTTP Transport (MCP 2025-03-26)

The Streamable HTTP transport uses a single endpoint that supports both synchronous request/response and streaming via SSE.

```
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Streamable HTTP                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  POST /mcp                          GET /mcp                     │
│  ─────────                          ────────                     │
│  • JSON-RPC requests                • Open SSE stream            │
│  • Returns JSON or SSE              • Server→Client notifications│
│  • Session init via header          • Requires Mcp-Session-Id    │
│                                                                  │
│  Headers:                                                        │
│  • Accept: application/json, text/event-stream                   │
│  • Mcp-Session-Id: <session-id>                                  │
│  • Authorization: Bearer <token> (optional)                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Request/Response Flow

```
Client                              MCPTransport
   │                                     │
   ├── POST /mcp ───────────────────────>│  Initialize request
   │   {"jsonrpc":"2.0","method":"initialize"...}
   │                                     │
   │<── 200 OK + Mcp-Session-Id ─────────┤  Session created
   │   {"jsonrpc":"2.0","result":{...}}  │
   │                                     │
   ├── POST /mcp ───────────────────────>│  List tools
   │   Mcp-Session-Id: abc123            │
   │   {"method":"tools/list"...}        │
   │                                     │
   │<── 200 OK ──────────────────────────┤
   │   {"result":{"tools":[...]}}        │
   │                                     │
   ├── POST /mcp ───────────────────────>│  Call tool
   │   {"method":"tools/call"...}        │
   │                                     │
   │<── 200 OK (SSE or JSON) ────────────┤  May stream response
   │                                     │
   ├── GET /mcp ────────────────────────>│  Open notification stream
   │   Mcp-Session-Id: abc123            │
   │<── SSE stream ──────────────────────┤  Server notifications
```

### Tool Collection Flow

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
        │  List[AgentTool]      │                       │ x-agent-tool
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

### Tool Execution Flow

```
MCP Client                    MCPTransport                NetworkToolCollector
    │                              │                              │
    ├─── POST /mcp ───────────────>│                              │
    │    tools/list                ├─── collect_all_tools() ─────>│
    │                              │    (mods + workspace)        │
    │                              │<── List[AgentTool] ──────────┤
    │<── JSON response ────────────┤                              │
    │                              │                              │
    ├─── POST /mcp ───────────────>│                              │
    │    tools/call                ├─── get_tool_by_name() ──────>│
    │                              │<── AgentTool ────────────────┤
    │                              │                              │
    │                              ├─── tool.execute(**args) ────>│
    │                              │<── result ───────────────────┤
    │<── JSON/SSE response ────────┤                              │
```

### Event Tool Execution Flow

```
MCP Client                    MCPTransport                   Network
    │                              │                            │
    ├─── tools/call ──────────────>│                            │
    │    name: "delegate_task"     │                            │
    │    args: {task_id, ...}      │                            │
    │                              │                            │
    │                              ├─── Identify as event tool ─┤
    │                              │                            │
    │                              ├─── emit_event() ──────────>│
    │                              │    event: "task.delegate"  │
    │                              │    payload: {task_id, ...} │
    │                              │                            │
    │<── Success response ─────────┤<── Event dispatched ───────┤
    │    "Event emitted"           │                            │
```

---

## == Implementation Plan

### Phase 1: Foundation (DONE)

- [x] Add `MCP = "mcp"` to `TransportType` enum
- [x] Add `readme` field to `NetworkProfile`
- [x] Add `get_tools()` method to `BaseMod`
- [x] Create `NetworkToolCollector` class
- [x] Topology integration for MCP transport

### Phase 2: MCP Transport with Streamable HTTP (DONE)

Implemented in `/src/openagents/core/transports/mcp.py`:

- `MCPTransport` class with Streamable HTTP support
- `MCPSession` dataclass for session state
- Single `/mcp` endpoint with POST/GET/DELETE handlers
- Native JSON-RPC processing (no SDK dependency)
- Session management via `Mcp-Session-Id` header

**Supported JSON-RPC Methods:**
- `initialize` - Create session, return server info + instructions
- `initialized` - Client notification
- `tools/list` - Return available tools
- `tools/call` - Execute a tool
- `ping` - Health check

### Phase 3: External Access Configuration (PENDING)

Create new `external_access` config section for controlling external agent access:

1. **Create `ExternalAccessConfig` model** (`/src/openagents/models/external_access.py`)
   ```python
   class ExternalAccessConfig(BaseModel):
       instruction: Optional[str] = None  # Inline text or path to file
       exposed_tools: Optional[List[str]] = None  # Whitelist
       excluded_tools: Optional[List[str]] = None  # Blacklist
   ```

2. **Add to `NetworkConfig`** (`/src/openagents/models/network_config.py`)
   ```python
   external_access: Optional[ExternalAccessConfig] = None
   ```

3. **Update `NetworkToolCollector`** (`/src/openagents/core/network_tool_collector.py`)
   - Add `filter_tools()` method that applies whitelist/blacklist logic
   - Integrate with `collect_all_tools()` or provide filtered view

4. **Update `MCPTransport`** (`/src/openagents/core/transports/mcp.py`)
   - Update `_get_instructions()` to check `external_access.instruction` first
   - Use filtered tools from NetworkToolCollector

5. **Remove deprecated fields** from `NetworkProfile`
   - Remove `external_instruction` field (moved to `external_access.instruction`)

### Phase 4: Workspace Tools Discovery (PENDING)

Add auto-discovery of tools from the workspace `tools/` folder:

1. **Create `@tool` decorator** (`/src/openagents/tools/__init__.py`)
   ```python
   def tool(func=None, *, name=None, description=None):
       """Decorator to mark a function as an MCP tool."""
       ...
   ```

2. **Create `WorkspaceToolLoader`** (`/src/openagents/core/workspace_tool_loader.py`)
   - Scan `{workspace}/tools/` for `.py` files
   - Import modules and find `@tool` decorated functions
   - Convert to `AgentTool` instances
   - Generate `input_schema` from type hints

3. **Update `NetworkToolCollector`** (`/src/openagents/core/network_tool_collector.py`)
   - Add `collect_workspace_tools()` method
   - Merge workspace tools with mod tools in `collect_all_tools()`
   - Check for name conflicts across both sources

4. **Schema Generation**
   - Parse function signature and type hints
   - Support basic types: `str`, `int`, `float`, `bool`, `list`, `dict`
   - Support `Optional[T]` for optional parameters
   - Use default values to determine required vs optional

### Phase 5: Custom Events as Tools (PENDING)

Add auto-discovery of event tools from the workspace `events/` folder:

1. **Create `EventToolLoader`** (`/src/openagents/core/event_tool_loader.py`)
   - Scan `{workspace}/events/` for `.yaml` files
   - Parse AsyncAPI 3.0 format
   - Find operations with `x-agent-tool.enabled: true`
   - Convert to `AgentTool` instances
   - Tool execution emits the corresponding event

2. **Update `NetworkToolCollector`** (`/src/openagents/core/network_tool_collector.py`)
   - Add `collect_event_tools()` method
   - Merge event tools with mod + workspace tools in `collect_all_tools()`
   - Check for name conflicts across all three sources

3. **Create event emission handler**
   - When event tool is called, emit corresponding event to the network
   - Return success message ("Event emitted")

4. **Tool Property Derivation**
   - `name`: `x-agent-tool.name` → operation ID → channel address (fallback chain)
   - `description`: `x-agent-tool.description` → operation `summary` (fallback)
   - `inputSchema`: From message payload schema in AsyncAPI

---

## == Edge Cases

| Case | Handling |
|------|----------|
| Tool name conflicts | **Fail at startup** with clear error message |
| No tools available | Return empty list (valid MCP response) |
| Instructions too large | No truncation - let MCP client handle |
| Tool execution fails | Return `isError: true` with error message |
| MCP port conflict | Fail initialization with clear error |
| Invalid auth token | Return 401 Unauthorized |
| `auth_token` set but no token provided | Return 401 Unauthorized |
| `auth_token` not configured | Allow unauthenticated access |
| `default_agent_group` not in `agent_groups` | Auto-create "guest" group with minimal permissions |
| Missing session ID | Return 404 for GET, create new for POST |
| Invalid session ID | Return 404, force re-initialization |
| File path doesn't exist | Fall back to next priority |
| `exposed_tools` has invalid name | **Log warning**, skip invalid names |
| `excluded_tools` has invalid name | **Log warning**, skip invalid names |
| All tools filtered out | Return empty list (valid MCP response) |
| Both whitelist and blacklist set | Apply both: whitelist first, then blacklist |
| No `tools/` folder | Skip workspace tools (no error) |
| Empty `tools/` folder | Skip workspace tools (no error) |
| Invalid Python in `tools/*.py` | **Log error**, skip that file, continue with others |
| Function missing `@tool` decorator | Skip function (not a tool) |
| Sync function with `@tool` | **Wrap in async executor** or **reject with warning** |
| Missing type hints | Use `Any` type, generate permissive schema |
| Workspace tool conflicts with mod tool | **Fail at startup** with clear error |
| No `events/` folder | Skip event tools (no error) |
| Empty `events/` folder | Skip event tools (no error) |
| Invalid AsyncAPI YAML | **Log error**, skip that file, continue with others |
| Operation missing `x-agent-tool` | Skip operation (not a tool) |
| `x-agent-tool.enabled: false` | Skip operation (explicitly disabled) |
| Event tool conflicts with mod/workspace tool | **Fail at startup** with clear error |
| Invalid payload schema | Use permissive `object` schema |

---

## == Expected Deliverables

### Phase 1-2 (DONE)
- [x] `MCP = "mcp"` added to `TransportType` enum
- [x] `readme` field in `NetworkProfile`
- [x] `NetworkToolCollector` class
- [x] `get_tools()` method in `BaseMod`
- [x] Topology integration for MCP transport
- [x] `MCPTransport` with Streamable HTTP (MCP 2025-03-26)
- [x] Session management with `Mcp-Session-Id`

### Phase 3 (PENDING)
- [ ] `ExternalAccessConfig` model with `instruction`, `exposed_tools`, `excluded_tools`
- [ ] Add `external_access` field to `NetworkConfig`
- [ ] Tool filtering in `NetworkToolCollector`
- [ ] Update `MCPTransport` to use `external_access.instruction`
- [ ] Remove `external_instruction` from `NetworkProfile`
- [ ] Unit tests for tool filtering
- [ ] Example network.yaml with external_access configured

### Phase 4 (PENDING)
- [ ] `@tool` decorator in `openagents.tools`
- [ ] `WorkspaceToolLoader` class
- [ ] Schema generation from type hints
- [ ] Integration with `NetworkToolCollector`
- [ ] Unit tests for workspace tools
- [ ] Example workspace with custom tools
- [ ] Documentation for creating custom tools

### Phase 5 (PENDING)
- [ ] `EventToolLoader` class with AsyncAPI 3.0 parser
- [ ] `x-agent-tool` extension support
- [ ] Event emission handler for tool execution
- [ ] Integration with `NetworkToolCollector`
- [ ] Unit tests for event tools
- [ ] Example events with `x-agent-tool` extension
- [ ] Documentation for exposing events as tools

---

## == Files Modified

### Phase 1-2 (DONE)
| File | Changes |
|------|---------|
| `/src/openagents/models/transport.py` | Added `MCP = "mcp"` to TransportType enum |
| `/src/openagents/models/network_profile.py` | Added `readme` field |
| `/src/openagents/core/base_mod.py` | Added `get_tools()` method |
| `/src/openagents/core/network_tool_collector.py` | New - Tool collector for aggregating mod tools |
| `/src/openagents/core/topology.py` | Added MCP transport case + network reference |
| `/src/openagents/core/transports/mcp.py` | New - Streamable HTTP transport implementation |
| `/src/openagents/core/transports/__init__.py` | Export MCPTransport |

### Phase 3 (PENDING)
| File | Changes |
|------|---------|
| `/src/openagents/models/external_access.py` | **New** - `ExternalAccessConfig` model |
| `/src/openagents/models/network_config.py` | Add `external_access: Optional[ExternalAccessConfig]` |
| `/src/openagents/models/network_profile.py` | Remove `external_instruction` field |
| `/src/openagents/core/network_tool_collector.py` | Add `filter_tools()` method |
| `/src/openagents/core/transports/mcp.py` | Update `_get_instructions()` to use `external_access` |

### Phase 4 (PENDING)
| File | Changes |
|------|---------|
| `/src/openagents/tools/__init__.py` | **New** - `@tool` decorator and exports |
| `/src/openagents/tools/decorator.py` | **New** - Tool decorator implementation |
| `/src/openagents/tools/schema.py` | **New** - Schema generation from type hints |
| `/src/openagents/core/workspace_tool_loader.py` | **New** - Tool discovery and loading |
| `/src/openagents/core/network_tool_collector.py` | Add `collect_workspace_tools()` method |

### Phase 5 (PENDING)
| File | Changes |
|------|---------|
| `/src/openagents/core/event_tool_loader.py` | **New** - AsyncAPI parser, event tool loader |
| `/src/openagents/core/network_tool_collector.py` | Add `collect_event_tools()` method |
| `/src/openagents/core/transports/mcp.py` | Handle event tool execution (emit event) |

---

## == Dependencies

- `aiohttp` (already used for HTTP transport)

Note: The implementation handles MCP protocol natively without requiring the `mcp` Python SDK.

---

## Estimates and Records

### Workstream

| Task | Estimate | Status |
|------|----------|--------|
| Phase 1: Foundation (models + topology) | 1 PD | Done |
| Phase 2: MCP Transport (Streamable HTTP) | 2 PD | Done |
| Phase 3: External Access Config + Tool Filtering | 0.5 PD | Pending |
| Phase 4: Workspace Tools Discovery | 1 PD | Pending |
| Phase 5: Custom Events as Tools | 1 PD | Pending |
| Testing | 1 PD | Pending |
| **Total** | **6.5 PD** | |

