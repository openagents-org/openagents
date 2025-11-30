# Demo 5: Task Queue & Job Scheduler

Demonstration of distributed task execution with priority queues, scheduled jobs, worker pools, and automatic retries.

## Overview

This demo showcases the **task queue mod** with:
- Priority-based task execution
- Cron-scheduled recurring tasks
- Worker pool with capability matching
- Automatic retries with exponential backoff
- Task dependencies (DAG workflows)
- Queue monitoring and statistics

## Architecture

```
                ┌────────────────┐
    User ──────▶│  Coordinator   │
                │ (creates tasks)│
                └────────┬───────┘
                         │ task.create
              ┌──────────┴──────────┐
              │                     │
              ▼                     ▼
       ┌─────────────┐       ┌─────────────┐
       │   Worker 1  │       │   Worker 2  │
       │  (executes) │       │  (executes) │
       └─────────────┘       └─────────────┘
              │                     │
              └──────────┬──────────┘
                         │ task.complete
                         ▼
                  ┌─────────────┐
                  │ Task Queue  │
                  │     Mod     │
                  └─────────────┘
```

## Agents

| Agent | Role | Capabilities |
|-------|------|--------------|
| `coordinator` | Task Creator | Creates tasks, monitors queue |
| `worker-1` | Task Executor | Executes tasks with capabilities: data-processing, ml |

## Features Demonstrated

1. **Basic Task Creation** - Simple tasks with different priorities
2. **Scheduled Tasks** - Cron expressions for recurring jobs
3. **Task Dependencies** - Multi-step workflows
4. **Worker Pool** - Multiple workers with capability matching
5. **Retry Logic** - Automatic retries with exponential backoff
6. **Dead Letter Queue** - Handling permanently failed tasks
7. **Queue Monitoring** - Real-time queue statistics

## Quick Start

### 1. Start the Network

```bash
cd demos/05_task_queue_demo
openagents network start network.yaml
```

### 2. Start the Coordinator

In a new terminal:

```bash
openagents agent start agents/coordinator.yaml
```

### 3. Start Workers

In separate terminals:

```bash
# Worker 1
openagents agent start agents/worker.yaml
```

You can start multiple workers by copying the worker.yaml and changing the agent_id.

### 4. Connect via Studio

```bash
openagents studio -s
# Connect to localhost:8703
```

## Demo Scenarios

### Scenario 1: Create Simple Tasks

In Studio, talk to the coordinator:

> "@coordinator Create 3 tasks with different priorities: urgent, normal, and low"

The coordinator will create tasks and workers will execute them in priority order.

### Scenario 2: Schedule Recurring Task

> "@coordinator Create a task that runs every 2 minutes to check system status"

This creates a cron-scheduled task that executes periodically.

### Scenario 3: Task Dependencies

> "@coordinator Create a workflow with 3 tasks: fetch data, process data, send notification"

This creates a DAG where tasks execute in sequence.

### Scenario 4: Monitor Queue

> "@coordinator Show me the current queue statistics"

Displays pending, running, completed, and failed task counts.

### Scenario 5: Test Retry Logic

> "@coordinator Create a task that will fail the first time but succeed on retry"

Demonstrates automatic retry with exponential backoff.

## Python Demo Script

Run the included Python script for automated demonstration:

```bash
python demo_script.py
```

This script will:
1. Start a network programmatically
2. Create various types of tasks
3. Start workers
4. Monitor execution
5. Display results

## Example Tasks

### High Priority Task

```python
{
    "name": "Process urgent user request",
    "payload": {"user_id": "123", "action": "upgrade"},
    "priority": "urgent",
    "timeout_seconds": 300
}
```

### Scheduled Task (Cron)

```python
{
    "name": "Hourly data sync",
    "payload": {"source": "database", "destination": "warehouse"},
    "schedule": {
        "schedule_type": "cron",
        "cron_expression": "0 * * * *"  # Every hour
    },
    "retry_policy": {
        "max_retries": 3,
        "initial_delay": 60,
        "backoff_multiplier": 2.0
    }
}
```

### Task with Dependencies

```python
# Task 1: Fetch
task1_id = await create_task({
    "name": "Fetch data from API",
    "payload": {"url": "https://api.example.com/data"}
})

# Task 2: Process (depends on task1)
task2_id = await create_task({
    "name": "Process fetched data",
    "payload": {"algorithm": "ml_model"},
    "depends_on": [task1_id]
})

# Task 3: Notify (depends on task2)
task3_id = await create_task({
    "name": "Send completion notification",
    "payload": {"channel": "slack"},
    "depends_on": [task2_id]
})
```

## Worker Implementation Pattern

```python
from openagents.agents import WorkerAgent
from openagents.mods.workspace.task_queue import TaskQueueAdapter

class TaskWorker(WorkerAgent):
    async def on_startup(self):
        # Get adapter
        self.queue = TaskQueueAdapter(self.client)

        # Register as worker
        await self.queue.register_as_worker(
            capabilities=["data-processing", "ml"],
            max_concurrent=3
        )

        # Start worker loop
        asyncio.create_task(self.worker_loop())

    async def worker_loop(self):
        while True:
            # Claim next task
            task = await self.queue.claim_next_task()

            if task:
                # Execute with automatic status management
                await self.queue.execute_task(task, self.process_task)

            # Send heartbeat
            await self.queue.send_heartbeat()

            await asyncio.sleep(5)

    async def process_task(self, payload):
        # Your task logic here
        print(f"Processing task: {payload}")
        await asyncio.sleep(2)  # Simulate work
        return {"status": "completed", "result": "success"}
```

## Configuration

- **Network Port:** 8703 (HTTP), 8603 (gRPC)
- **Mods:** `task_queue`, `messaging`
- **Worker Timeout:** 300 seconds
- **Task Claim Timeout:** 60 seconds

## Monitoring

Check queue statistics:

```python
stats = await adapter.get_queue_stats()
print(f"""
Queue Statistics:
- Total tasks: {stats['total_tasks']}
- Pending: {stats['pending']}
- Running: {stats['running']}
- Completed: {stats['completed']}
- Failed: {stats['failed']}
- Workers: {stats['total_workers']}
- Active workers: {stats['active_workers']}
""")
```

## Troubleshooting

### Tasks not being executed

- Verify workers are registered: Check worker.list
- Ensure worker capabilities match task tags
- Check task dependencies are satisfied

### Worker disconnected

- Workers must send heartbeats every 5 minutes
- Check worker.heartbeat events
- Restart worker if needed

### Tasks stuck in running

- Check worker logs for errors
- Tasks timeout after `timeout_seconds`
- Stale claims are released after 60 seconds

## Next Steps

After running this demo, try:

1. **Scale Workers** - Start multiple workers and observe load balancing
2. **Complex Workflows** - Create multi-step DAG workflows
3. **Failure Scenarios** - Test retry logic and dead letter queue
4. **Production Deployment** - Deploy with monitoring and alerting

## See Also

- [Task Queue Mod Documentation](../../src/openagents/mods/workspace/task_queue/README.md)
- [OpenAgents Documentation](https://openagents.org/docs/)
