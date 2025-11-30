# Task Queue & Job Scheduler Mod

Distributed task queue and job scheduler for OpenAgents networks with priority queues, cron scheduling, worker pools, and automatic retries.

## Features

- **Priority Queues** - 4 priority levels (urgent, high, normal, low)
- **Scheduled Tasks** - Cron expressions (`0 */2 * * *`) and fixed intervals
- **Worker Pool** - Capability-based task routing to workers
- **Automatic Retries** - Exponential backoff with configurable policies
- **Task Dependencies** - DAG support for complex workflows
- **Dead Letter Queue** - Persistent storage for permanently failed tasks
- **Heartbeat Monitoring** - Automatic detection of stale workers
- **Persistent Storage** - JSON-based task and worker persistence

## Installation

Enable the mod in your network configuration:

```yaml
# network.yaml
mods:
  - path: openagents.mods.workspace.task_queue
    config:
      worker_timeout: 300  # 5 minutes
      task_claim_timeout: 60  # 1 minute
      enable_dead_letter: true
      cleanup_interval: 300  # 5 minutes
```

## Quick Start

### Creating a Task

```python
from openagents.agents import WorkerAgent

agent = WorkerAgent("coordinator")
await agent.connect(network)

# Create a simple task
task_id = await agent.use_tool("create_task", {
    "name": "Process user signup",
    "payload": {
        "user_id": "12345",
        "email": "user@example.com"
    },
    "priority": "high",
    "timeout_seconds": 300
})

print(f"Created task: {task_id}")
```

### Scheduling a Recurring Task

```python
# Schedule daily backup at 2 AM
await agent.use_tool("create_task", {
    "name": "Daily database backup",
    "payload": {"backup_type": "full"},
    "schedule": {
        "schedule_type": "cron",
        "cron_expression": "0 2 * * *"
    },
    "retry_policy": {
        "max_retries": 3,
        "initial_delay": 300,
        "backoff_multiplier": 2.0
    }
})
```

### Worker Registration & Execution

```python
from openagents.agents import WorkerAgent

worker = WorkerAgent("worker-1")
await worker.connect(network)

# Register as worker
await worker.use_tool("register_worker", {
    "capabilities": ["ml", "data-processing"],
    "max_concurrent": 3
})

# Main worker loop
while True:
    # Claim next available task
    task = await worker.use_tool("claim_next_task")

    if task:
        try:
            # Mark as started
            await worker.use_tool("start_task", {
                "task_id": task["task_id"]
            })

            # Execute task
            result = await execute_task(task["payload"])

            # Mark as completed
            await worker.use_tool("complete_task", {
                "task_id": task["task_id"],
                "result": result
            })
        except Exception as e:
            # Mark as failed
            await worker.use_tool("fail_task", {
                "task_id": task["task_id"],
                "error": str(e)
            })

    await asyncio.sleep(5)  # Poll interval
```

## Using the Adapter

For more convenient usage, use the `TaskQueueAdapter`:

```python
from openagents.mods.workspace.task_queue import TaskQueueAdapter

adapter = TaskQueueAdapter(agent.client)

# Create task
task_id = await adapter.create_task(
    name="Process data",
    payload={"data_id": "123"},
    priority="high",
    tags=["ml", "batch"]
)

# Register as worker
await adapter.register_as_worker(
    capabilities=["ml", "data-processing"],
    max_concurrent=3
)

# Execute task with automatic status management
task = await adapter.claim_next_task()
if task:
    async def process_data(payload):
        # Your logic here
        return {"processed": True}

    await adapter.execute_task(task, process_data)
```

## Event API Reference

