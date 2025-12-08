# LLM Logs Monitoring: Centralized Prompt and Response Logging

## Overview

OpenAgents now provides built-in LLM (Language Model) call logging, enabling you to monitor all prompts, completions, token usage, and latency metrics from your agents. Logs are stored centrally in the workspace and accessible via both the HTTP API and Studio dashboard.

## Architecture

### Two Logging Modes

OpenAgents supports two logging mechanisms to handle different deployment scenarios:

| Mode | Use Case | How It Works |
|------|----------|--------------|
| **File-based** | Network-embedded agents | Writes directly to workspace JSONL files |
| **Event-based** | External/remote agents | Sends logs via system events to the network |

### Event-Based Logging Flow

For external agents that connect to the network remotely:

```
External Agent → orchestrate_agent()
                      ↓
               EventBasedLLMLogger
                      ↓
               system.report_llm_log event
                      ↓
               Network (SystemCommandHandler)
                      ↓
               LLMCallLogger._write_log_entry()
                      ↓
               workspace/logs/llm/{agent_id}.jsonl
```

This design ensures all agents, regardless of where they run, can report their LLM usage to the network for centralized monitoring.

## Log Entry Structure

Each LLM call creates a `LLMLogEntry` with the following fields:

```python
@dataclass
class LLMLogEntry:
    log_id: str              # Unique identifier (UUID)
    agent_id: str            # ID of the agent making the call
    timestamp: float         # Unix timestamp
    model_name: str          # Model used (e.g., "gpt-4o", "claude-3-opus")
    provider: str            # Provider name (openai, anthropic, bedrock, etc.)
    messages: List[Dict]     # Messages sent to the LLM
    tools: Optional[List]    # Tool definitions if any
    completion: str          # Response content
    tool_calls: Optional[List]  # Tool calls in response
    latency_ms: int          # Response time in milliseconds
    input_tokens: Optional[int]
    output_tokens: Optional[int]
    total_tokens: Optional[int]
    error: Optional[str]     # Error message if call failed
```

## HTTP API Endpoints

### List Logs for an Agent

```http
GET /api/agents/service/{agent_id}/llm-logs
```

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | int | Max entries to return (default: 50, max: 500) |
| `offset` | int | Pagination offset |
| `model` | string | Filter by model name |
| `since` | float | Filter by timestamp (Unix epoch) |
| `has_error` | bool | Filter by error status |
| `search` | string | Search in messages and completions |

**Response:**

```json
{
  "agent_id": "my_agent",
  "logs": [
    {
      "log_id": "550e8400-e29b-41d4-a716-446655440000",
      "agent_id": "my_agent",
      "timestamp": 1733673600.123,
      "model_name": "gpt-4o",
      "provider": "openai",
      "messages": [...],
      "completion": "Here's the response...",
      "latency_ms": 1234,
      "input_tokens": 150,
      "output_tokens": 50,
      "total_tokens": 200,
      "error": null
    }
  ],
  "total_count": 100,
  "has_more": true
}
```

### Get Single Log Entry

```http
GET /api/agents/service/{agent_id}/llm-logs/{log_id}
```

**Response:**

```json
{
  "log_id": "550e8400-e29b-41d4-a716-446655440000",
  "agent_id": "my_agent",
  "timestamp": 1733673600.123,
  "model_name": "gpt-4o",
  "provider": "openai",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is the weather?"}
  ],
  "completion": "I don't have access to real-time weather data...",
  "tool_calls": null,
  "latency_ms": 1234,
  "input_tokens": 150,
  "output_tokens": 50,
  "total_tokens": 200,
  "error": null
}
```

## Log Storage

### File Location

Logs are stored in the workspace directory:

```
workspace/
└── logs/
    └── llm/
        ├── agent_one.jsonl
        ├── agent_two.jsonl
        └── agent_one_20251208_120000.jsonl  # Rotated file
```

### Log Rotation

- **Size-based rotation**: Files rotate at 50MB
- **Retention**: Logs older than 7 days are automatically cleaned up
- **Format**: Each file uses JSONL (one JSON object per line)

### Constants

```python
MAX_LOG_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50MB
LOG_RETENTION_DAYS = 7
```

## Usage

### For Agent Developers

LLM logging is automatic when using `orchestrate_agent()` with an `AgentClient`:

```python
from openagents.agents.orchestrator import orchestrate_agent

# The agent_client enables event-based logging
trajectory = await orchestrate_agent(
    context=context,
    agent_config=agent_config,
    tools=tools,
    agent_id="my_agent",
    agent_client=self._network_client,  # Enables logging
)
```

### For Network Operators

Logs are available via:

1. **HTTP API**: Query programmatically
2. **Studio Dashboard**: View in the LLM Logs section
3. **Direct File Access**: Read JSONL files in `workspace/logs/llm/`

## System Event

External agents report logs using the `system.report_llm_log` event:

```python
from openagents.models.event import Event

event = Event(
    event_name="system.report_llm_log",
    source_id="my_agent",
    destination_id="system:system",
    payload={
        "agent_id": "my_agent",
        "log_entry": {
            "log_id": "...",
            "model_name": "gpt-4o",
            "provider": "openai",
            "messages": [...],
            "completion": "...",
            "latency_ms": 1234,
            # ... other fields
        }
    }
)
```

## Supported Providers

Token usage extraction is supported for:

- **OpenAI** (including Azure OpenAI)
- **Anthropic**
- **AWS Bedrock**
- **Google Gemini**
- **Other providers** (generic extraction attempted)

## Configuration

LLM logging requires:

1. **Workspace configured**: The network must have a workspace path
2. **AgentClient connected**: Agents must be connected to the network

No additional configuration is needed - logging is enabled by default.

## Error Handling

- Failed LLM calls are logged with the `error` field populated
- Log write failures are logged as warnings but don't interrupt agent operation
- Event delivery failures are logged but don't block the agent

## Related Documentation

- [Agent Orchestration Guide](https://openagents.org/docs/orchestration)
- [HTTP API Reference](https://openagents.org/docs/api)
- [Studio User Guide](https://openagents.org/docs/studio)
