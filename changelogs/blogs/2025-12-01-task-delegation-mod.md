# Introducing Task Delegation: Structured Agent Coordination for OpenAgents

*December 1, 2025*

We're excited to announce the Task Delegation mod, a new coordination mod that enables AI agents to delegate tasks to other agents with proper status tracking, timeout handling, and lifecycle notifications.

## The Problem

In multi-agent systems, agents often need to collaborate by assigning work to each other. A research coordinator might need to ask a web searcher to find information, wait for results, and handle cases where the search times out or fails. 

Previously, this required custom event handling with `task.delegate` and `task.complete` events via the default workspace mod's `send_event` tool. There was no standardized way to:

- Track task status across agents
- Handle timeouts gracefully
- Report intermediate progress
- Query assigned or delegated tasks

## The Solution: Task Delegation Mod

The Task Delegation mod (`openagents.mods.coordination.task_delegation`) provides a complete solution for structured task delegation between agents.

### Key Features

| Feature | Description |
|---------|-------------|
| **Task Delegation** | Delegate tasks with description, payload, and timeout |
| **Status Tracking** | in_progress → completed/failed/timed_out |
| **Progress Reporting** | Assignees report intermediate progress |
| **Auto-Timeout** | Tasks automatically timeout after configured duration |
| **Access Control** | Only assignees can complete/fail their tasks |
| **Notifications** | All parties notified of lifecycle events |
| **Persistence** | Tasks persist to workspace storage |

## Quick Example

Here's how a coordinator agent can delegate a research task:

```python
from openagents.mods.coordination.task_delegation import TaskDelegationAdapter

# Get the adapter
tasks = agent.get_mod_adapter("task_delegation")

# Delegate a task to the web searcher
response = await tasks.delegate_task(
    assignee_id="web-searcher",
    description="Search for AI trends in 2025",
    payload={"query": "AI trends 2025", "sources": ["web", "news"]},
    timeout_seconds=300
)

task_id = response["data"]["task_id"]
print(f"Task delegated: {task_id}")
```

The assignee receives a notification and can work on the task:

```python
# Assignee reports progress
await tasks.report_progress(
    task_id=task_id,
    message="Searching web sources...",
    data={"sources_checked": 3}
)

# Complete with results
await tasks.complete_task(
    task_id=task_id,
    result={
        "findings": ["AI adoption accelerating", "LLMs becoming multimodal"],
        "summary": "AI is advancing rapidly across all sectors..."
    }
)
```

## Task Lifecycle

Tasks follow a simple status lifecycle:

```
in_progress → completed   (success)
            → failed      (error)
            → timed_out   (auto)
```

Tasks start immediately in `in_progress` status when delegated. There's no pending state—work begins right away.

## Automatic Timeout Handling

One of the most valuable features is automatic timeout handling. If an assignee doesn't complete a task within the specified timeout, the mod automatically:

1. Marks the task as `timed_out`
2. Notifies the delegator
3. Notifies the assignee

```python
# Delegate with 5-minute timeout
await tasks.delegate_task(
    assignee_id="slow-worker",
    description="Long-running task",
    timeout_seconds=300  # 5 minutes
)

# If not completed in 5 minutes, both parties get notified
```

This prevents tasks from being forgotten and allows delegators to take corrective action.

## Access Control

The mod enforces that only the assignee can:
- Report progress on their task
- Complete their task
- Fail their task

This prevents accidental or malicious interference with other agents' tasks.

## Querying Tasks

Agents can query their tasks by role and status:

```python
# List tasks I've delegated
my_delegated = await tasks.list_tasks(
    role="delegated_by_me",
    status=["in_progress"]
)

# List tasks assigned to me
my_assigned = await tasks.list_tasks(
    role="assigned_to_me",
    status=["in_progress", "completed"]
)

# Get full details of a specific task
task_info = await tasks.get_task(task_id="task-uuid-123")
```

## Available Tools

The adapter provides six intuitive tools:

| Tool | Description |
|------|-------------|
| `delegate_task` | Delegate a task to another agent |
| `report_task_progress` | Report progress on assigned task |
| `complete_task` | Complete task with results |
| `fail_task` | Fail task with error message |
| `list_tasks` | List tasks by role and status |
| `get_task` | Get task details |

## Notifications

The mod sends notifications for all task lifecycle events:

| Event | Recipient | Description |
|-------|-----------|-------------|
| `task.notification.assigned` | Assignee | New task assigned |
| `task.notification.progress` | Delegator | Progress reported |
| `task.notification.completed` | Delegator | Task completed |
| `task.notification.failed` | Delegator | Task failed |
| `task.notification.timeout` | Both | Task timed out |

## Use Cases

### Research Coordination

A coordinator delegates research tasks to specialists:

```python
# Coordinator delegates to researchers
await tasks.delegate_task(
    assignee_id="web-researcher",
    description="Research quantum computing trends"
)

await tasks.delegate_task(
    assignee_id="paper-analyst", 
    description="Analyze recent arXiv papers on transformers"
)

# Wait for results and compile findings
```

### Hierarchical Teams

Manager agents can delegate to worker agents:

```python
# Manager breaks down work
subtasks = ["Gather data", "Analyze results", "Write report"]

for i, subtask in enumerate(subtasks):
    await tasks.delegate_task(
        assignee_id=f"worker-{i}",
        description=subtask,
        timeout_seconds=600
    )
```

### Fault-Tolerant Workflows

Handle failures gracefully:

```python
result = await tasks.get_task(task_id)

if result["data"]["status"] == "timed_out":
    # Retry with a different agent
    await tasks.delegate_task(
        assignee_id="backup-worker",
        description=result["data"]["description"]
    )
```

## Getting Started

### 1. Enable the Mod

The mod is included in OpenAgents. Add it to your network configuration:

```yaml
mods:
  - path: openagents.mods.coordination.task_delegation
```

Or load dynamically:

```python
await network.load_mod("openagents.mods.coordination.task_delegation")
```

### 2. Use in Your Agents

```python
from openagents.agents import WorkerAgent

class CoordinatorAgent(WorkerAgent):
    async def on_startup(self):
        tasks = self.get_mod_adapter("task_delegation")
        
        # Delegate work to other agents
        response = await tasks.delegate_task(
            assignee_id="specialist",
            description="Perform specialized analysis"
        )
```

## What's Next

We're planning to expand the coordination mod package with:

- **Task Groups** - Delegate multiple related tasks as a unit
- **Dependencies** - Define task execution order
- **Retries** - Automatic retry policies for failed tasks
- **Priorities** - Task priority levels for scheduling

## Try It Today

Task Delegation is available now in OpenAgents. Whether you're building research teams, hierarchical agent systems, or fault-tolerant workflows, we think you'll find it valuable.

Questions or feedback?

- Join our [Discord community](https://discord.gg/openagents)
- Open an issue on [GitHub](https://github.com/openagents-org/openagents/issues)
- Follow updates on [Twitter](https://twitter.com/OpenAgentsAI)

Happy delegating!

---

*The OpenAgents Team*

---

## Changelog

### Task Delegation Mod v1.0.0
- **Task delegation** - Delegate tasks with description, payload, and timeout
- **Status tracking** - in_progress, completed, failed, timed_out
- **Progress reporting** - Assignees report intermediate progress
- **Auto-timeout** - Configurable timeout with automatic handling
- **Access control** - Only assignees can modify their tasks
- **Notifications** - Lifecycle events for all parties
- **Persistence** - Tasks saved to workspace storage
- **6 agent tools** - delegate, report, complete, fail, list, get
