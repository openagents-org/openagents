# OpenAgents Workspace — current architecture and troubleshooting

Reviewed 2026-10-26 against production backend release `5409a710a` and its
source tree. Production reported schema revision `085` at review time. These
are dated observations, not versions to hard-code into future deployments.
All source paths below are relative to the repository root.

## Serving stack

- `workspace/backend/`: FastAPI on two DigitalOcean backend nodes, behind the
  production load balancer. Railway configuration remaining in the repository
  is not the current production deployment path.
- Both backend nodes share PostgreSQL, S3-compatible file storage, Valkey
  cache/pub-sub and authentication configuration. Pub/sub must use the same
  namespace on both nodes for cache invalidation and SSE delivery.
- The primary runs background jobs; the secondary disables them. This does not
  provide automatic scheduler failover or solve per-worker scheduler duplication.
- `workspace/frontend/`: the Vercel-hosted Workspace UI at
  `https://workspace.openagents.org`, plus a desktop build bundled in the launcher.
- API base: `https://workspace-endpoint.openagents.org`.
- `packages/agent-connector/`: the daemon, adapters and `agn` CLI, published as
  `@openagents-org/agent-launcher`. Updating the backend does not update connectors
  already installed on users' devices.
- `packages/go/web/` and `packages/go/OpenAgents/`: additional web and iOS clients;
  check their own implementations when investigating client-specific behavior.

Use deployment configuration and authorized operations tooling to discover nodes
and credentials. This document intentionally contains no server IPs, SSH aliases,
operator usernames, key filenames or developer checkout paths.

Sources: [deployment operations](../../../workspace/operations/digitalocean/cd/README.md),
[multiple backend nodes](../../../workspace/operations/digitalocean/multi-node.md),
[backend build](../../../workspace/backend/production.Dockerfile).

## v1.1 identity, ownership and access

Workspace collaboration v1.1 is live. It is distinct from the launcher version,
connector npm version and database migration revision.

- Human membership is stored in `WorkspaceMembership`, separately from agent
  `WorkspaceMember` rows. Owner/admin/member/viewer/guest role checks do not replace
  resource-level authorization. Inspect `/v1/workspaces/{id}/me` and the team API
  for the caller's workspace role.
- Signed-in human identity is authoritative even when a client also sends a
  workspace token. An expired human credential must not fall back to machine
  privileges. A shared URL or token is not a general substitute for human login.
- Machine callers use workspace or per-device credentials. Agent calls supply
  `X-Agent-Name` so access can be evaluated as that agent and its human owner.
  Legacy machine compatibility remains in specific paths; inspect the access
  implementation rather than assuming every token has the same scope.
- Devices and agents have human owners. Agents are private by default; teammates
  need explicit sharing or another applicable grant. Thread-only permission,
  direct agent use and access to an agent service are separate permissions.
- Resource access combines ownership, active grants to humans/agents/groups,
  public visibility and thread participation. Rights include `read`, `act` and
  `share`; `act` implies `read`. Admin status alone does not grant the contents of
  every private resource; metadata visibility is distinct from content access.
- New ordinary threads are private by default. Historical workspace-visible
  threads became public during the compatibility migration. Files with inherited
  visibility use their thread's access; folder names do not establish privacy.
- Pair a device, then add/configure its agents through the workspace. The current
  Connect Agent page offers local-device and cloud-agent flows; the manual
  connection tab is removed. Per-device credentials and ownership must survive
  reconnects and upgrades.
- An ownerless legacy workspace has a dedicated claim flow requiring verified
  identity and its existing shared credential. Do not infer ownership from a URL
  or assign device ownership to an arbitrary administrator.

Sources: [access resolution](../../../workspace/backend/app/access.py),
[resource permissions](../../../workspace/backend/app/services/access_model.py),
[team and workspace routes](../../../workspace/backend/app/routers/workspaces.py),
[device routes](../../../workspace/backend/app/routers/nodes.py).
The [v1.1 migration guide](../../../workspace/docs/migrate-to-v1.1.md) is historical
cutover context. Its revision `081` and Railway commands are not current production
instructions; do not rerun that upgrade or use it to downgrade a newer database.

## Events, routing and agent presence

Messages enter `POST /v1/events` through
`workspace/backend/app/routers/events.py` and the event pipeline in
`workspace/backend/app/mods/workspace_mod.py`. Reads use `GET /v1/events` with
workspace, channel/conversation, cursor, type and access filters.

A normal message targets `channel/<name>` or an address for a DM. `chat` is final
conversation content; `status`, `thinking`, `todos`, `approval` and `artifact`
messages have distinct behavior and should not accidentally start another agent.
Caller-supplied routing metadata is not authority to bypass permissions.

Current routing is richer than the old “mention, otherwise master” rule:

1. Validate sender identity, thread visibility and agent/service permissions.
   Explicitly denied requests must not silently redirect to another agent.
2. Respect thread response mode. Proactive conversation can route clear tasks;
   passive threads require explicit addressing. Human-only conversation can stay
   silent. Multiple explicit agent mentions can produce multiple targets.
3. Use eligible thread participants and configured router settings to choose work.
   Uncertain requests can create a pending `routing_choice` for the requester.
   The configured provider/model is authoritative; do not assume a fixed model.
4. Workflow, service, routine and direct-message paths have specialized rules.
   A thread's master agent is not a universal fallback for every conversation.