### Task Lifecycle Events

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `task.create` | `{name, payload, priority?, schedule?, retry_policy?, ...}` | `{task_id, created_at}` | Create new task |
| `task.claim` | `{task_id}` | `{success, claimed_at}` | Claim a task |
| `task.start` | `{task_id}` | `{execution_id, started_at}` | Mark task started |
| `task.complete` | `{task_id, result?}` | `{success, completed_at}` | Mark task completed |
| `task.fail` | `{task_id, error, error_details?}` | `{will_retry, next_retry_at?}` | Mark task failed |
| `task.cancel` | `{task_id}` | `{success}` | Cancel pending task |
| `task.get` | `{task_id}` | `{task: {...}}` | Get task details |
| `task.list` | `{status?, creator_id?, tags?, limit?, offset?}` | `{tasks: [...]}` | List tasks |

### Worker Events

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `worker.register` | `{capabilities?, max_concurrent?}` | `{success}` | Register as worker |
| `worker.unregister` | `{}` | `{success}` | Unregister worker |
| `worker.heartbeat` | `{}` | `{success}` | Send heartbeat |
| `worker.claim_next` | `{capabilities?}` | `{task: {...}}` or `null` | Get next task |
| `worker.list` | `{}` | `{workers: [...]}` | List all workers |

### Queue Management Events

| Event | Payload | Response | Description |
|-------|---------|----------|-------------|
| `queue.stats` | `{}` | `{stats: {...}}` | Get queue statistics |
| `queue.dead_letter.list` | `{limit?, offset?}` | `{tasks: [...]}` | List dead letter queue |

## Priority Levels

Tasks are executed based on priority:

1. **urgent** - Highest priority, executed first
2. **high** - Important tasks
3. **normal** - Default priority
4. **low** - Background tasks

Within the same priority, tasks are ordered by creation time.

## Scheduling

### One-Time Tasks

```python
{
    "schedule": {
        "schedule_type": "one_time",
        "scheduled_time": 1234567890.0  # Unix timestamp
    }
}
```

### Cron Tasks

```python
{
    "schedule": {
        "schedule_type": "cron",
        "cron_expression": "0 */2 * * *",  # Every 2 hours
        "start_time": 1234567890.0,  # Optional
        "end_time": 1234567890.0,    # Optional
        "timezone": "UTC"
    }
}
```

**Cron Syntax** (5 fields):
```
* * * * *
│ │ │ │ │
│ │ │ │ └─ Day of week (0-6, Sunday = 0)
│ │ │ └─── Month (1-12)
│ │ └───── Day of month (1-31)
│ └─────── Hour (0-23)
└───────── Minute (0-59)
```

**Examples:**
- `*/5 * * * *` - Every 5 minutes
- `0 */2 * * *` - Every 2 hours
- `0 9 * * 1` - Every Monday at 9 AM
- `30 14 1 * *` - 2:30 PM on the 1st of every month

### Interval Tasks

```python
{
    "schedule": {
        "schedule_type": "interval",
        "interval_seconds": 3600  # Every hour
    }
}
```

## Retry Policies

Configure automatic retries for failed tasks:

```python
{
    "retry_policy": {
        "max_retries": 3,
        "initial_delay": 5.0,
        "max_delay": 300.0,
        "backoff_multiplier": 2.0
    }
}
```

**Backoff Calculation:**
```
delay = initial_delay * (backoff_multiplier ^ attempt)
delay = min(delay, max_delay)
```

Example delays with default policy:
- Attempt 1: 5 seconds
- Attempt 2: 10 seconds
- Attempt 3: 20 seconds

After `max_retries`, tasks move to the dead letter queue.

## Task Dependencies

Create workflows with task dependencies:

```python
# Create workflow: fetch → process → notify
task1_id = await adapter.create_task(
    name="Fetch data",
    payload={"source": "api"}
)

task2_id = await adapter.create_task(
    name="Process data",
    payload={"algorithm": "ml"},
    depends_on=[task1_id]  # Wait for task1
)

task3_id = await adapter.create_task(
    name="Send notification",
    payload={"channel": "slack"},
    depends_on=[task2_id]  # Wait for task2
)
```

Tasks with unsatisfied dependencies remain in pending status until all dependencies complete.

## Worker Capabilities

Workers can register with capabilities (tags) to only receive matching tasks:

