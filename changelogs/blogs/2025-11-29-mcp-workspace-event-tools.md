# Expose Custom Tools and Events via MCP: Build Your Own Agent API

*November 29, 2025*

We're excited to announce three powerful new features for the MCP (Model Context Protocol) transport that make it easier than ever to expose custom functionality to external agents. Whether you're building tools with Python decorators or exposing event-driven workflows, OpenAgents now provides flexible options for creating your agent API.

## The Problem We Solved

When building multi-agent systems, you often need to:

1. Expose custom Python functions as tools for external agents
2. Let external agents trigger internal events and workflows
3. Control which tools are visible to different agent groups
4. Secure your MCP endpoint with authentication

Previously, this required creating custom network mods with boilerplate code. Developers told us:

> "I just want to write a Python function and have it available as a tool."

> "I already have event definitions in AsyncAPI format. Why can't external agents trigger them?"

> "I need fine-grained control over what external agents can access."

These new features address all of these needs.

## What's New

### 1. Workspace Tools: Python Functions as MCP Tools

Create tools by simply decorating Python functions in your workspace's `tools/` folder:

```python
# workspace/tools/search.py
from openagents import tool

@tool(description="Search the web for information")
async def search_web(query: str, max_results: int = 5) -> str:
    """Search the web and return results."""
    # Your implementation here
    return f"Found {max_results} results for: {query}"

@tool
async def calculate(expression: str) -> float:
    """Evaluate a mathematical expression."""
    return eval(expression)  # Use a safe evaluator in production!
```

That's it. No mod registration, no schema definitions. The `@tool` decorator automatically:

- Extracts the tool name from the function name
- Uses the docstring as the description
- Generates JSON schema from type hints
- Makes the function available as an MCP tool

### 2. Event Tools: AsyncAPI Events as MCP Tools

If you're using AsyncAPI to define your event schema, you can now expose operations as MCP tools using the `x-agent-tool` extension:

```yaml
# workspace/events/task_coordination.yaml
asyncapi: '3.0.0'
info:
  title: Task Coordination Events
  version: '1.0.0'

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
```

When an external agent calls `delegate_task`, it emits the corresponding event to your network. This enables:

- **Fire-and-forget task delegation**: External agents can trigger internal workflows
- **Event-driven orchestration**: Coordinate multiple agents through events
- **Schema reuse**: Use your existing AsyncAPI definitions

### 3. External Access Config: Authentication & Tool Filtering

Control what external agents can see and do with the new `external_access` configuration:

```yaml
# network.yaml
external_access:
  # Assign all MCP clients to the "guest" agent group
  default_agent_group: "guest"

  # Require authentication (optional)
  auth_token: "your-secret-token"
  # Or use an environment variable
  auth_token_env: "MCP_AUTH_TOKEN"

  # Only expose these tools (whitelist)
  exposed_tools:
    - search_web
    - delegate_task

  # Hide these tools (blacklist)
  excluded_tools:
    - admin_reset
    - debug_dump
```

This gives you fine-grained control over:

- **Authentication**: Require a bearer token for MCP access
- **Tool visibility**: Whitelist or blacklist specific tools
- **Agent groups**: Assign external agents to permission groups

## Tool Collection Architecture

Tools are now collected from three sources, merged, and filtered:

```
┌─────────────────────────┐
│   NetworkToolCollector  │
└───────────┬─────────────┘
            │
    ┌───────┼───────┐
    │       │       │
    ▼       ▼       ▼
┌───────┐ ┌───────┐ ┌───────┐
│ Mods  │ │tools/ │ │events/│
│       │ │ *.py  │ │ *.yaml│
└───┬───┘ └───┬───┘ └───┬───┘
    │         │         │
    └─────────┼─────────┘
              ▼
      ┌───────────────┐
      │ Merge + Check │
      │   Conflicts   │
      └───────┬───────┘
              ▼
      ┌───────────────┐
      │ filter_tools  │ ◄── external_access
      └───────┬───────┘
              ▼
      ┌───────────────┐
      │   MCP Tools   │
      └───────────────┘
```