5. When enabled, completion routing uses correlated final replies to decide a
   bounded next handoff, ask, wait or stop. It rechecks permissions and whether the
   human request was stopped or superseded. It can consider an offline agent;
   “offline” does not always mean “ineligible.”
6. `metadata.target_agents = ["__no_response__"]` explicitly suppresses responses
   and preserves compatibility with older connectors.

`WorkspaceClient.pollPending()` now sends a server-side `target_agents` filter
and retains client-side checks. The old claim that every current agent downloads
all workspace messages is obsolete. Older installed connectors may behave
otherwise; inspect the actual connector version and request parameters.

Use heartbeat freshness and presence fields to assess liveness. Persisted
`WorkspaceMember.status` alone may be stale after a crash. Busy/queued state is
also different from connection liveness. Inspect the configured timeout rather
than relying on an old constant in these notes.

Sources: [routing](../../../workspace/backend/app/mods/workspace_mod.py),
[completion routing](../../../workspace/backend/app/services/completion_routing.py),
[thread agent permissions](../../../workspace/backend/app/services/thread_agent_requests.py),
[connector API client](../../../packages/agent-connector/src/workspace-client.js).

## Streaming and database safeguards

`GET /v1/events/stream` uses shared cache/pub-sub. Keepalive delivery must continue
when no messages arrive. The frontend has streaming/polling recovery behavior;
check the deployed `use-polling.ts` and proxy settings before changing timers.
Do not apply an old reconnect or rendering fix without reproducing the problem.

Production now contains the October 25 outage safeguards and follow-up fix:

- Application PostgreSQL transactions set local lock, statement and idle-in-
  transaction limits. Defaults are 3 seconds, 30 seconds and 60 seconds, controlled
  by `DB_LOCK_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS` and
  `DB_IDLE_TRANSACTION_TIMEOUT_MS`. These are application-session safeguards,
  not database-wide configuration changes.
- Cloud invocations run in a bounded worker pool rather than performing blocking
  ORM work on the HTTP event loop. Recursive handoffs remain on their worker;
  detached workflow/integration/watch hooks use a separate executor.
- Message-producing request dependencies close their sessions before background
  work begins. Background tasks own their own sessions and receive snapshots.
- Completion routing still holds a channel row lock across its bounded model
  decision. Contention can produce a retryable timeout; isolation of the event
  loop does not remove every slow transaction.

The incident showed idle transactions, lock waiters and pool exhaustion rather
than an expensive table scan. A reproduced application deadlock and excessive
request-session lifetime explained how this could happen; the exact first
request of that incident was not captured.

Sources: [transaction limits](../../../workspace/backend/app/db_timeouts.py),
[cloud execution](../../../workspace/backend/app/services/cloud_agent.py),
[incident evidence](../../../workspace/backend/INCIDENT-2026-10-25.md).

## Release and migration procedure

1. Merge reviewed application changes into `develop`.
2. Promote the intended merged commit using `.github/workflows/promote-release.yml`.
   `release` is protected; do not replace this with a direct or force push.
3. `.github/workflows/deploy-digitalocean.yml` builds the exact release with
   `workspace/backend/production.Dockerfile` and locked production dependencies.
4. The coordinator validates the candidate and database compatibility, drains and
   replaces the secondary, verifies it, then repeats for the primary and performs
   public verification. Inspect rollout results and both nodes after completion.
5. A frontend deployment is separate from the backend rollout. Confirm the Vercel
   deployment and build-time API URL; a successful backend job does not prove the
   UI has been updated. Desktop-bundled UI changes need a launcher release too.

Read [workspace/AGENTS.md](../../../workspace/AGENTS.md) before deployment work.
Schema changes, migrations, backfills, bulk repairs and database infrastructure
changes require prior agreement. A normal release with no pending migration does
not run an upgrade. A pending migration is not implicitly authorized by an app
release: review its compatibility declaration and backup/restore plan first.
The coordinator backs up before approved pending migrations and never
automatically downgrades database schema/data during application rollback.

Preview follows `develop` with its own frontend, backend, local PostgreSQL database
and file-storage volume on droplet 164.92.127.159 (authorized October 26, 2026).
The droplet checks develop every two minutes, builds both images from one SHA,
backs up the local DB before migrations, and verifies readiness before completing
an update. See the [preview runbook](../../../workspace/docs/preview-environment.md).
Production migration approval requirements still apply to production only.

## Troubleshooting order

1. Check `/health` for process liveness and `/ready` for database readiness, then
   an authorized discovery/read request. Compare both serving nodes and the
   public route; a green liveness check alone is insufficient.
2. Confirm the deployed image, rollout outcome, schema compatibility, shared
   cache and storage configuration. Use current operations configuration to find
   hosts; do not copy machine details from old notes.
3. For DB stalls, inspect `pg_stat_activity`, transaction ages, lock waiters and
   pool errors using bounded read-only diagnostics. Capture blocking call stacks
   when possible before a recovery restart. Do not publish raw logs, tokens,
   connection strings or SQL parameters containing user data.
4. For missing access, inspect human role, device/agent owner, grants, thread
   participation, service permissions and pending approvals before changing them.
5. For missing replies, inspect heartbeat/busy state, routing metadata, response
   mode, reply correlation, stopped state and the installed connector version.
   A silent decision or offline assignment can be intentional.
6. For streaming/UI symptoms, distinguish API errors from SSE/proxy reconnects and
   frontend rendering. Treat old bug hypotheses as history, not current diagnoses.
