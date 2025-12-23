# [Feature] Task Delegation Mod

## == Overview / Objective / Timeline

**Problem:** Agents need a standardized way to delegate tasks to other agents and track task completion. Currently, the research team demo uses custom events (`task.delegate`, `task.complete`) via the default workspace mod's `send_event` tool, but there's no dedicated mod with proper task tracking, status management, and timeout handling.

**Goal:** Create `openagents.mods.coordination.task_delegation` - a mod that provides structured task delegation between agents with status tracking and timeout support.

**Key Features:**
- Delegate tasks to specific agents
- Track task status (pending, in_progress, completed, failed, timed_out)
- Auto-timeout for tasks that take too long
- Query delegated and assigned tasks
- Notifications for task lifecycle events

**Timeline:** 1 person-day

---

## == Functional Requirements

### 1. Task Delegation

**Delegate Task:**
- Delegator specifies assignee agent, description, and payload
- Optional timeout (default: 300 seconds)
- Task is created with `pending` status
- Assignee receives notification of new task

**Complete Task:**
- Assignee marks task as completed with result data
- Status changes to `completed`
- Delegator receives notification

**Fail Task:**
- Assignee marks task as failed with error message
- Status changes to `failed`
- Delegator receives notification

### 2. Task Status Tracking

**Status Lifecycle:**
```
in_progress → completed
           → failed
           → timed_out (auto)
```

**Status Definitions:**
- `in_progress` - Task delegated and assignee is working on it
- `completed` - Task finished successfully with results
- `failed` - Task failed with error
- `timed_out` - Task exceeded timeout duration

**Note:** Tasks start immediately in `in_progress` status when delegated (no pending state).

### 3. Progress Reporting

**Report Progress:**
- Assignee can report intermediate progress
- Delegator receives notification of progress updates
- Progress is stored as array of updates on the task

### 4. Task Timeout

**Auto-Timeout:**
- Each task has a configurable timeout (default 300 seconds)
- Background process checks for expired tasks
- Expired tasks automatically set to `timed_out`
- Both delegator and assignee receive timeout notification

### 5. Query Tasks

**List Tasks:**
- Filter by role: `delegated_by_me` or `assigned_to_me`
- Filter by status: in_progress, completed, failed, timed_out
- Pagination support

**Get Task Details:**
- Full task information by task_id

---

## == Event System

### Operation Events

| Event Name | Description | Payload |
|------------|-------------|---------|
| `task.delegate` | Delegate task to agent | assignee_id, description, payload, timeout_seconds |
| `task.report` | Report intermediate progress | task_id, progress |
| `task.complete` | Complete task with results | task_id, result |
| `task.fail` | Fail task with error | task_id, error |
| `task.list` | List tasks | filter (role, status), limit, offset |
| `task.get` | Get task details | task_id |

### Response Events

Each operation has a `.response` event with:
- `success`: boolean
- `message`: string
- `data`: operation-specific data

### Notification Events

| Event Name | Description | Payload |
|------------|-------------|---------|
| `task.notification.assigned` | New task assigned | task_id, delegator_id, description |
| `task.notification.progress` | Progress reported | task_id, assignee_id, progress |
| `task.notification.completed` | Task completed | task_id, assignee_id, result |
| `task.notification.failed` | Task failed | task_id, assignee_id, error |
| `task.notification.timeout` | Task timed out | task_id, delegator_id, assignee_id |

---

## == API Specifications

### task.delegate

**Request Payload:**
```json
{
  "assignee_id": "agent_bob",
  "description": "Search for information about AI trends",
  "payload": {
    "query": "AI trends 2025",
    "sources": ["web", "news"]
  },
  "timeout_seconds": 300
}
```

**Response:**
```json
{
  "success": true,
  "message": "Task delegated successfully",
  "data": {
    "task_id": "task-uuid-123",
    "status": "pending",
    "created_at": 1732428000.123
  }
}
```

### task.report

**Request Payload:**
```json
{
  "task_id": "task-uuid-123",
  "progress": {
    "message": "Searching web sources...",
    "data": {"sources_checked": 3}
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Progress reported",
  "data": {
    "task_id": "task-uuid-123",
    "progress_count": 2
  }
}
```

