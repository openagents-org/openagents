# [Feature] Service Agent Management in OpenAgents Studio

## == Overview / Objective / Timeline

**Problem:** Admin users have no way to manage service agents (agents defined in the network's `agents/` folder) through the Studio UI. They cannot see which agents are online, start/stop agents, or view agent logs without SSH access to the server.

**Goal:** Create a Service Agent Management page in OpenAgents Studio that allows admin users to:
1. View all service agents defined in `{workspace}/agents/`
2. See online/offline status of each agent
3. Start and stop agents directly from the UI
4. View real-time logs (stdout/stderr) for each agent

**Context:**
- Each network workspace has an `agents/` folder containing service agent definitions
- Agents can be `.yaml` files (started via `openagents agent start`) or `.py` files (started via `python`)
- Admin users already have access to kick agents; this extends that capability

**Timeline:** 2 person-days

---

## == Functional Requirements

### 1. Service Agent Discovery

**Scan `{workspace}/agents/` folder:**
- Discover all `.yaml` and `.py` agent files
- Parse agent metadata (agent_id, type) from files
- Track which agents are defined vs which are running

**Agent File Formats:**

YAML Agent (`agents/assistant.yaml`):
```yaml
type: WorkerAgent
agent_id: assistant
connection:
  host: localhost
  port: 8700
```

Python Agent (`agents/researcher.py`):
```python
# Agent with __main__ block
class ResearcherAgent(WorkerAgent):
    ...

if __name__ == "__main__":
    agent = ResearcherAgent(agent_id="researcher")
    agent.start()
```

### 2. Agent Process Management

**Start Agent:**
- For `.yaml` agents: `openagents agent start {workspace}/agents/{file}.yaml`
- For `.py` agents: `python {workspace}/agents/{file}.py`
- Capture PID for process tracking
- Redirect stdout/stderr to log capture

**Stop Agent:**
- Send SIGTERM to agent process
- Wait up to 5 seconds for graceful shutdown
- Force SIGKILL if process doesn't terminate
- Clean up process resources

**Status Tracking:**
- Monitor process status (running, stopped, crashed)
- Track start time and uptime
- Detect crashes (non-zero exit codes)

### 3. Log Capture and Streaming

**Capture Agent Logs:**
- Capture stdout and stderr from agent processes
- Store in ring buffer (last 1000 lines per agent)
- Persist recent logs to `{workspace}/logs/agents/{agent_id}.log`

**Stream Logs to UI:**
- WebSocket or polling-based log streaming
- Real-time updates as new log lines arrive
- Support for multiple simultaneous viewers

### 4. HTTP API Endpoints

**For OpenAgents Studio to control agents:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/service` | GET | List all service agents with status |
| `/api/agents/service/{agent_id}/start` | POST | Start a service agent |
| `/api/agents/service/{agent_id}/stop` | POST | Stop a service agent |
| `/api/agents/service/{agent_id}/restart` | POST | Restart a service agent |
| `/api/agents/service/{agent_id}/status` | GET | Get detailed agent status |
| `/api/agents/service/{agent_id}/logs` | GET | Get recent logs (with pagination) |
| `/api/agents/service/{agent_id}/logs/stream` | WebSocket | Stream logs in real-time |

### 5. Studio UI - Service Agent Management

**Page Location:** `/studio/agents/service` (admin-only)

**Features:**
- List all service agents with status indicators
- Start/Stop/Restart buttons for each agent
- Click to view agent details and logs
- Real-time log viewer with auto-scroll
- Filter logs by level (INFO, WARN, ERROR)

---

## == API Specifications

### GET `/api/agents/service`

**Response:**
```json
{
  "agents": [
    {
      "agent_id": "assistant",
      "file_path": "agents/assistant.yaml",
      "file_type": "yaml",
      "status": "running",
      "pid": 12345,
      "start_time": 1732428000,
      "uptime_seconds": 3600
    },
    {
      "agent_id": "researcher",
      "file_path": "agents/researcher.py",
      "file_type": "python",
      "status": "stopped",
      "pid": null,
      "start_time": null,
      "uptime_seconds": null
    }
  ]
}
```

### POST `/api/agents/service/{agent_id}/start`

**Response:**
```json
{
  "success": true,
  "message": "Agent started successfully",
  "pid": 12345
}
```

### POST `/api/agents/service/{agent_id}/stop`

**Response:**
```json
{
  "success": true,
  "message": "Agent stopped successfully"
}
```

### GET `/api/agents/service/{agent_id}/logs`

**Query Parameters:**
- `lines`: Number of lines to return (default: 100)
- `offset`: Offset from end (for pagination)
- `level`: Filter by log level (optional)

**Response:**
```json
{
  "agent_id": "assistant",
  "logs": [
    {
      "timestamp": "2025-11-27T10:23:45.123Z",
      "level": "INFO",
      "message": "Agent started successfully"
    },
    {
      "timestamp": "2025-11-27T10:23:46.456Z",
      "level": "INFO",
      "message": "Connected to network"
    }
  ],
  "total_lines": 500,
  "has_more": true
}
```

### WebSocket `/api/agents/service/{agent_id}/logs/stream`

**Message Format (server → client):**
```json
{
  "type": "log",
  "timestamp": "2025-11-27T10:23:45.123Z",
  "level": "INFO",
  "message": "Processing request..."
}
```

---

## == Data Model

### ServiceAgent

```python
@dataclass
class ServiceAgent:
    agent_id: str
    file_path: str           # Relative path from workspace
    file_type: str           # "yaml" or "python"
    status: str              # "running", "stopped", "starting", "stopping", "crashed"
    pid: Optional[int]
    process: Optional[subprocess.Popen]
    start_time: Optional[float]
    exit_code: Optional[int]
    error_message: Optional[str]
    log_buffer: List[str]    # Ring buffer of recent logs
```

### ServiceAgentManager

```python
class ServiceAgentManager:
    def __init__(self, workspace_path: Path):
        self.workspace = workspace_path
        self.agents: Dict[str, ServiceAgent] = {}

    def discover_agents(self) -> List[ServiceAgent]:
        """Scan agents/ folder for service agents."""
        pass

    async def start_agent(self, agent_id: str) -> bool:
        """Start a service agent process."""
        pass

    async def stop_agent(self, agent_id: str) -> bool:
        """Stop a service agent process."""
        pass

    def get_agent_status(self, agent_id: str) -> Dict:
        """Get detailed status for an agent."""
        pass

    def get_agent_logs(self, agent_id: str, lines: int = 100) -> List[str]:
        """Get recent logs for an agent."""
        pass
```

---

## == Storage Structure

```
{workspace}/
├── agents/
│   ├── assistant.yaml      # YAML service agent
│   ├── researcher.py       # Python service agent
│   └── analyst.yaml        # Another YAML agent
└── logs/
    └── agents/
        ├── assistant.log   # Persisted logs for assistant
        ├── researcher.log  # Persisted logs for researcher
        └── analyst.log     # Persisted logs for analyst
```

---

## == UI Mockup

### Service Agent Management Page

```
┌─────────────────────────────────────────────────────────────────┐
│ OpenAgents Studio                              [Admin: alice]   │
├─────────────────────────────────────────────────────────────────┤
│ Service Agents                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Agent          │ Type   │ Status  │ Uptime  │ Actions      │  │
│ ├────────────────────────────────────────────────────────────┤  │
│ │ 🤖 assistant   │ YAML   │ ● Online │ 2h 15m │ [Stop] [Logs]│  │
│ │ 🐍 researcher  │ Python │ ○ Offline│   -    │ [Start][Logs]│  │
│ │ 🤖 analyst     │ YAML   │ ● Online │ 45m    │ [Stop] [Logs]│  │
│ │ 🐍 monitor     │ Python │ ⚠ Crashed│   -    │ [Start][Logs]│  │
│ └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│ [Start All] [Stop All] [Refresh]                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Agent Log Viewer (Modal/Side Panel)

```
┌─────────────────────────────────────────────────────────────────┐
│ Logs: assistant                              [Auto-scroll ✓]    │
├─────────────────────────────────────────────────────────────────┤
│ Filter: [All Levels ▼]                        [Download] [Clear]│
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 10:23:45 [INFO]  Agent started successfully                     │
│ 10:23:46 [INFO]  Connected to network at localhost:8700         │
│ 10:23:47 [INFO]  Registered with network as 'assistant'         │
│ 10:23:48 [INFO]  Loading mod adapters...                        │
│ 10:23:49 [INFO]  Ready to receive events                        │
│ 10:24:15 [INFO]  Received event: user.query                     │
│ 10:24:16 [WARN]  Slow response from cache mod (1.2s)            │
│ 10:24:17 [INFO]  Sent response to user.query                    │
│ 10:25:00 [INFO]  Heartbeat: 1 active connections                │
│ ...                                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## == Access Control

### Admin-Only Access

```python
def check_admin_access(request) -> bool:
    """Verify user has admin privileges."""
    user = get_current_user(request)
    if not user:
        return False
    return user.agent_group == "admin"

@app.get("/api/agents/service")
async def list_service_agents(request: Request):
    if not check_admin_access(request):
        raise HTTPException(status_code=403, detail="Admin access required")
    # ... list agents
```

---

## == Expected Deliverables

**Backend:**
- [ ] `ServiceAgentManager` class for process management
- [ ] Agent discovery from `{workspace}/agents/` folder
- [ ] Process start/stop with stdout/stderr capture
- [ ] Log ring buffer and persistence
- [ ] HTTP API endpoints for agent control
- [ ] WebSocket endpoint for log streaming

**Frontend (Studio):**
- [ ] Service Agent Management page at `/studio/agents/service`
- [ ] Agent list with status indicators
- [ ] Start/Stop/Restart controls
- [ ] Log viewer modal with real-time updates
- [ ] Auto-refresh agent status (polling every 5 seconds)
- [ ] Admin-only access control

**Tests:**
- [ ] Test agent discovery (YAML and Python)
- [ ] Test process start/stop
- [ ] Test log capture and streaming
- [ ] Test API endpoints
- [ ] Test admin access control

---

## == Example Usage

### API Usage from Frontend

```javascript
// List all service agents
const response = await fetch('/api/agents/service');
const { agents } = await response.json();

// Start an agent
await fetch('/api/agents/service/assistant/start', { method: 'POST' });

// Stop an agent
await fetch('/api/agents/service/assistant/stop', { method: 'POST' });

// Get logs
const logsResponse = await fetch('/api/agents/service/assistant/logs?lines=100');
const { logs } = await logsResponse.json();

// Stream logs via WebSocket
const ws = new WebSocket('ws://localhost:8700/api/agents/service/assistant/logs/stream');
ws.onmessage = (event) => {
  const logEntry = JSON.parse(event.data);
  appendToLogViewer(logEntry);
};
```

---

## Estimates and Records

### Workstream

| Task                              | Estimate |
|-----------------------------------|----------|
| Backend + Frontend                | 2 PD     |
| **Total**                         | **2 PD** |

---

### == Dates

- **PRD Start:** November 27, 2025

---

## == Success Criteria

✅ All service agents in `{workspace}/agents/` are discovered and listed
✅ Agent status (running/stopped/crashed) is accurately displayed
✅ Start button launches agent process correctly (YAML and Python)
✅ Stop button terminates agent process gracefully
✅ Agent logs are captured and displayed in real-time
✅ Log viewer shows stdout and stderr combined
✅ WebSocket streaming works for live log updates
✅ Only admin users can access the management page
✅ UI updates automatically when agent status changes
✅ Crashed agents show error message and can be restarted
