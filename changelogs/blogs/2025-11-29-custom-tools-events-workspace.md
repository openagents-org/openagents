# Building Custom Tools and Events in Your Network Workspace

*November 29, 2025*

One of the most powerful features of OpenAgents is the ability to extend your network with custom tools and events without writing any infrastructure code. Simply drop Python files in the `tools/` folder or AsyncAPI definitions in the `events/` folder, and they're automatically discovered and exposed via MCP.

This guide walks you through creating custom tools and events from scratch.

## The Workspace Folder Structure

Every OpenAgents network has a workspace folder that contains your configuration, tools, events, and other resources:

```
my_network/
├── network.yaml           # Network configuration
├── tools/                 # Custom Python tools
│   ├── calculator.py
│   ├── file_operations.py
│   └── search.py
├── events/                # AsyncAPI event definitions
│   ├── task_events.yaml
│   └── notifications.yaml
└── data/                  # Optional data directory
```

When the network starts, OpenAgents automatically:
1. Scans `tools/*.py` for functions decorated with `@tool`
2. Scans `events/*.yaml` for AsyncAPI operations with `x-agent-tool` extension
3. Merges these with any mod-provided tools
4. Exposes everything via the MCP transport

## Creating Custom Tools

### Step 1: Create the Tools Folder

```bash
mkdir -p my_network/tools
```

### Step 2: Write Your First Tool

Create a Python file with one or more functions decorated with `@tool`:

```python
# my_network/tools/calculator.py
from openagents.core.tool_decorator import tool

@tool
async def add(a: float, b: float) -> float:
    """Add two numbers together.

    Args:
        a: First number
        b: Second number

    Returns:
        The sum of a and b
    """
    return a + b

@tool
async def multiply(a: float, b: float) -> float:
    """Multiply two numbers.

    Args:
        a: First number
        b: Second number

    Returns:
        The product of a and b
    """
    return a * b

@tool
async def divide(a: float, b: float) -> float:
    """Divide first number by second.

    Args:
        a: Numerator
        b: Denominator (must not be zero)

    Returns:
        The quotient of a divided by b

    Raises:
        ValueError: If b is zero
    """
    if b == 0:
        raise ValueError("Cannot divide by zero")
    return a / b
```

### Step 3: Customize Tool Names and Descriptions

Use decorator parameters to override defaults:

```python
# my_network/tools/search.py
from openagents.core.tool_decorator import tool

@tool(
    name="web_search",
    description="Search the internet for information on any topic"
)
async def search(query: str, max_results: int = 10) -> str:
    """Internal implementation - decorator overrides this docstring."""
    # Your search implementation
    return f"Found {max_results} results for: {query}"
```

### Step 4: Mix Sync and Async Functions

Both sync and async functions work:

```python
# my_network/tools/utilities.py
from openagents.core.tool_decorator import tool
from datetime import datetime

@tool
def get_current_time() -> str:
    """Get the current time as a formatted string."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

@tool
async def fetch_data(url: str) -> dict:
    """Fetch JSON data from a URL."""
    import aiohttp
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.json()
```

### Type Hints and Schema Generation

The `@tool` decorator automatically generates JSON Schema from your type hints:

```python
from typing import List, Optional, Dict
from openagents.core.tool_decorator import tool

@tool
async def create_task(
    title: str,                          # Required string
    priority: int = 1,                   # Optional integer with default
    tags: Optional[List[str]] = None,    # Optional array of strings
    metadata: Optional[Dict] = None      # Optional object
) -> dict:
    """Create a new task with the given parameters."""
    return {
        "title": title,
        "priority": priority,
        "tags": tags or [],
        "metadata": metadata or {}
    }
```

This generates the following MCP tool schema:

```json
{
  "name": "create_task",
  "description": "Create a new task with the given parameters.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": {"type": "string", "description": "..."},
      "priority": {"type": "integer", "description": "..."},
      "tags": {"type": "array", "description": "..."},
      "metadata": {"type": "object", "description": "..."}
    },
    "required": ["title"]
  }
}
```

## Creating Custom Events

Custom events let external agents trigger internal workflows. Events are defined using AsyncAPI 3.0 format with the `x-agent-tool` extension.

### Step 1: Create the Events Folder

```bash
mkdir -p my_network/events
```

### Step 2: Define Your Events

Create an AsyncAPI 3.0 YAML file:

```yaml
# my_network/events/task_events.yaml
asyncapi: '3.0.0'
info:
  title: Task Management Events
  version: '1.0.0'
  description: Events for delegating and tracking tasks

channels:
  task/delegate:
    address: task.delegate
    messages:
      task.delegate:
        $ref: '#/components/messages/TaskDelegate'

  task/status:
    address: task.status
    messages:
      task.status:
        $ref: '#/components/messages/TaskStatus'

operations:
  # This operation becomes an MCP tool
  delegateTask:
    action: send
    channel:
      $ref: '#/channels/task~1delegate'
    summary: Delegate a task to a worker agent
    x-agent-tool:
      enabled: true
      name: delegate_task
      description: "Delegate a task to a specific agent for execution"

  # Another MCP tool
  reportStatus:
    action: send
    channel:
      $ref: '#/channels/task~1status'
    summary: Report task execution status
    x-agent-tool:
      enabled: true
      name: report_status
      description: "Report the status of a task execution"

  # This operation is NOT exposed (no x-agent-tool)
  internalNotify:
    action: send
    channel:
      $ref: '#/channels/task~1status'
    summary: Internal status notification

components:
  messages:
    TaskDelegate:
      name: task.delegate
      payload:
        $ref: '#/components/schemas/TaskDelegatePayload'

    TaskStatus:
      name: task.status
      payload:
        $ref: '#/components/schemas/TaskStatusPayload'

  schemas:
    TaskDelegatePayload:
      type: object
      required:
        - task_id
        - task_type
        - instructions
      properties:
        task_id:
          type: string
          description: Unique identifier for the task
        task_type:
          type: string
          description: Type of task to execute
          enum: ["analyze", "download", "convert", "summarize"]
        instructions:
          type: string
          description: Detailed instructions for the agent
        priority:
          type: string
          default: "normal"
          enum: ["low", "normal", "high", "urgent"]

    TaskStatusPayload:
      type: object
      required:
        - task_id
        - status
      properties:
        task_id:
          type: string
        status:
          type: string
          enum: ["pending", "running", "completed", "failed"]
        progress:
          type: integer
          minimum: 0
          maximum: 100
        message:
          type: string
```

