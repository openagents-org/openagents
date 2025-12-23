# [Feature] LangChain Integration

## == Overview / Objective / Timeline

**Problem:** Developers with existing LangChain/LangGraph agents cannot fully participate in OpenAgents networks. While OpenAgents exposes network tools via MCP transport (allowing LangChain agents to use tools as MCP clients), these agents cannot:
- Receive events/messages from other agents
- Be discovered by other agents
- Participate in multi-agent workflows as peers

**Goal:** Enable LangChain/LangGraph agents to become full network participants by providing:
1. `LangChainAgentRunner` - wraps AgentExecutor for network participation
2. `LangGraphAgentRunner` - wraps LangGraph apps for network participation
3. Tool adapters to inject OpenAgents network tools into LangChain agents
4. Event handling for receiving and responding to network events

**Key Decisions:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM Provider | LangChain agent keeps its own LLM | Minimal friction - users don't need to reconfigure |
| Tool Injection | Inject all mod tools by default, configurable | Maximum capability by default, opt-out for control |
| LangGraph Support | Yes, support LangGraph agents | LangGraph is the future direction of LangChain |
| Package Location | `openagents.integrations.langchain` | Separate from core agents, optional dependency |

**Timeline:** 2 PD

---

## == Functional Requirements

### 1. LangChain Agent Wrapping

**LangChainAgentRunner:**
- Wraps existing LangChain `AgentExecutor` instances
- Extends `AgentRunner` for full network participation
- Converts incoming events to LangChain input format
- Converts LangChain output to event responses
- Supports all AgentRunner lifecycle methods (`async_start`, `async_stop`)

**LangGraphAgentRunner:**
- Wraps existing LangGraph compiled apps
- Extends `AgentRunner` for full network participation
- Handles LangGraph's state-based execution model
- Supports streaming and checkpointing (if LangGraph app supports it)

### 2. Tool Injection

**Inject Network Tools:**
- Convert OpenAgents `AgentTool` to LangChain `BaseTool`
- Inject tools into LangChain agent's tool list
- Support tool filtering (whitelist/blacklist)
- Tools execute through the network connection

**Tool Adapter:**
- Converts JSON Schema to Pydantic model for `args_schema`
- Handles async execution
- Preserves tool metadata (name, description)

### 3. Event Handling

**Event Reception:**
- Inherit event loop from `AgentRunner`
- Receive direct messages from other agents
- Receive notification events (task assigned, project started, etc.)
- React to channel messages
- Respond to discovery requests

**Event Subscription:**
- Pattern-based subscription (e.g., `"task.notification.*"`)
- Option to react to all visible events
- Configurable via constructor parameter

**Event Conversion:**
- Convert `Event` objects to LangChain input strings
- Format notifications with event name and payload
- Support custom conversion functions

### 4. Network Participation

**Discovery:**
- Agent is registered with the network on start
- Agent can set capabilities for discovery
- Agent appears in agent listings

**Messaging:**
- Can send messages to other agents via injected tools
- Can receive messages and process them through LangChain agent
- Can participate in channel conversations

---

## == API Specifications

### LangChainAgentRunner

```python
from openagents.integrations.langchain import LangChainAgentRunner

runner = LangChainAgentRunner(
    # Required
    agent_id: str,                          # Unique agent identifier
    langchain_agent: AgentExecutor,         # LangChain AgentExecutor instance

    # Tool Injection (optional)
    inject_network_tools: bool = True,      # Inject all network tools
    inject_tools: List[str] = None,         # Whitelist specific tools
    exclude_tools: List[str] = None,        # Blacklist specific tools

    # Event Handling (optional)
    subscriptions: List[str] = None,        # Event patterns to subscribe to
    react_to_all_messages: bool = True,     # React to all visible events
    event_to_input: Callable = None,        # Custom event converter

    # Network Config (optional)
    capabilities: Dict[str, Any] = None,    # Agent capabilities for discovery
    agent_group: str = None,                # Agent group membership
)

# Lifecycle
await runner.async_start(host="localhost", port=8700)
await runner.async_stop()
```

### LangGraphAgentRunner