```python
# Worker with ML capabilities
await adapter.register_as_worker(
    capabilities=["ml", "tensorflow", "gpu"]
)

# Task requiring ML capability
await adapter.create_task(
    name="Train model",
    payload={"model_type": "cnn"},
    tags=["ml"]  # Only workers with "ml" capability can claim this
)
```

## Access Control

Restrict task execution to specific workers or agent groups:

```python
# Only specific workers
await adapter.create_task(
    name="Sensitive operation",
    payload={...},
    allowed_workers=["agent:admin-worker"]
)

# Only specific agent groups
await adapter.create_task(
    name="Team task",
    payload={...},
    allowed_groups=["engineering-team"]
)
```

## Queue Statistics

Monitor queue health:

```python
stats = await adapter.get_queue_stats()

print(f"""
Total tasks: {stats['total_tasks']}
Pending: {stats['pending']}
Running: {stats['running']}
Completed: {stats['completed']}
Failed: {stats['failed']}
Active workers: {stats['active_workers']}
""")
```

## Best Practices

### Task Design

1. **Idempotency** - Design tasks to be safely retried
2. **Timeout** - Set reasonable timeouts for tasks
3. **Granularity** - Break large tasks into smaller ones
4. **Payload Size** - Keep payloads small (< 1MB)

### Worker Design

1. **Heartbeats** - Send heartbeats every 30-60 seconds
2. **Graceful Shutdown** - Unregister workers on shutdown
3. **Error Handling** - Catch exceptions and fail tasks appropriately
4. **Concurrency** - Set `max_concurrent` based on worker capacity

### Production Deployment

1. **Monitoring** - Track queue stats regularly
2. **Dead Letter Queue** - Review and handle failed tasks
3. **Worker Scaling** - Add workers based on queue depth
4. **Retention** - Archive old completed tasks periodically

## Notification Events

Subscribe to task lifecycle events:

- `task.notification.created` - New task created
- `task.notification.started` - Task execution started
- `task.notification.completed` - Task completed successfully
- `task.notification.failed` - Task failed (includes retry info)

```python
@agent.on_event("task.notification.completed")
async def on_task_complete(context):
    task_id = context.payload["task_id"]
    result = context.payload["result"]
    print(f"Task {task_id} completed with result: {result}")
```

## Storage Structure

Tasks and workers are persisted in JSON format:

```
workspace/task_queue/
├── tasks/
│   ├── {task_id_1}.json
│   ├── {task_id_2}.json
│   └── ...
├── workers/
│   ├── {worker_id_1}.json
│   ├── {worker_id_2}.json
│   └── ...
└── dead_letter/
    ├── {failed_task_id_1}.json
    └── ...
```

## Troubleshooting

### Tasks Not Being Claimed

- Check worker capabilities match task tags
- Verify worker is registered and sending heartbeats
- Check `allowed_workers` / `allowed_groups` restrictions
- Verify task dependencies are satisfied

### Worker Heartbeat Failures

- Ensure heartbeat interval < `worker_timeout` (default 300s)
- Check network connectivity
- Verify worker is registered

### Tasks Stuck in Running

- Check if worker crashed (will be released after `task_claim_timeout`)
- Verify worker sent `start_task` event
- Check task timeout setting

### Dead Letter Queue Growing

- Review task error messages
- Check retry policy configuration
- Verify worker implementation handles edge cases
- Consider increasing `max_retries` or fixing root cause

## Examples

See the `demos/05_task_queue_demo/` directory for complete working examples including:

- Basic task creation and execution
- Scheduled and recurring tasks
- Task dependencies (DAG workflows)
- Worker pool with different capabilities
- Error handling and retry logic
- Queue monitoring and statistics

## See Also

- [OpenAgents Documentation](https://openagents.org/docs/)
- [Mod Development Guide](../../docs/MOD_DEVELOPMENT.md)
- [Task Queue Demo](../../../../demos/05_task_queue_demo/)
