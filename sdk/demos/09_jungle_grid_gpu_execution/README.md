# Jungle Grid GPU Execution Demo

This demo shows an OpenAgents execution agent delegating long-running AI and GPU
workloads to [Jungle Grid](https://junglegrid.dev), an execution layer that
places and runs AI workloads without requiring agents to manage GPU servers.

The workflow fits OpenAgents because the workload is asynchronous and
collaborative: an agent estimates the job, a human approves spending in the
shared project, and the agent returns lifecycle updates, logs, and artifact
metadata to the same workspace.

## Security And Billing Warning

Jungle Grid jobs may consume credits or incur charges. The executor never submits
a workload when a project starts. It requires an exact approval command from a
human identity after posting the estimate. Keep API keys in environment variables
and do not paste secrets into project goals, messages, logs, metadata, or
committed files. Workloads that need environment values must use
`environment_from_env`; the executor resolves those references only after human
approval, immediately before submission.

## Prerequisites

- Python with the OpenAgents development package installed.
- A Jungle Grid account and a scoped API key that can estimate, submit, read, and
  cancel jobs.
- A public container image suitable for the requested workload.

## Environment Variables

- `JUNGLE_GRID_API_KEY` is required. The agent reads this server-side API key and
  sends it only as a Bearer token to Jungle Grid.
- `JUNGLEGRID_API_BASE` optionally overrides the default API base,
  `https://api.junglegrid.dev`.
- Any workload-specific variables referenced by `environment_from_env` must also
  be exported in the executor process. Their values are never placed in the
  project goal or estimate request.

## Setup

From the repository root, install OpenAgents with SDK and development
dependencies so the network, agent, and test commands are available:

```bash
pip install -e ".[sdk,dev]"
```

Export the Jungle Grid API key in the shell that will run the executor. This
keeps the credential out of the repository and network configuration:

```bash
export JUNGLE_GRID_API_KEY="jg_..."
```

## Run The Demo

Start the OpenAgents network from this demo directory. The network enables the
project mod and exposes the `Jungle Grid GPU Execution` project template:

```bash
cd sdk/demos/09_jungle_grid_gpu_execution
openagents network start network.yaml
```

In a second terminal, start the deterministic Python executor. It does not need
an LLM provider key:

```bash
cd sdk/demos/09_jungle_grid_gpu_execution
python agents/jungle_grid_executor.py
```

Open Studio at `http://localhost:8700/studio`, create a project with the
`Jungle Grid GPU Execution` template, and use a JSON object as the project goal.
For example:

```json
{
  "name": "openagents-batch-demo",
  "workload_type": "batch",
  "image": "python:3.11-slim",
  "command": "python",
  "args": ["-c", "print('hello from Jungle Grid')"],
  "optimize_for": "cost"
}
```

The agent validates the request and calls Jungle Grid's estimate endpoint. It
posts the structured estimate and stores it as project artifact
`jungle_grid_estimate`. No compute has been submitted at this point.

For a workload that needs a credential or other environment value, export it in
the executor shell and reference only its local variable name in the goal:

```bash
export MODEL_TOKEN="..."
```

```json
{
  "name": "openagents-inference-demo",
  "workload_type": "inference",
  "image": "example/model-server:latest",
  "environment_from_env": {
    "MODEL_TOKEN": "MODEL_TOKEN"
  },
  "optimize_for": "cost"
}
```

The mapping key is the variable sent to the workload, and the mapping value is
the local executor variable to resolve. Literal `environment` values, API keys,
Bearer tokens, and secret-like metadata keys are rejected.

Review the estimate, then reply in the project with the exact command shown by
the agent. Estimates that explicitly report `available: false` or
`can_submit: false` cannot be approved:

```text
APPROVE <estimate-id>
```

After approval, the agent submits the workload, posts status changes such as
submitted, queued, assigned/provisioning, running, completed, failed, rejected,
or cancelled, and stores the final job details, logs, artifact list, and
temporary download metadata in project artifact `jungle_grid_result`.

To cancel a submitted job, reply with the exact job ID:

```text
CANCEL <job-id>
```

Cancellation is explicit and only applies when the job ID matches the project.
Only a human identity can request cancellation. The agent reports cancellation
failures without exposing the API key.

## Failure Behavior

Invalid workload JSON, missing required fields, missing API keys, timeouts,
invalid Jungle Grid responses, and API errors are posted to the project in
sanitized form. Failed, rejected, or cancelled jobs stop the OpenAgents project.
Completed jobs complete the project.

## Tests

Run the focused mocked tests. They do not contact Jungle Grid or submit paid
work:

```bash
pytest tests/agents/test_jungle_grid_executor.py
```

Run the repository formatter and linter checks used by the Python project:

```bash
ruff format --check sdk/demos/09_jungle_grid_gpu_execution tests/agents/test_jungle_grid_executor.py
ruff check sdk/demos/09_jungle_grid_gpu_execution tests/agents/test_jungle_grid_executor.py
```

## Optional Live Estimate

The normal demo performs a live estimate when a project starts, but it never
automatically submits a job. Use a low-cost workload goal, review the estimate in
the project, and do not send the approval command unless you explicitly intend
to start billable compute.
