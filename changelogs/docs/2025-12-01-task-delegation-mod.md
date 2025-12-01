# Task Delegation Mod

## Overview

The Task Delegation mod (`openagents.mods.coordination.task_delegation`) provides structured task delegation between agents with status tracking, timeout support, and lifecycle notifications. It enables agents to delegate work to other agents and track task completion.

## Features

| Capability | Description |
|------------|-------------|
| Task Delegation | Delegate tasks with description, payload, and timeout |
| Status Tracking | Track status: in_progress, completed, failed, timed_out |
| Progress Reporting | Assignees report intermediate progress |
| Auto-Timeout | Tasks automatically timeout after configured duration |
| Access Control | Only assignees can complete/fail their tasks |
| Notifications | Lifecycle events sent to all parties |
| Persistence | Tasks persist to workspace storage as JSON |

## Installation

### Enable in Network Configuration

```yaml
# network.yaml
network:
  name: my_network
  mode: centralized

mods:
  - path: openagents.mods.coordination.task_delegation
    config:
      timeout_check_interval: 10  # seconds
```

### Dynamic Loading

```python
await network.load_mod(
    "openagents.mods.coordination.task_delegation",
    config={
        "timeout_check_interval": 10
    }
)
```

## Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `timeout_check_interval` | `10` | Interval (seconds) for checking task timeouts |

## Agent Tools

The adapter provides these tools to agents:

### delegate_task

Delegate a task to another agent.

```python
result = await agent.use_tool("delegate_task", {
    "assignee_id": "web-searcher",
    "description": "Search for AI trends",
    "payload": {"query": "AI trends 2025"},
    "timeout_seconds": 300
})
```

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `assignee_id` | string | Yes | - | Agent ID to assign task to |
| `description` | string | Yes | - | Task description |
| `payload` | object | No | `{}` | Task data/parameters |
| `timeout_seconds` | integer | No | `300` | Timeout in seconds |

**Returns:**
```json
{
  "success": true,
  "message": "Task delegated successfully",
  "data": {
    "task_id": "task-uuid-123",
    "status": "in_progress",
    "created_at": 1732428000.123
  }
}
```

### report_task_progress

Report progress on an assigned task.

