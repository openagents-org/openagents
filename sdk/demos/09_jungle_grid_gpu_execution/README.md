# Jungle Grid GPU Execution Demo

This demo delegates asynchronous GPU workloads from an OpenAgents project to
[Jungle Grid](https://junglegrid.dev). A deterministic Python `WorkerAgent`
estimates first, waits for exact human approval, submits once, then polls
lifecycle events, status, logs, runtime details, and managed artifact metadata.

```text
Project goal
→ estimate
→ human approval
→ optional input/script references
→ submit
→ lifecycle events and status
→ workload logs
→ runtime details
→ managed artifacts
```

The demo calls REST directly so the human approval boundary and durable
OpenAgents project state remain explicit and testable. It does not require an
LLM or an MCP runtime dependency.

## Security And Billing Warning

Jungle Grid jobs may consume credits or incur charges. Project creation only
estimates. Billable submission requires this exact command from a verified
human identity:

```text
APPROVE <estimate-id>
```

Cancellation also requires an exact human command:

```text
CANCEL <job-id>
```

Keep credentials in executor environment variables. Do not put secrets in
goals, messages, metadata, logs, or committed files. The demo rejects literal
API-key/Bearer patterns, resolves workload secrets only after approval, redacts
shared output, never reads arbitrary host paths, and never stores temporary
signed artifact URLs.

## Prerequisites

- OpenAgents development dependencies.
- A scoped Jungle Grid API key with estimate, submit, read, logs, artifact, and
  cancellation access.
- A GPU-capable public container image or configured private-image credential.
- Previously uploaded Jungle Grid input IDs for file-backed jobs.

Install the repository package and development tools:

```bash
pip install -e ".[sdk,dev]"
```

## Environment Configuration

```bash
export JUNGLE_GRID_API_KEY="jg_..."
export JUNGLEGRID_API_BASE="https://api.junglegrid.dev"
export JUNGLE_GRID_POLL_INTERVAL_SECONDS="10"
export JUNGLE_GRID_MAX_POLL_FAILURES="3"
```

`JUNGLEGRID_API_BASE` is the current official API-base override.
`JUNGLE_GRID_API_URL` and `JUNGLE_GRID_API` are compatibility fallbacks. The
executor removes trailing slashes. Workload variables referenced by
`environment_from_env` must be exported in the executor process.

## Start The Network

```bash
cd sdk/demos/09_jungle_grid_gpu_execution
openagents network start network.yaml
```

The network enables the project mod and restricts the template to the
`executors` group. The committed group password hash is a demo-only credential;
replace it before a shared deployment.

## Start The Executor

```bash
cd sdk/demos/09_jungle_grid_gpu_execution
python agents/jungle_grid_executor.py
```

The executor supplies the configured group password hash during
`async_start`. OpenAgents therefore records it in
`network.topology.agent_group_membership`; static metadata alone does not
establish group membership. Run one executor for this demo.

## Create A Project

Open Studio at `http://localhost:8700/studio`, choose
`Jungle Grid GPU Execution`, and provide a JSON goal.

### Simple Command Job

The preferred command representation is an array:

```json
{
  "name": "openagents-training-demo",
  "workload_type": "training",
  "image": "pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime",
  "command": ["python", "-c", "import torch; print(torch.cuda.is_available())"],
  "model_size_gb": 1,
  "gpu_required": true,
  "routing_mode": "cost"
}
```

The original format remains compatible and is converted without reordering:

```json
{
  "name": "legacy-command-demo",
  "workload_type": "batch",
  "image": "nvidia/cuda:12.2.0-base-ubuntu22.04",
  "command": "python",
  "args": ["-c", "print('hello')"]
}
```

Accepted workload types are `inference`, `training`, `fine_tuning`, and
`batch`.

### File-Backed Job

Upload files through Jungle Grid first, then use only the returned IDs:

```json
{
  "name": "openagents-transcription",
  "workload_type": "inference",
  "image": "ghcr.io/example/whisper-runtime:cuda",
  "command": [
    "python",
    "/workspace/scripts/transcribe.py",
    "/workspace/inputs/audio.wav",
    "/workspace/artifacts/transcript.txt"
  ],
  "script_files": [{"input_id": "inp_script123"}],
  "input_files": [{"input_id": "inp_audio123"}],
  "expected_artifacts": ["/workspace/artifacts/transcript.txt"]
}
```

Inputs mount under `/workspace/inputs`, scripts under `/workspace/scripts`, and
managed outputs belong under `/workspace/artifacts`. `local_path` and similar
host-file fields are not supported.

### Environment And Callback Secrets

```bash
export MODEL_TOKEN="..."
export CALLBACK_TOKEN="..."
```

```json
{
  "name": "secure-inference",
  "workload_type": "inference",
  "image": "ghcr.io/example/model-runtime:cuda",
  "environment_from_env": {"MODEL_TOKEN": "MODEL_TOKEN"},
  "callback": {
    "url": "https://example.com/hooks/jungle",
    "metadata": {"source": "openagents"},
    "auth_token_from_env": "CALLBACK_TOKEN"
  }
}
```

Environment and callback token values are absent from estimates and are
resolved only after approval.

## Estimate And Approval

The executor calls `POST /v1/mcp/jobs/estimate`, stores a sanitized structured
response in `jungle_grid_estimate`, and posts a short summary. It respects
`screening.can_submit`, availability, warnings, fixes, blocked checks, routing,
cost/rate ranges, duration, queue/start windows, and capacity fields returned by
the API.

`screening.can_submit: true` does not prove immediate capacity.
`capacity_status.immediate_capacity_confirmed` is the relevant signal. Approval
is blocked when screening or availability explicitly rejects submission.

## Monitoring

After approval the executor:

- polls `GET /v1/mcp/jobs/{job_id}` for status, execution phase, status message,
  phase timing, delayed-start, scheduling, retry, failure, and completion data;
- polls `GET /v1/jobs/{job_id}/events` separately for platform lifecycle events;
- polls paginated `GET /v1/mcp/jobs/{job_id}/logs`;
- reads `GET /v1/jobs/{job_id}/runtime` at finalization;
- lists managed artifacts after terminal status.

Lifecycle names are not restricted to a local enum. Event IDs and log cursors
prevent duplicates. Messages are posted only for meaningful state changes.
Empty workload logs during scheduling, provisioning, input preparation, or
container startup do not fail the project. This is polling, not true streaming.

Shared event and log history is bounded to 200 entries each. API keys, Bearer
tokens, resolved environment values, authorization fields, and signed URLs are
redacted.

## Artifacts

Regular files written under `/workspace/artifacts` are eligible for managed
collection. `jungle_grid_result` contains sanitized job data, bounded lifecycle
events, bounded logs, runtime details when available, and artifact IDs, names,
paths, sizes, and content types returned by Jungle Grid.

The API can mint temporary artifact download URLs, but this demo intentionally
does not request or store them. Downloading bytes into an OpenAgents artifact
would require a separate size, authorization, and content-handling policy.

## Cancellation And Failure

Cancellation is accepted only for the job ID already recorded for that project.
Unauthorized, mismatched, duplicate, and terminal-state cancellation requests
do not call Jungle Grid.

Safe GET requests use bounded retries with exponential backoff. Submission is
never automatically retried because the current contract does not expose a
verified idempotency mechanism. If the executor restarts after recording a job,
it resumes monitoring. If it restarts with an uncertain `submitting` state and
no job ID, it refuses to resubmit blindly.

Completed jobs complete the OpenAgents project. Failed, rejected, and cancelled
jobs stop it. Runtime details may be unavailable before assignment/startup and
do not by themselves fail finalization.

## Current Jungle Grid MCP Tools

The current registry exposes:

- `estimate_job`
- `submit_job`
- `upload_job_input`
- `list_job_inputs`
- `list_jobs`
- `get_job`
- `get_job_events`
- `get_job_logs`
- `cancel_job`
- `list_artifacts`
- `get_artifact`

## Tests

All external requests are mocked. Tests never require a Jungle Grid account,
contact the live API, or submit paid work:

```bash
pytest tests/agents/test_jungle_grid_executor.py -q
ruff check sdk/demos/09_jungle_grid_gpu_execution tests/agents/test_jungle_grid_executor.py
ruff format --check sdk/demos/09_jungle_grid_gpu_execution tests/agents/test_jungle_grid_executor.py
mypy --follow-untyped-imports sdk/demos/09_jungle_grid_gpu_execution/agents/jungle_grid_executor.py
```