```python
from openagents.integrations.langchain import LangGraphAgentRunner

runner = LangGraphAgentRunner(
    # Required
    agent_id: str,                          # Unique agent identifier
    langgraph_app: CompiledGraph,           # LangGraph compiled app

    # State Management
    input_key: str = "messages",            # Key for input in state
    output_key: str = "messages",           # Key for output in state

    # Tool Injection (same as LangChainAgentRunner)
    inject_network_tools: bool = True,
    inject_tools: List[str] = None,
    exclude_tools: List[str] = None,

    # Event Handling (same as LangChainAgentRunner)
    subscriptions: List[str] = None,
    react_to_all_messages: bool = True,
    event_to_input: Callable = None,

    # Network Config (same as LangChainAgentRunner)
    capabilities: Dict[str, Any] = None,
    agent_group: str = None,
)
```

### OpenAgentsToolAdapter

```python
from openagents.integrations.langchain import OpenAgentsToolAdapter

# Convert single tool
langchain_tool = OpenAgentsToolAdapter(agent_tool)

# Convert multiple tools
langchain_tools = OpenAgentsToolAdapter.from_tools(agent_tools)

# With filtering
langchain_tools = OpenAgentsToolAdapter.from_tools(
    agent_tools,
    include=["send_message", "discover_agents"],
    exclude=["admin_tool"]
)
```

---

## == Data Model

### Tool Conversion

```python
# OpenAgents AgentTool
class AgentTool:
    name: str
    description: str
    input_schema: Dict[str, Any]  # JSON Schema
    func: Callable

# Converted to LangChain BaseTool
class OpenAgentsToolAdapter(BaseTool):
    name: str
    description: str
    args_schema: Type[BaseModel]  # Pydantic model from JSON Schema

    async def _arun(self, **kwargs) -> str:
        return await self._agent_tool.execute(**kwargs)
```

### Event Conversion

```python
# Default event to input conversion
def default_event_to_input(event: Event, context: EventContext) -> str:
    """Convert OpenAgents event to LangChain input string."""

    # Direct messages: extract text content
    if event.event_name == "agent.message":
        return event.payload.get("text", str(event.payload))

    # Notifications: format with event name
    if "notification" in event.event_name:
        return f"[Notification: {event.event_name}] {json.dumps(event.payload)}"

    # Channel messages: include channel context
    if event.event_name.startswith("channel."):
        channel = event.payload.get("channel_id", "unknown")
        text = event.payload.get("text", str(event.payload))
        return f"[Channel: {channel}] {text}"

    # Default: stringify payload
    return str(event.payload)
```

### Runner State

```python
class LangChainAgentRunner(AgentRunner):
    # LangChain components
    _langchain_agent: AgentExecutor
    _injected_tools: List[BaseTool]

    # Configuration
    _inject_network_tools: bool
    _tool_whitelist: Optional[List[str]]
    _tool_blacklist: Optional[List[str]]
    _event_to_input: Callable[[Event, EventContext], str]

    # Inherited from AgentRunner
    agent_id: str
    network_client: NetworkClient
    subscriptions: List[EventSubscription]
```

---

## == Module Structure

```
src/openagents/integrations/
├── __init__.py                     # Package init
└── langchain/
    ├── __init__.py                 # Exports: LangChainAgentRunner, LangGraphAgentRunner, OpenAgentsToolAdapter
    ├── runner.py                   # LangChainAgentRunner, LangGraphAgentRunner
    ├── tool_adapter.py             # OpenAgentsToolAdapter (AgentTool → BaseTool)
    └── utils.py                    # Schema conversion, event formatting, helpers
```

### File Contents

**`__init__.py`:**
```python
from openagents.integrations.langchain.runner import (
    LangChainAgentRunner,
    LangGraphAgentRunner,
)
from openagents.integrations.langchain.tool_adapter import OpenAgentsToolAdapter

__all__ = [
    "LangChainAgentRunner",
    "LangGraphAgentRunner",
    "OpenAgentsToolAdapter",
]
```

**`runner.py`:**
- `LangChainAgentRunner` class extending `AgentRunner`
- `LangGraphAgentRunner` class extending `AgentRunner`
- Event handling overrides
- Tool injection logic

**`tool_adapter.py`:**
- `OpenAgentsToolAdapter` class extending `BaseTool`
- JSON Schema to Pydantic conversion
- Batch tool conversion methods

**`utils.py`:**
- `json_schema_to_pydantic()` - Convert JSON Schema to Pydantic model
- `default_event_to_input()` - Default event converter
- `format_notification()` - Format notification events
- `filter_tools()` - Apply whitelist/blacklist to tools

---

## == Implementation Details

### Tool Injection Flow