### Understanding x-agent-tool

The `x-agent-tool` extension controls which operations become MCP tools:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | Yes | Set to `true` to expose as tool |
| `name` | string | No | Tool name (defaults to operation ID) |
| `description` | string | No | Tool description (defaults to summary) |

Operations **without** `x-agent-tool` or with `enabled: false` are not exposed.

### What Happens When an Event Tool is Called

When an external agent calls an event tool:

1. MCP transport receives the `tools/call` request
2. The event tool handler is invoked
3. An event is emitted to the network with the tool arguments as payload
4. A success response is returned immediately (fire-and-forget)

```
External Agent          MCP Transport           Network
      │                       │                    │
      │── call delegate_task ─>│                    │
      │   {task_id: "123"}    │                    │
      │                       │── emit event ──────>│
      │                       │   task.delegate     │
      │                       │   {task_id: "123"}  │
      │<── success ───────────│                    │
      │                       │                    │
```

## Putting It All Together

### Complete Network Configuration

```yaml
# my_network/network.yaml
network:
  name: "MyCustomNetwork"
  mode: "centralized"

  transports:
    - type: "http"
      config:
        port: 8000
    - type: "mcp"
      config:
        port: 8800
        endpoint: "/mcp"

  agent_groups:
    guest:
      description: "External agents"
      password_hash: "guest_hash"
    workers:
      description: "Internal worker agents"
      password_hash: "worker_hash"

# External access configuration
external_access:
  default_agent_group: "guest"

  # Optional: require authentication
  # auth_token: "secret-token"

  # Instructions for external agents
  instruction: |
    Welcome to MyCustomNetwork!

    Available tools:
    - Calculator: add, multiply, divide
    - Search: web_search
    - Tasks: delegate_task, report_status

  # Optional: filter which tools are exposed
  # exposed_tools:
  #   - add
  #   - web_search
  #   - delegate_task
  # excluded_tools:
  #   - internal_debug
```

### Directory Structure

```
my_network/
├── network.yaml
├── tools/
│   ├── calculator.py      # add, multiply, divide
│   ├── search.py          # web_search
│   └── utilities.py       # get_current_time, fetch_data
├── events/
│   └── task_events.yaml   # delegate_task, report_status
```

### Start the Network

```bash
cd my_network
openagents run
```

### Test with the MCP Client

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async def test_tools():
    url = "http://localhost:8800/mcp"

    async with streamablehttp_client(url) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            # List all tools
            result = await session.list_tools()
            print(f"Available tools: {[t.name for t in result.tools]}")

            # Call a workspace tool
            result = await session.call_tool("add", {"a": 5, "b": 3})
            print(f"5 + 3 = {result.content[0].text}")

            # Call an event tool
            result = await session.call_tool("delegate_task", {
                "task_id": "task-001",
                "task_type": "analyze",
                "instructions": "Analyze the quarterly report"
            })
            print(f"Task delegated: {result.content[0].text}")
```

## Best Practices

### Tool Design

1. **Clear names**: Use descriptive, action-oriented names (`search_documents`, not `docs`)
2. **Comprehensive docstrings**: Include Args, Returns, and Raises sections
3. **Type hints everywhere**: Enable automatic schema generation
4. **Proper error handling**: Raise meaningful exceptions with clear messages
5. **Async for I/O**: Use async functions for network/file operations

### Event Design

1. **Meaningful channel addresses**: Use hierarchical naming (`task.delegate`, `user.created`)
2. **Complete schemas**: Define all properties with types and descriptions
3. **Required vs optional**: Mark essential fields as required
4. **Enums for controlled values**: Use enums for status fields and types

### Security

1. **Enable auth for production**: Set `auth_token` or `auth_token_env`
2. **Use tool filtering**: Expose only necessary tools via `exposed_tools`
3. **Validate inputs**: Check arguments in your tool implementations
4. **Log tool calls**: Track who calls what for auditing

## Troubleshooting

### Tools Not Discovered

- Check the file is in `{workspace}/tools/` (not nested)
- Ensure file doesn't start with `_` (e.g., `__init__.py` is skipped)
- Verify `@tool` decorator is imported from `openagents.core.tool_decorator`
- Check for Python syntax errors in the file

### Events Not Exposed

- Verify `asyncapi: '3.0.0'` version
- Check `x-agent-tool.enabled: true` is set
- Ensure operation has a valid channel reference
- Look for YAML syntax errors

### Tool Name Conflicts

```
ValueError: Tool name conflict: 'search' is defined in both
'workspace' and 'mod:search_mod'. Tool names must be unique.
```

Solution: Rename one of the tools using the `name` parameter in `@tool` decorator.

## What's Next

Now that you know how to create custom tools and events, explore:

- **Tool filtering**: Control which tools are visible with `exposed_tools` and `excluded_tools`
- **Authentication**: Secure your MCP endpoint with bearer tokens
- **Agent groups**: Assign different permissions to different agent groups
- **Network mods**: Build reusable tool packages as mods

Happy building!

---

*The OpenAgents Team*