```python
result = await agent.use_tool("report_task_progress", {
    "task_id": "task-uuid-123",
    "message": "Searching web sources...",
    "data": {"sources_checked": 3}
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | Task ID |
| `message` | string | Yes | Progress message |
| `data` | object | No | Optional progress data |

**Returns:**
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

### complete_task

Complete a task with results.

```python
result = await agent.use_tool("complete_task", {
    "task_id": "task-uuid-123",
    "result": {
        "findings": ["Finding 1", "Finding 2"],
        "summary": "AI is advancing rapidly..."
    }
})
```

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `task_id` | string | Yes | - | Task ID |
| `result` | object | No | `{}` | Result data |

**Returns:**
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

### fail_task

Mark a task as failed.

```python
result = await agent.use_tool("fail_task", {
    "task_id": "task-uuid-123",
    "error": "Unable to complete search - network error"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | Task ID |
| `error` | string | Yes | Error message |

**Returns:**
```json
{
  "success": true,
  "message": "Task marked as failed",
  "data": {
    "task_id": "task-uuid-123",
    "status": "failed",
    "completed_at": 1732428300.456
  }
}
```

### list_tasks

List tasks with filters.

```python
result = await agent.use_tool("list_tasks", {
    "role": "delegated_by_me",
    "status": ["in_progress"],
    "limit": 20,
    "offset": 0
})
```

**Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `role` | string | No | `delegated_by_me` | `delegated_by_me` or `assigned_to_me` |
| `status` | array | No | `[]` | Filter by status |
| `limit` | integer | No | `20` | Max results |
| `offset` | integer | No | `0` | Pagination offset |

**Returns:**
```json
{
  "success": true,
  "message": "Tasks retrieved",
  "data": {
    "tasks": [
      {
        "task_id": "task-uuid-123",
        "delegator_id": "coordinator",
        "assignee_id": "web-searcher",
        "description": "Search for AI trends",
        "status": "in_progress",
        "timeout_seconds": 300,
        "created_at": 1732428000.123
      }
    ],
    "total_count": 5,
    "has_more": false
  }
}
```

### get_task

Get full task details.

```python
result = await agent.use_tool("get_task", {
    "task_id": "task-uuid-123"
})
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | Yes | Task ID |

**Returns:**
```json
{
  "success": true,
  "message": "Task retrieved",
  "data": {
    "task_id": "task-uuid-123",
    "delegator_id": "coordinator",
    "assignee_id": "web-searcher",
    "description": "Search for AI trends",
    "payload": {"query": "AI trends 2025"},
    "status": "completed",
    "timeout_seconds": 300,
    "created_at": 1732428000.123,
    "completed_at": 1732428300.456,
    "progress_reports": [
      {"timestamp": 1732428100.0, "message": "Searching...", "data": null}
    ],
    "result": {"findings": ["..."]},
    "error": null
  }
}
```

## Events

### Operation Events

| Event Name | Description |
|------------|-------------|
| `task.delegate` | Delegate task to agent |
| `task.report` | Report task progress |
| `task.complete` | Complete task |
| `task.fail` | Fail task |
| `task.list` | List tasks |
| `task.get` | Get task details |

### Notification Events

| Event Name | Recipient | Description |
|------------|-----------|-------------|
| `task.notification.assigned` | Assignee | New task assigned |
| `task.notification.progress` | Delegator | Progress reported |
| `task.notification.completed` | Delegator | Task completed |
| `task.notification.failed` | Delegator | Task failed |
| `task.notification.timeout` | Both | Task timed out |

### Event Payload Examples

**Task Assigned Notification:**
```json
{
  "event_name": "task.notification.assigned",
  "destination_id": "web-searcher",
  "payload": {
    "task_id": "task-uuid-123",
    "delegator_id": "coordinator",
    "description": "Search for AI trends",
    "payload": {"query": "AI trends 2025"},
    "timeout_seconds": 300
  }
}
```

**Task Completed Notification:**
```json
{
  "event_name": "task.notification.completed",
  "destination_id": "coordinator",
  "payload": {
    "task_id": "task-uuid-123",
    "assignee_id": "web-searcher",
    "result": {"findings": ["..."]}
  }
}
```

## Status Lifecycle

Tasks follow this status lifecycle:

```
in_progress → completed   (success)
            → failed      (error)
            → timed_out   (auto)
```

Tasks start immediately in `in_progress` status when delegated.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenAgents Network                        │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           TaskDelegationMod (Network)                │    │
│  │  • Task storage and persistence                      │    │
│  │  • Event handlers                                    │    │
│  │  • Timeout checker (background task)                 │    │
│  │  • Notification routing                              │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                               ▲
                               │ Events
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      AI Agents                               │
│  ┌─────────────────────┐  ┌─────────────────────┐           │
│  │ TaskDelegationAdapter│  │ TaskDelegationAdapter│          │
│  │   (Delegator)        │  │   (Assignee)         │          │
│  │                      │  │                      │          │
│  │  • delegate_task     │  │  • report_progress   │          │
│  │  • list_tasks        │  │  • complete_task     │          │
│  │  • get_task          │  │  • fail_task         │          │
│  └─────────────────────┘  └─────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### Components

**TaskDelegationMod** (Network-side)
- Manages all task state
- Handles task events
- Runs timeout checker background task
- Persists tasks to JSON files
- Routes notifications to agents

**TaskDelegationAdapter** (Agent-side)
- One instance per agent
- Provides tool implementations
- Handles notifications

## Example: Coordinator Agent

```python
from openagents.agents import WorkerAgent

class CoordinatorAgent(WorkerAgent):
    default_agent_id = "coordinator"

    async def on_startup(self):
        tasks = self.get_mod_adapter("task_delegation")
        
        # Delegate research to specialist
        response = await tasks.delegate_task(
            assignee_id="researcher",
            description="Research quantum computing trends",
            payload={"focus": "practical applications"},
            timeout_seconds=600
        )
        
        task_id = response["data"]["task_id"]
        print(f"Delegated task: {task_id}")

    @on_event("task.notification.completed")
    async def on_task_completed(self, event):
        result = event.payload.get("result", {})
        print(f"Task completed with: {result}")
```

## Example: Worker Agent

```python
from openagents.agents import WorkerAgent

class ResearcherAgent(WorkerAgent):
    default_agent_id = "researcher"

    @on_event("task.notification.assigned")
    async def on_task_assigned(self, event):
        tasks = self.get_mod_adapter("task_delegation")
        task_id = event.payload.get("task_id")
        description = event.payload.get("description")
        
        # Report progress
        await tasks.report_progress(
            task_id=task_id,
            message="Starting research..."
        )
        
        # Do the work...
        result = await self.do_research(description)
        
        # Complete the task
        await tasks.complete_task(
            task_id=task_id,
            result=result
        )
```

## Storage

Tasks are persisted to the workspace storage directory:

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
  "delegator_id": "coordinator",
  "assignee_id": "researcher",
  "description": "Research quantum computing",
  "payload": {"focus": "practical applications"},
  "status": "completed",
  "timeout_seconds": 600,
  "created_at": 1732428000.123,
  "completed_at": 1732428500.456,
  "progress_reports": [
    {"timestamp": 1732428100.0, "message": "Starting...", "data": null}
  ],
  "result": {"findings": ["..."]},
  "error": null
}
```

## Access Control

The mod enforces these access control rules:

| Action | Who Can Perform |
|--------|-----------------|
| Delegate task | Any agent |
| Report progress | Assignee only |
| Complete task | Assignee only |
| Fail task | Assignee only |
| List tasks | Delegator sees their delegated tasks; Assignee sees their assigned tasks |
| Get task | Delegator or assignee only |

## Troubleshooting

### "Only assignee can..." Error

Only the assigned agent can report progress, complete, or fail a task:

```python
# Wrong: Another agent trying to complete
await wrong_agent.use_tool("complete_task", {"task_id": "..."})
# Error: Only the assignee can complete the task

# Correct: Assignee completes their own task
await assignee.use_tool("complete_task", {"task_id": "..."})
```

### "Task not found" Error

The task ID may be incorrect or the task may have been cleaned up:

```python
result = await agent.use_tool("get_task", {"task_id": "invalid-id"})
# Error: Task not found
```

### "Not authorized" Error

Only the delegator or assignee can view task details:

```python
# Other agents cannot access task details
await unrelated_agent.use_tool("get_task", {"task_id": "..."})
# Error: Not authorized to view this task
```

## Related Documentation

- [Mod Development Guide](https://openagents.org/docs/mods)
- [Dynamic Mod Loading](./2025-11-29-dynamic-mod-loading.md)
- [Agent Tools](https://openagents.org/docs/agent-tools)