```
1. Runner.async_start() called
2. Connect to network (inherited from AgentRunner)
3. Collect network tools via NetworkToolCollector
4. Apply tool filtering (whitelist/blacklist)
5. Convert AgentTools → LangChain BaseTools via OpenAgentsToolAdapter
6. Inject tools into LangChain agent's tool list
7. Start event loop (inherited from AgentRunner)
```

### Event Processing Flow

```
1. Event received via AgentRunner event loop
2. Check subscription patterns
3. If matched, call event_to_input() to convert event
4. Invoke LangChain agent with converted input
5. Convert LangChain output to Event response
6. Send response via network
```

### JSON Schema to Pydantic Conversion

```python
def json_schema_to_pydantic(schema: Dict[str, Any], name: str) -> Type[BaseModel]:
    """Convert JSON Schema to Pydantic model for LangChain args_schema."""

    properties = schema.get("properties", {})
    required = set(schema.get("required", []))

    fields = {}
    for prop_name, prop_schema in properties.items():
        field_type = _json_type_to_python(prop_schema.get("type", "string"))
        description = prop_schema.get("description", "")

        if prop_name in required:
            fields[prop_name] = (field_type, Field(description=description))
        else:
            fields[prop_name] = (Optional[field_type], Field(default=None, description=description))

    return create_model(name, **fields)
```

### LangGraph State Handling

```python
class LangGraphAgentRunner(AgentRunner):
    async def process_event(self, event: Event, context: EventContext):
        """Process event through LangGraph app."""

        # Convert event to input
        input_text = self._event_to_input(event, context)

        # Build initial state
        initial_state = {
            self._input_key: [HumanMessage(content=input_text)]
        }

        # Invoke LangGraph app
        result = await self._langgraph_app.ainvoke(initial_state)

        # Extract output
        output_messages = result.get(self._output_key, [])
        output_text = output_messages[-1].content if output_messages else ""

        # Send response
        await self._send_response(event, output_text)
```

---

## == Dependencies

### pyproject.toml

```toml
[project.optional-dependencies]
langchain = [
    "langchain>=0.2.0",
    "langchain-core>=0.2.0",
    "langgraph>=0.1.0",
]
```

### Import Guards

```python
# In runner.py
try:
    from langchain.agents import AgentExecutor
    from langchain_core.tools import BaseTool
    from langgraph.graph import CompiledGraph
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False

class LangChainAgentRunner(AgentRunner):
    def __init__(self, ...):
        if not LANGCHAIN_AVAILABLE:
            raise ImportError(
                "LangChain integration requires langchain packages. "
                "Install with: pip install openagents[langchain]"
            )
        ...
```

---

## == Expected Deliverables

**Core Implementation:**
- [ ] `src/openagents/integrations/__init__.py`
- [ ] `src/openagents/integrations/langchain/__init__.py`
- [ ] `src/openagents/integrations/langchain/runner.py`
- [ ] `src/openagents/integrations/langchain/tool_adapter.py`
- [ ] `src/openagents/integrations/langchain/utils.py`

**Configuration:**
- [ ] Update `pyproject.toml` with langchain optional dependency

**Tests:**
- [ ] Test LangChainAgentRunner initialization
- [ ] Test LangGraphAgentRunner initialization
- [ ] Test tool adapter conversion (AgentTool → BaseTool)
- [ ] Test JSON Schema to Pydantic conversion
- [ ] Test event to input conversion
- [ ] Test tool filtering (whitelist/blacklist)
- [ ] Test event subscription and handling
- [ ] Test network tool injection
- [ ] Integration test: LangChain agent on network

**Documentation:**
- [ ] README section on LangChain integration
- [ ] Example: LangChain agent joining network
- [ ] Example: LangGraph agent joining network

---

## == Example Usage

### Basic LangChain Agent

```python
from langchain.agents import create_react_agent, AgentExecutor
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

from openagents.integrations.langchain import LangChainAgentRunner

# Create standard LangChain agent
llm = ChatOpenAI(model="gpt-4")
prompt = ChatPromptTemplate.from_messages([...])
agent = create_react_agent(llm, tools=[], prompt=prompt)
agent_executor = AgentExecutor(agent=agent, tools=[])

# Wrap and connect to OpenAgents network
runner = LangChainAgentRunner(
    agent_id="research-agent",
    langchain_agent=agent_executor,
    inject_network_tools=True,
    capabilities={"specialization": "research", "tools": ["web_search"]},
)

await runner.async_start(host="localhost", port=8700)
```

