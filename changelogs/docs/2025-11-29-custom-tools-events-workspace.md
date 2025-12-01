# Custom Tools and Events in Network Workspace

## Overview

OpenAgents supports extending networks with custom tools and events by placing files in the workspace folder:

- **Custom Tools**: Python functions with `@tool` decorator in `tools/` folder
- **Custom Events**: AsyncAPI 3.0 definitions with `x-agent-tool` extension in `events/` folder

Both are automatically discovered at network startup and exposed via MCP transport.

## Workspace Structure

```
workspace/
├── network.yaml           # Network configuration
├── tools/                 # Python tool files
│   ├── module1.py
│   └── module2.py
├── events/                # AsyncAPI event definitions
│   ├── events1.yaml
│   └── events2.yaml
└── data/                  # Optional data directory
```

## Custom Tools

### Creating a Tool File

Place Python files in the `tools/` directory:

```python
# tools/my_tools.py
from openagents.core.tool_decorator import tool

@tool
async def my_tool(param1: str, param2: int = 10) -> str:
    """Tool description from docstring.

    Args:
        param1: Description of param1
        param2: Description of param2

    Returns:
        Description of return value
    """
    return f"Result: {param1}, {param2}"
```

### @tool Decorator Reference

```python
from openagents.core.tool_decorator import tool

@tool(
    name="custom_name",           # Override function name
    description="Custom desc",    # Override docstring
    input_schema={...}            # Override auto-generated schema
)
def my_function(...):
    ...
```

#### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `name` | `str` | Function name | MCP tool name |
| `description` | `str` | Docstring | Tool description |
| `input_schema` | `dict` | Auto-generated | JSON Schema for inputs |

#### Usage Patterns

```python
# Pattern 1: Bare decorator
@tool
def my_tool(): ...

# Pattern 2: Empty parentheses
@tool()
def my_tool(): ...

# Pattern 3: With parameters
@tool(name="custom_name")
def my_tool(): ...
```

### Type Hint to JSON Schema Mapping

| Python Type | JSON Schema |
|-------------|-------------|
| `str` | `{"type": "string"}` |
| `int` | `{"type": "integer"}` |
| `float` | `{"type": "number"}` |
| `bool` | `{"type": "boolean"}` |
| `list`, `List[T]` | `{"type": "array"}` |
| `dict`, `Dict[K,V]` | `{"type": "object"}` |
| `Optional[T]` | Type of T (not in required) |
| `None` | `{"type": "null"}` |

### Sync vs Async Functions

Both are supported:

```python
@tool
async def async_tool(query: str) -> str:
    """Recommended for I/O-bound operations."""
    result = await fetch_data(query)
    return result

@tool
def sync_tool(data: str) -> str:
    """For CPU-bound operations."""
    return process(data)
```

### Error Handling

Raise exceptions to return errors to MCP clients:

```python
@tool
async def divide(a: float, b: float) -> float:
    """Divide two numbers."""
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
```

The MCP response will include `isError: true` with the error message.

### File Discovery Rules

| Condition | Behavior |
|-----------|----------|
| File starts with `_` | Skipped (e.g., `__init__.py`) |
| File not in root of `tools/` | Skipped (no recursion) |
| File has syntax errors | Logged, skipped |
| Function missing `@tool` | Skipped |
| Tool name conflict | Startup fails |

## Custom Events

### Creating an Event File

Place AsyncAPI 3.0 YAML files in the `events/` directory:

```yaml
# events/my_events.yaml
asyncapi: '3.0.0'
info:
  title: My Events
  version: '1.0.0'

channels:
  my/channel:
    address: my.channel
    messages:
      my.message:
        $ref: '#/components/messages/MyMessage'

operations:
  myOperation:
    action: send
    channel:
      $ref: '#/channels/my~1channel'
    summary: Operation description
    x-agent-tool:
      enabled: true
      name: my_tool_name
      description: "Tool description"

components:
  messages:
    MyMessage:
      name: my.message
      payload:
        $ref: '#/components/schemas/MyPayload'

  schemas:
    MyPayload:
      type: object
      required: [field1]
      properties:
        field1:
          type: string
        field2:
          type: integer
```

### x-agent-tool Extension Reference

```yaml
x-agent-tool:
  enabled: true              # Required: must be true
  name: tool_name            # Optional: defaults to operation ID
  description: "Tool desc"   # Optional: defaults to operation summary
```

#### Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | boolean | Yes | - | Must be `true` to expose |
| `name` | string | No | Operation ID | Tool name |
| `description` | string | No | Operation summary | Tool description |

### Property Derivation Chain

| Property | Priority |
|----------|----------|
| Tool name | `x-agent-tool.name` → operation ID → channel address |
| Description | `x-agent-tool.description` → operation `summary` → "Event tool" |
| Input schema | Message payload schema → `{"type": "object"}` |

### Event Execution Flow

