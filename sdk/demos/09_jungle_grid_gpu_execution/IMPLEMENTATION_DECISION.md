# Jungle Grid Integration Decision

## Selected Extension Point

This contribution remains a runnable demo network with a deterministic Python
`WorkerAgent`. It uses OpenAgents projects for assignment and lifecycle,
project messages for human approval and meaningful status changes, and project
artifacts for durable execution state and sanitized results.

Jungle Grid is an external workload execution service, not an OpenAgents
transport, launcher, credential type, or network mod. Keeping it as a demo makes
the approval boundary and asynchronous project behavior explicit and testable.
The agent calls REST directly because an MCP tool call would otherwise hide the
project-state transition around billable submission.

## Jungle Grid Contract

The implementation was aligned against `Jungle-Grid/mcp-server` and the current
orchestrator API implementation, not only the README:

- `POST /v1/mcp/jobs/estimate`
- `POST /v1/mcp/jobs`
- `GET /v1/mcp/jobs/{job_id}`
- `GET /v1/jobs/{job_id}/events`
- `GET /v1/mcp/jobs/{job_id}/logs`
- `GET /v1/jobs/{job_id}/runtime`
- `POST /v1/mcp/jobs/{job_id}/cancel`
- `GET /v1/mcp/jobs/{job_id}/artifacts`
- `POST /v1/mcp/jobs/{job_id}/artifacts/{artifact_id}/download`

The official API-base override is `JUNGLEGRID_API_BASE`.
`JUNGLE_GRID_API_URL` and the older demo variable `JUNGLE_GRID_API` remain
compatibility fallbacks. Trailing slashes are removed.

The public workload types are `inference`, `training`, `fine_tuning`, and
`batch`; `fine_tuning` is sent to REST as `fine-tuning`. The preferred command
shape is an array. Legacy string `command` plus string-array `args` is combined
in order before estimation and submission.

## Uploaded Files

The demo accepts previously uploaded Jungle Grid `input_id` values through
`input_files` and `script_files`. This is the minimum safe file workflow:

- IDs are validated locally and then verified by Jungle Grid during estimate or
  submission.
- No goal field can name an executor host path.
- Upload URLs, completion tokens, and storage credentials never enter project
  state.

Uploading OpenAgents artifacts would require a separate authorization and
byte-transfer design. It is intentionally outside this demo rather than
allowing a project goal to read arbitrary local files.

## Durable Idempotency

`jungle_grid_execution_state` records the estimate ID, submission state,
recorded job ID, cancellation state, status fingerprint, event IDs, and log
cursor. The agent writes `submitting` before the non-idempotent submission call
and writes the returned job ID immediately afterward.

After restart:

- a recorded job resumes monitoring;
- a terminal project is not resubmitted;
- a `submitting` state without a recorded job is not retried automatically,
  because the current submission contract does not expose a verified
  idempotency key;
- duplicate approvals and cancellations are serialized by a per-project lock.

This favors avoiding a duplicate billable job over guessing after an ambiguous
network failure.

## Security Decisions

- Estimation cannot submit compute.
- Submission requires exact `APPROVE <estimate-id>` from a `human:` identity.
- Cancellation requires exact `CANCEL <job-id>` from a `human:` identity.
- API and workload secrets are resolved from environment variables only.
- Callback auth uses `callback.auth_token_from_env`; literal callback secrets
  are not accepted.
- Metadata with secret-like keys, Bearer tokens, API-key patterns, and signed
  URLs are rejected or redacted.
- Artifact download URLs are not requested during finalization. The client
  method exists to match the API, but project state stores metadata only.
- Automated tests mock all external calls.

The committed `executors.password_hash` is a demo-only group credential. Its
purpose is to establish actual runtime topology membership so project
notifications reach the executor. It must be replaced for a shared deployment.

## Deliberately Unsupported Goal Fields

The current public MCP submission contract does not expose arbitrary
host-file paths, CPU or memory sizing, provider pinning, or user-controlled
retry policy. The demo does not invent those fields. It supports the verified
GPU, region, priority, timeout, callback, routing, upload-reference, template,
metadata, and expected-artifact fields accepted by the current API.