### task.complete

**Request Payload:**
```json
{
  "task_id": "task-uuid-123",
  "result": {
    "findings": ["Finding 1", "Finding 2"],
    "summary": "AI is advancing rapidly..."
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Task completed successfully",
  "data": {
    "task_id": "task-uuid-123",
    "status": "completed",
    "completed_at": 1732428300.456
  }
}
```

### task.list

**Request Payload:**
```json
{
  "filter": {
    "role": "assigned_to_me",
    "status": ["pending", "in_progress"]
  },
  "limit": 20,
  "offset": 0
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "task_id": "task-uuid-123",
        "delegator_id": "agent_alice",
        "assignee_id": "agent_bob",
        "description": "Search for AI trends",
        "status": "pending",
        "timeout_seconds": 300,
        "created_at": 1732428000.123
      }
    ],
    "total_count": 5,
    "has_more": false
  }
}
```

### task.get

**Request Payload:**
```json
{
  "task_id": "task-uuid-123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "task_id": "task-uuid-123",
    "delegator_id": "agent_alice",
    "assignee_id": "agent_bob",
    "description": "Search for AI trends",
    "payload": {
      "query": "AI trends 2025",
      "sources": ["web", "news"]
    },
    "status": "completed",
    "timeout_seconds": 300,
    "created_at": 1732428000.123,
    "started_at": 1732428010.000,
    "completed_at": 1732428300.456,
    "result": {
      "findings": ["Finding 1", "Finding 2"],
      "summary": "AI is advancing rapidly..."
    },
    "error": null
  }
}
```

---

## == Data Model

### Task

```python
@dataclass
class Task:
    task_id: str                    # UUID
    delegator_id: str               # Agent who delegated
    assignee_id: str                # Agent assigned to
    description: str                # Task description
    payload: Dict[str, Any]         # Task data/parameters
    status: str                     # in_progress, completed, failed, timed_out
    timeout_seconds: int            # Timeout duration (default 300)
    created_at: float               # Creation timestamp (task starts immediately)
    completed_at: Optional[float]   # When task finished
    progress_reports: List[Dict]    # Array of progress updates
    result: Optional[Dict[str, Any]] # Result data on completion
    error: Optional[str]            # Error message on failure

@dataclass
class ProgressReport:
    timestamp: float                # When progress was reported
    message: str                    # Progress message
    data: Optional[Dict[str, Any]]  # Optional progress data
```

---

## == Storage Structure

```
{workspace}/
└── coordination/
    └── tasks/
        ├── task-uuid-123.json
        ├── task-uuid-456.json
        └── ...
```

### Task File Format

```json
{
  "task_id": "task-uuid-123",
  "delegator_id": "agent_alice",
  "assignee_id": "agent_bob",
  "description": "Search for AI trends",
  "payload": {"query": "AI trends 2025"},
  "status": "completed",
  "timeout_seconds": 300,
  "created_at": 1732428000.123,
  "completed_at": 1732428300.456,
  "progress_reports": [
    {"timestamp": 1732428100.0, "message": "Searching web sources...", "data": null},
    {"timestamp": 1732428200.0, "message": "Found 5 relevant articles", "data": {"count": 5}}
  ],
  "result": {"findings": ["..."]},
  "error": null
}
```

---

## == Module Structure

```
src/openagents/mods/coordination/
└── task_delegation/
    ├── __init__.py
    ├── mod.py              # TaskDelegationMod (network-level)
    ├── adapter.py          # TaskDelegationAdapter (agent-level)
    ├── eventdef.yaml       # AsyncAPI 3.0 event definitions
    └── mod_manifest.json   # Mod metadata
```

---

## == Implementation Details

### Timeout Background Task

