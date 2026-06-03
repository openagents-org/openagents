# Jungle Grid Integration Decision

## Selected Extension Point

This contribution is a runnable demo network with a Python `WorkerAgent`. The agent
uses OpenAgents' project mod for the long-running workflow, project messages for
estimate and lifecycle updates, and project artifacts for logs and Jungle Grid
artifact metadata.

Jungle Grid is an external execution layer, not an OpenAgents transport, launcher
agent type, or network mod. A demo keeps the integration provider-specific while
showing a reusable OpenAgents pattern: an agent delegates asynchronous compute,
waits for human approval before billable work, and returns results to a shared
project.

## Rejected Alternatives

- **Launcher agent type:** Jungle Grid executes workloads; it is not an interactive
  coding-agent runtime managed by the launcher.
- **Core provider integration:** No OpenAgents core abstraction requires a
  provider-specific compute backend.
- **Jungle Grid mod:** The integration does not add network-wide event semantics or
  shared infrastructure. Existing project events already cover the workflow.
- **Hosted MCP entry:** OpenAgents can load external MCP tools, but the current
  Streamable HTTP MCP connector does not perform Jungle Grid's hosted OAuth flow or
  attach API-key headers. Adding that capability solely for this demo would be a
  core architecture change.
- **Local stdio MCP dependency:** The Jungle Grid stdio MCP package is supported,
  but a direct Python API client is easier to validate, test, and constrain around
  mandatory human approval. It also avoids requiring Node.js for a Python demo.

## Jungle Grid Contract Used

The demo uses the documented public execution API:

- `POST /v1/jobs/estimate`
- `POST /v1/jobs`
- `GET /v1/jobs/{job_id}`
- `GET /v1/jobs/{job_id}/logs`
- `POST /v1/jobs/{job_id}/cancel`
- `GET /v1/jobs/{job_id}/artifacts`
- `POST /v1/jobs/{job_id}/artifacts/{artifact_id}/download`

Authentication is a scoped server-side API key in `JUNGLE_GRID_API_KEY`. The
documented lifecycle includes `pending`, `queued`, `assigned`, `running`,
`completed`, `failed`, `rejected`, and `cancelled`.

Workload environment values are not accepted in project goals. A goal may use
`environment_from_env` to reference variables available only in the executor
process; those values are resolved after human approval and are excluded from
the estimate request and project-visible output.

## Contribution Workflow

OpenAgents' contributing guide asks contributors to create an issue for feature
suggestions before submitting a pull request. This demo should be proposed in an
issue and held for maintainer direction before a PR is opened.