```
MCP Client                MCP Transport              Network
    │                          │                        │
    │── tools/call ───────────>│                        │
    │   name: "my_event_tool"  │                        │
    │   args: {...}            │                        │
    │                          │── emit_event() ───────>│
    │                          │   event_name           │
    │                          │   payload: {...}       │
    │<── success ──────────────│                        │
```

### File Discovery Rules

| Condition | Behavior |
|-----------|----------|
| Invalid YAML syntax | Logged, skipped |
| Not AsyncAPI 3.0 | Skipped |
| Missing `x-agent-tool` | Operation skipped |
| `x-agent-tool.enabled: false` | Operation skipped |
| Tool name conflict | Startup fails |

## External Access Configuration

Control tool visibility and authentication:

```yaml
# network.yaml
external_access:
  default_agent_group: "guest"
  auth_token: "secret"
  auth_token_env: "MCP_TOKEN"
  instruction: "Welcome message"
  exposed_tools:
    - tool1
    - tool2
  excluded_tools:
    - internal_tool
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default_agent_group` | string | `"guest"` | Agent group for MCP clients |
| `auth_token` | string | null | Bearer token for auth |
| `auth_token_env` | string | null | Env var for auth token |
| `instruction` | string | null | Instructions for agents |
| `exposed_tools` | list | null | Whitelist of tools |
| `excluded_tools` | list | null | Blacklist of tools |

### Tool Filtering Logic

```
1. Start with all collected tools
2. If exposed_tools set → keep only those (whitelist)
3. Remove excluded_tools (blacklist)
4. Return filtered set
```

## Complete Example

### Directory Structure

```
my_workspace/
├── network.yaml
├── tools/
│   ├── calculator.py
│   └── search.py
└── events/
    └── tasks.yaml
```

### tools/calculator.py

```python
from openagents.core.tool_decorator import tool

@tool
async def add(a: float, b: float) -> float:
    """Add two numbers."""
    return a + b

@tool
async def subtract(a: float, b: float) -> float:
    """Subtract b from a."""
    return a - b
```

### tools/search.py

```python
from openagents.core.tool_decorator import tool

@tool(name="web_search", description="Search the web")
async def search(query: str, limit: int = 10) -> str:
    """Search implementation."""
    return f"Results for {query}"
```

### events/tasks.yaml

```yaml
asyncapi: '3.0.0'
info:
  title: Task Events
  version: '1.0.0'

channels:
  task/create:
    address: task.create
    messages:
      task.create:
        payload:
          type: object
          required: [title]
          properties:
            title:
              type: string
            priority:
              type: integer

operations:
  createTask:
    action: send
    channel:
      $ref: '#/channels/task~1create'
    summary: Create a new task
    x-agent-tool:
      enabled: true
      name: create_task
```

### network.yaml

```yaml
network:
  name: "MyNetwork"
  mode: "centralized"
  transports:
    - type: "mcp"
      config:
        port: 8800

external_access:
  default_agent_group: "guest"
  instruction: |
    Available tools: add, subtract, web_search, create_task
```

### Result

Network exposes 4 MCP tools:
- `add` - from calculator.py
- `subtract` - from calculator.py
- `web_search` - from search.py
- `create_task` - from tasks.yaml

## API Reference

### WorkspaceToolLoader

```python
from openagents.core.workspace_tool_loader import WorkspaceToolLoader

loader = WorkspaceToolLoader(workspace_path="/path/to/workspace")
tools: List[AgentTool] = loader.load_tools()
```

### EventToolLoader

```python
from openagents.core.event_tool_loader import EventToolLoader

loader = EventToolLoader(
    workspace_path="/path/to/workspace",
    network=network  # AgentNetwork instance
)
tools: List[AgentTool] = loader.load_tools()
```

### NetworkToolCollector

```python
from openagents.core.network_tool_collector import NetworkToolCollector

collector = NetworkToolCollector(
    network=network,
    workspace_path="/path/to/workspace"
)

# Collect all tools
all_tools = collector.collect_all_tools()

# Get filtered tools
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

## Source Files

| File | Description |
|------|-------------|
| `src/openagents/core/tool_decorator.py` | `@tool` decorator |
| `src/openagents/core/workspace_tool_loader.py` | Tool file discovery |
| `src/openagents/core/event_tool_loader.py` | Event file discovery |
| `src/openagents/core/network_tool_collector.py` | Tool aggregation |
| `src/openagents/models/external_access.py` | Config model |

## Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Tool name conflict: 'X' defined in both 'Y' and 'Z'` | Duplicate tool names | Rename one tool |
| `Could not load module spec from X` | Invalid Python file | Fix syntax errors |
| `Error loading tools from X: Y` | Runtime error in tool | Check tool implementation |
| `exposed_tools contains unknown tool names: [X]` | Invalid whitelist entry | Check tool name spelling |