```python
class TaskDelegationMod(BaseMod):
    async def _check_timeouts(self):
        """Background task to check for timed-out tasks."""
        while True:
            await asyncio.sleep(10)  # Check every 10 seconds

            current_time = time.time()
            for task in self._get_active_tasks():
                if task.status in ("pending", "in_progress"):
                    elapsed = current_time - task.created_at
                    if elapsed > task.timeout_seconds:
                        await self._timeout_task(task)

    async def _timeout_task(self, task: Task):
        """Mark task as timed out and notify parties."""
        task.status = "timed_out"
        task.completed_at = time.time()
        self._save_task(task)

        # Notify delegator
        await self._send_notification(
            "task.notification.timeout",
            task.delegator_id,
            {"task_id": task.task_id, ...}
        )

        # Notify assignee
        await self._send_notification(
            "task.notification.timeout",
            task.assignee_id,
            {"task_id": task.task_id, ...}
        )
```

### Access Control

**Task Operations:**
- `task.delegate`: Any agent can delegate
- `task.report`: Only assignee can report progress on their task
- `task.complete`: Only assignee can complete their task
- `task.fail`: Only assignee can fail their task
- `task.list`: Agent sees tasks they delegated or are assigned to
- `task.get`: Agent can view tasks they're involved in (delegator or assignee)

---

## == Expected Deliverables

**Backend:**
- [ ] `src/openagents/mods/coordination/__init__.py`
- [ ] `src/openagents/mods/coordination/task_delegation/__init__.py`
- [ ] `src/openagents/mods/coordination/task_delegation/mod.py`
- [ ] `src/openagents/mods/coordination/task_delegation/adapter.py`
- [ ] `src/openagents/mods/coordination/task_delegation/eventdef.yaml`
- [ ] `src/openagents/mods/coordination/task_delegation/mod_manifest.json`
- [ ] Timeout background task
- [ ] Task persistence to workspace storage

**Tests:**
- [ ] Test task delegation
- [ ] Test progress reporting
- [ ] Test task completion
- [ ] Test task failure
- [ ] Test task timeout
- [ ] Test task listing and filtering
- [ ] Test access control (only assignee can report/complete/fail)
- [ ] Test notifications

---

## == Example Usage

### Agent Adapter Usage

```python
from openagents.mods.coordination.task_delegation import TaskDelegationAdapter

# Get task delegation adapter
tasks = agent.get_mod_adapter("task_delegation")

# Delegate a task
response = await tasks.delegate(
    assignee_id="web-searcher",
    description="Search for AI trends",
    payload={"query": "AI trends 2025"},
    timeout_seconds=300
)
task_id = response.data["task_id"]

# List my delegated tasks
my_tasks = await tasks.list_tasks(
    role="delegated_by_me",
    status=["in_progress"]
)

# As assignee - report progress and complete task
await tasks.report(
    task_id=task_id,
    progress={"message": "Searching web sources...", "data": None}
)
await tasks.complete(
    task_id=task_id,
    result={"findings": ["Finding 1", "Finding 2"]}
)

# Or fail the task
await tasks.fail(
    task_id=task_id,
    error="Unable to complete search"
)
```

### Event-Based Usage

```python
from openagents.models.event import Event

# Delegate task
event = Event(
    event_name="task.delegate",
    source_id="router",
    payload={
        "assignee_id": "web-searcher",
        "description": "Search for AI trends",
        "payload": {"query": "AI trends 2025"},
        "timeout_seconds": 300
    }
)
response = await agent.send_event(event)
```

---

## Estimates and Records

### Workstream

| Task                              | Estimate |
|-----------------------------------|----------|
| Backend (Mod + Adapter)           | 1 PD     |
| **Total**                         | **1 PD** |

---

### == Dates

- **PRD Start:** November 27, 2025

---

## == Success Criteria

✅ Agents can delegate tasks to other agents
✅ Tasks start immediately in `in_progress` status when delegated
✅ Tasks have proper status lifecycle (in_progress → completed/failed/timed_out)
✅ Assignees can report intermediate progress
✅ Tasks automatically timeout after configured duration
✅ Assignees receive notification when task is delegated
✅ Delegators receive notification when progress is reported
✅ Delegators receive notification when task is completed/failed/timed_out
✅ Agents can list and filter their tasks
✅ Only assignee can report/complete/fail their assigned tasks
✅ Tasks persist to workspace storage
✅ Background timeout checker runs reliably
