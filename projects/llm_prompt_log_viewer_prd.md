# [Feature] LLM Prompt/Completion Log Viewer

## == Overview / Objective / Timeline

**Problem:** Developers have no visibility into the LLM calls made by service agents. When debugging agent behavior or optimizing prompts, there's no way to inspect what prompts were sent to the model and what completions were received.

**Goal:** Create an LLM logging system that records all prompts and completions for service agents, with a Studio UI page for developers to inspect recent LLM interactions per agent.

**Dependency:** This feature depends on the Service Agent Management feature (Issue #121) being completed first, as it extends the service agent infrastructure.

**Components:**
1. **LLM Call Logger** - Hook into LLM provider calls to log prompts/completions
2. **Log Storage** - Persist LLM logs to `{workspace}/logs/llm/{agent_id}.jsonl`
3. **HTTP API** - Endpoints to retrieve LLM logs per agent
4. **Studio UI** - Page to view and search LLM interactions

**Timeline:** 1.5 person-days

---

## == Functional Requirements

### 1. LLM Call Logging

**Capture LLM Interactions:**
- Log every call to `model_provider.chat_completion()`
- Capture input messages (prompt)
- Capture output (completion, tool calls)
- Track metadata (model, tokens, latency)

**Log Entry Data:**
```python
@dataclass
class LLMLogEntry:
    log_id: str                    # UUID for this log entry
    agent_id: str                  # Service agent that made the call
    timestamp: float               # Unix timestamp

    # Request
    model_name: str                # e.g., "gpt-4o", "claude-sonnet-4-20250514"
    provider: str                  # e.g., "openai", "anthropic"
    messages: List[Dict]           # Full messages array sent to LLM
    tools: Optional[List[Dict]]    # Tool definitions if any

    # Response
    completion: str                # Text response from LLM
    tool_calls: Optional[List[Dict]]  # Tool calls if any

    # Metadata
    latency_ms: int                # Response time in milliseconds
    input_tokens: Optional[int]    # Tokens in prompt (if available)
    output_tokens: Optional[int]   # Tokens in completion (if available)
    total_tokens: Optional[int]    # Total tokens used
    error: Optional[str]           # Error message if call failed
```

### 2. Log Storage

**File-based Storage:**
- Store logs in `{workspace}/logs/llm/{agent_id}.jsonl`
- One JSON object per line (JSONL format)
- Rotate logs when file exceeds 50MB
- Keep last 7 days of logs per agent

**Storage Structure:**
```
{workspace}/
└── logs/
    └── llm/
        ├── assistant.jsonl      # LLM logs for assistant agent
        ├── researcher.jsonl     # LLM logs for researcher agent
        └── analyst.jsonl        # LLM logs for analyst agent
```

### 3. HTTP API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/service/{agent_id}/llm-logs` | GET | Get LLM logs for an agent |
| `/api/agents/service/{agent_id}/llm-logs/{log_id}` | GET | Get single log entry details |

### 4. Studio UI - LLM Log Viewer

**Page Location:** `/studio/agents/service/{agent_id}/llm-logs`

**Features:**
- List recent LLM calls with timestamp, model, latency
- Click to expand and view full prompt/completion
- Filter by model, time range, has_error
- Search in prompt/completion content
- Show token usage statistics
- Copy prompt/completion to clipboard
- Syntax highlighting for message content

---

## == API Specifications

### GET `/api/agents/service/{agent_id}/llm-logs`

**Query Parameters:**
- `limit`: Number of entries to return (default: 50, max: 200)
- `offset`: Pagination offset
- `model`: Filter by model name
- `since`: Only entries after this timestamp
- `has_error`: Filter by error status (true/false)
- `search`: Search in messages/completion

**Response:**
```json
{
  "agent_id": "assistant",
  "logs": [
    {
      "log_id": "uuid-123",
      "timestamp": 1732428000.123,
      "model_name": "gpt-4o",
      "provider": "openai",
      "latency_ms": 1250,
      "input_tokens": 1500,
      "output_tokens": 350,
      "total_tokens": 1850,
      "has_tool_calls": true,
      "error": null,
      "preview": "You are a helpful assistant..."
    }
  ],
  "total_count": 500,
  "has_more": true
}
```

### GET `/api/agents/service/{agent_id}/llm-logs/{log_id}`

**Response:**
```json
{
  "log_id": "uuid-123",
  "agent_id": "assistant",
  "timestamp": 1732428000.123,
  "model_name": "gpt-4o",
  "provider": "openai",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant..."
    },
    {
      "role": "user",
      "content": "What is the weather today?"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get current weather",
        "parameters": {}
      }
    }
  ],
  "completion": "I'll check the weather for you.",
  "tool_calls": [
    {
      "id": "call_123",
      "name": "get_weather",
      "arguments": "{\"location\": \"San Francisco\"}"
    }
  ],
  "latency_ms": 1250,
  "input_tokens": 1500,
  "output_tokens": 350,
  "total_tokens": 1850,
  "error": null
}
```

---

## == Implementation Details

### 1. LLM Logger Hook

**Integration Point:** Wrap the `chat_completion()` call in `orchestrate_agent()` or create a logging wrapper for `BaseModelProvider`.

```python
# Option 1: Wrapper in orchestrator.py
class LLMCallLogger:
    def __init__(self, workspace_path: Path, agent_id: str):
        self.workspace = workspace_path
        self.agent_id = agent_id
        self.log_file = workspace_path / "logs" / "llm" / f"{agent_id}.jsonl"

    async def log_call(
        self,
        model_name: str,
        provider: str,
        messages: List[Dict],
        tools: Optional[List[Dict]],
        response: Dict,
        latency_ms: int,
        error: Optional[str] = None
    ):
        """Log an LLM call to the agent's log file."""
        entry = {
            "log_id": str(uuid.uuid4()),
            "agent_id": self.agent_id,
            "timestamp": time.time(),
            "model_name": model_name,
            "provider": provider,
            "messages": messages,
            "tools": tools,
            "completion": response.get("content", ""),
            "tool_calls": response.get("tool_calls"),
            "latency_ms": latency_ms,
            "input_tokens": response.get("usage", {}).get("prompt_tokens"),
            "output_tokens": response.get("usage", {}).get("completion_tokens"),
            "total_tokens": response.get("usage", {}).get("total_tokens"),
            "error": error
        }

        # Append to log file
        self.log_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.log_file, "a") as f:
            f.write(json.dumps(entry) + "\n")
```

### 2. Token Counting

**Provider-Specific Token Info:**
- OpenAI: Returns `usage` in response
- Anthropic: Returns `usage` in response
- Others: May need to estimate or skip

```python
# Extract tokens from provider response
def extract_token_usage(provider: str, raw_response: Any) -> Dict:
    """Extract token usage from provider-specific response."""
    if provider == "openai":
        usage = raw_response.usage
        return {
            "input_tokens": usage.prompt_tokens,
            "output_tokens": usage.completion_tokens,
            "total_tokens": usage.total_tokens
        }
    elif provider == "anthropic":
        return {
            "input_tokens": raw_response.usage.input_tokens,
            "output_tokens": raw_response.usage.output_tokens,
            "total_tokens": raw_response.usage.input_tokens + raw_response.usage.output_tokens
        }
    return {}
```

### 3. Log Reader

```python
class LLMLogReader:
    def __init__(self, workspace_path: Path):
        self.workspace = workspace_path

    def get_logs(
        self,
        agent_id: str,
        limit: int = 50,
        offset: int = 0,
        model: Optional[str] = None,
        since: Optional[float] = None,
        has_error: Optional[bool] = None,
        search: Optional[str] = None
    ) -> Tuple[List[Dict], int]:
        """Read and filter LLM logs for an agent."""
        log_file = self.workspace / "logs" / "llm" / f"{agent_id}.jsonl"

        if not log_file.exists():
            return [], 0

        # Read all entries (in production, use more efficient approach)
        entries = []
        with open(log_file) as f:
            for line in f:
                entry = json.loads(line)

                # Apply filters
                if model and entry["model_name"] != model:
                    continue
                if since and entry["timestamp"] < since:
                    continue
                if has_error is not None:
                    if has_error and not entry.get("error"):
                        continue
                    if not has_error and entry.get("error"):
                        continue
                if search:
                    # Search in messages and completion
                    text = json.dumps(entry["messages"]) + entry.get("completion", "")
                    if search.lower() not in text.lower():
                        continue

                entries.append(entry)

        # Sort by timestamp descending (most recent first)
        entries.sort(key=lambda x: x["timestamp"], reverse=True)

        total = len(entries)
        entries = entries[offset:offset + limit]

        return entries, total
```

---

## == UI Mockup

### LLM Log Viewer Page

```
┌─────────────────────────────────────────────────────────────────┐
│ OpenAgents Studio                              [Admin: alice]   │
├─────────────────────────────────────────────────────────────────┤
│ Service Agents > assistant > LLM Logs                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Filters:                                                         │
│ Model: [All Models ▼]  Time: [Last 1 hour ▼]  [Search...]       │
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Time       │ Model    │ Tokens │ Latency │ Status          │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ 10:45:23   │ gpt-4o   │ 1,850  │ 1.25s   │ ✓ Tool calls    │  │
│ │ 10:44:15   │ gpt-4o   │ 2,100  │ 2.10s   │ ✓ Completed     │  │
│ │ 10:43:02   │ gpt-4o   │ 950    │ 0.85s   │ ✓ Completed     │  │
│ │ 10:42:30   │ gpt-4o   │ 1,200  │ 1.50s   │ ✗ Error         │  │
│ │ 10:41:55   │ gpt-4o   │ 1,750  │ 1.90s   │ ✓ Tool calls    │  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ Showing 1-50 of 234 entries        [< Prev] [Next >]            │
│                                                                  │
│ ┌─ Log Entry Details ────────────────────────────────────────┐  │
│ │ Log ID: uuid-123-456                                       │  │
│ │ Time: 2025-11-27 10:45:23.123                             │  │
│ │ Model: gpt-4o (openai)                                     │  │
│ │ Tokens: 1,500 in / 350 out / 1,850 total                  │  │
│ │ Latency: 1,250ms                                           │  │
│ │                                                            │  │
│ │ ┌─ Messages ─────────────────────────────────────────────┐ │  │
│ │ │ [system]                                               │ │  │
│ │ │ You are a helpful assistant that can answer questions │ │  │
│ │ │ and help with tasks.                                   │ │  │
│ │ │                                                        │ │  │
│ │ │ [user]                                                 │ │  │
│ │ │ What is the weather in San Francisco?                  │ │  │
│ │ └────────────────────────────────────────────[Copy]──────┘ │  │
│ │                                                            │  │
│ │ ┌─ Completion ───────────────────────────────────────────┐ │  │
│ │ │ I'll check the weather for you.                        │ │  │
│ │ │                                                        │ │  │
│ │ │ [Tool Call: get_weather]                               │ │  │
│ │ │ {"location": "San Francisco"}                          │ │  │
│ │ └────────────────────────────────────────────[Copy]──────┘ │  │
│ └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## == Access Control

### Admin-Only Access

LLM logs may contain sensitive information (API keys in errors, user data in prompts). Access is restricted to admin users only.

```python
@app.get("/api/agents/service/{agent_id}/llm-logs")
async def get_llm_logs(agent_id: str, request: Request):
    if not check_admin_access(request):
        raise HTTPException(status_code=403, detail="Admin access required")
    # ... return logs
```

---

## == Expected Deliverables

**Backend:**
- [ ] `LLMCallLogger` class for logging LLM calls
- [ ] Integration with `orchestrate_agent()` to capture calls
- [ ] Token extraction from provider responses
- [ ] `LLMLogReader` class for reading/filtering logs
- [ ] HTTP API endpoints for log retrieval
- [ ] Log rotation logic

**Frontend (Studio):**
- [ ] LLM Log Viewer page at `/studio/agents/service/{agent_id}/llm-logs`
- [ ] Log list with sorting and pagination
- [ ] Filter controls (model, time, error status)
- [ ] Search functionality
- [ ] Expandable log details view
- [ ] Copy to clipboard for messages/completion
- [ ] Token usage display

**Tests:**
- [ ] Test LLM call logging
- [ ] Test log reading with filters
- [ ] Test pagination
- [ ] Test search functionality
- [ ] Test admin access control

---

## == Example Usage

### Accessing LLM Logs from Studio

```javascript
// List recent LLM logs for an agent
const response = await fetch('/api/agents/service/assistant/llm-logs?limit=50');
const { logs, total_count } = await response.json();

// Get details for a specific log entry
const detailResponse = await fetch('/api/agents/service/assistant/llm-logs/uuid-123');
const logEntry = await detailResponse.json();

// Filter by model and search
const filteredResponse = await fetch(
  '/api/agents/service/assistant/llm-logs?model=gpt-4o&search=weather'
);
```

---

## Estimates and Records

### Workstream

| Task                              | Estimate |
|-----------------------------------|----------|
| Backend (Logger, Reader, API)     | 1 PD     |
| Frontend (Studio UI)              | 0.5 PD   |
| **Total**                         | **1.5 PD** |

---

### == Dates

- **PRD Start:** November 27, 2025
- **Dependency:** Service Agent Management (Issue #121)

---

## == Success Criteria

✅ All LLM calls from service agents are logged to JSONL files
✅ Log entries include full messages, completion, tool calls, and metadata
✅ Token usage is captured from provider responses (when available)
✅ Latency is accurately measured for each call
✅ Logs can be filtered by model, time range, and error status
✅ Search works across prompt and completion content
✅ Studio UI displays logs with expandable details
✅ Copy to clipboard works for messages and completions
✅ Only admin users can access LLM logs
✅ Log rotation prevents unbounded file growth