### LangGraph Agent with Tool Selection

```python
from langgraph.graph import StateGraph
from openagents.integrations.langchain import LangGraphAgentRunner

# Create LangGraph workflow
graph = StateGraph(AgentState)
graph.add_node("agent", agent_node)
graph.add_node("tools", tool_node)
# ... configure graph
app = graph.compile()

# Wrap with selective tool injection
runner = LangGraphAgentRunner(
    agent_id="workflow-agent",
    langgraph_app=app,
    inject_network_tools=True,
    inject_tools=["send_message", "discover_agents", "delegate_task"],
    exclude_tools=["admin_tool"],
)

await runner.async_start(host="localhost", port=8700)
```

### Subscribing to Specific Events

```python
runner = LangChainAgentRunner(
    agent_id="task-worker",
    langchain_agent=agent_executor,
    # Only react to task notifications
    subscriptions=["task.notification.*"],
    react_to_all_messages=False,
)

# This agent will only receive:
# - task.notification.assigned
# - task.notification.progress
# - task.notification.completed
# - task.notification.failed
# - task.notification.timeout
```

### Custom Event Conversion

```python
def my_event_converter(event: Event, context: EventContext) -> str:
    """Custom event to input conversion."""
    if event.event_name == "task.notification.assigned":
        task_desc = event.payload.get("description", "")
        return f"You have been assigned a new task: {task_desc}. Please complete it."
    return str(event.payload)

runner = LangChainAgentRunner(
    agent_id="custom-agent",
    langchain_agent=agent_executor,
    event_to_input=my_event_converter,
)
```

### Multi-Agent Scenario

```python
# Agent 1: Coordinator (native OpenAgents)
coordinator = await create_agent(
    agent_id="coordinator",
    triggers=[
        {"event": "user.request", "instruction": "Delegate to appropriate worker"}
    ]
)

# Agent 2: Research Worker (LangChain)
research_agent = AgentExecutor(...)  # Has web search tools
research_runner = LangChainAgentRunner(
    agent_id="research-worker",
    langchain_agent=research_agent,
    subscriptions=["task.notification.assigned"],
    capabilities={"specialization": "research"},
)

# Agent 3: Code Worker (LangGraph)
code_app = graph.compile()  # LangGraph workflow with code tools
code_runner = LangGraphAgentRunner(
    agent_id="code-worker",
    langgraph_app=code_app,
    subscriptions=["task.notification.assigned"],
    capabilities={"specialization": "coding"},
)

# Start all agents
await coordinator.async_start(host="localhost", port=8700)
await research_runner.async_start(host="localhost", port=8700)
await code_runner.async_start(host="localhost", port=8700)

# Now coordinator can discover and delegate to LangChain/LangGraph agents
```

---

## == Estimates and Records

### Workstream

| Task | Estimate |
|------|----------|
| Tool adapter implementation | 0.5 PD |
| LangChainAgentRunner implementation | 0.5 PD |
| LangGraphAgentRunner implementation | 0.5 PD |
| Utils and schema conversion | 0.25 PD |
| Tests | 0.25 PD |
| **Total** | **2 PD** |

---

## == Dates

- **PRD Start:** November 29, 2025

---

## == Success Criteria

- [ ] LangChain AgentExecutor can be wrapped and connected to network
- [ ] LangGraph apps can be wrapped and connected to network
- [ ] OpenAgents tools are correctly converted to LangChain BaseTool format
- [ ] JSON Schema to Pydantic conversion handles common types
- [ ] Wrapped agents receive and process network events
- [ ] Wrapped agents can use injected network tools (messaging, discovery, etc.)
- [ ] Tool filtering (whitelist/blacklist) works correctly
- [ ] Event subscription patterns are respected
- [ ] Wrapped agents are discoverable by other agents
- [ ] Custom event converters can be provided
- [ ] Import guard shows clear error when langchain not installed
- [ ] Tests pass for all components
- [ ] Example code runs successfully

---

## == Reference Files

- [runner.py](../src/openagents/agents/runner.py) - Base AgentRunner class
- [tool.py](../src/openagents/models/tool.py) - AgentTool model
- [network_tool_collector.py](../src/openagents/core/network_tool_collector.py) - Tool collection
- [event.py](../src/openagents/models/event.py) - Event and EventSubscription models
- [mcp_server_transport_prd.md](mcp_server_transport_prd.md) - MCP tool exposure pattern