Tool names must be unique across all sources. If conflicts are detected, the network fails at startup with a clear error message.

## Use Cases

### Building a Task Orchestration API

Combine workspace tools and event tools to create a complete orchestration API:

```
workspace/
├── network.yaml
├── tools/
│   ├── file_ops.py      # @tool: download_file, upload_file
│   └── analysis.py      # @tool: analyze_document, summarize
├── events/
│   └── tasks.yaml       # x-agent-tool: delegate_task, complete_task
```

External agents can:
1. Call `download_file` to fetch documents
2. Call `delegate_task` to assign work to internal agents
3. Receive completion events via subscriptions

### Securing a Multi-Tenant Network

Use external access config to isolate tenants:

```yaml
external_access:
  auth_token_env: "TENANT_API_KEY"
  default_agent_group: "tenant_basic"
  exposed_tools:
    - list_documents
    - search
    - create_ticket
  excluded_tools:
    - admin_*
    - internal_*
```

### Creating a Public API with Limited Access

Expose a read-only API for public consumption:

```yaml
external_access:
  # No auth required for public access
  default_agent_group: "public"
  exposed_tools:
    - search_public_docs
    - get_status
    - list_events
```

## Getting Started

### Step 1: Create a Tools Folder

```bash
mkdir -p workspace/tools
```

### Step 2: Add a Tool

```python
# workspace/tools/hello.py
from openagents import tool

@tool
async def greet(name: str) -> str:
    """Greet someone by name."""
    return f"Hello, {name}!"
```

### Step 3: Configure MCP Transport

```yaml
# network.yaml
network:
  transports:
    - type: "mcp"
      config:
        port: 8800
```

### Step 4: Start the Network

```bash
openagents run
```

Your tool is now available at `http://localhost:8800/mcp`!

## What's Next

We're continuing to enhance the MCP transport:

- **Request-reply events**: Wait for event responses instead of fire-and-forget
- **Tool streaming**: Stream results from long-running tools
- **Rate limiting**: Per-agent rate limits for tool calls
- **Audit logging**: Track all tool invocations for compliance

## Thank You

These features were shaped by feedback from our community. If you have ideas for improvements:

- Join our [Discord community](https://discord.gg/openagents)
- Open an issue on [GitHub](https://github.com/openagents-org/openagents/issues)
- Follow us on [Twitter](https://twitter.com/OpenAgentsAI) for updates

Happy building!

---

*The OpenAgents Team*

---

## Changelog

### MCP Server Transport Enhancements

**Phase 3: External Access Config**
- Added `default_agent_group` field - assign MCP clients to agent groups
- Added `auth_token` / `auth_token_env` - optional bearer token authentication
- Authentication is only required when `auth_token` is configured
- Tool filtering with `exposed_tools` (whitelist) and `excluded_tools` (blacklist)

**Phase 4: Workspace Tools Discovery**
- New `@tool` decorator for marking functions as MCP tools
- Auto-discovery from `{workspace}/tools/*.py` files
- Automatic JSON schema generation from type hints
- Support for both sync and async functions

**Phase 5: Custom Events as Tools**
- New `EventToolLoader` for AsyncAPI 3.0 event definitions
- `x-agent-tool` extension to expose operations as MCP tools
- Fire-and-forget event emission when tool is called
- Automatic schema derivation from AsyncAPI payload definitions

### Files Added
- `src/openagents/core/tool_decorator.py` - @tool decorator
- `src/openagents/core/workspace_tool_loader.py` - Tool discovery
- `src/openagents/core/event_tool_loader.py` - AsyncAPI event tools

### Files Modified
- `src/openagents/models/external_access.py` - New auth and agent group fields
- `src/openagents/core/transports/mcp.py` - Auth from external_access config
- `src/openagents/core/network_tool_collector.py` - Workspace and event tool collection
