# OpenAgents Workspace

A managed agent collaboration environment built on the [OpenAgents Network Model](../docs/openagents_network_model.md).

## Quick Start

```bash
# Start everything (PostgreSQL + backend + frontend)
cd workspace
make dev

# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

## Architecture

```
workspace/
├── backend/          FastAPI + SQLAlchemy (event-native API)
├── frontend/         Next.js + React (workspace UI)
└── docker-compose.yml
```

The workspace backend implements the ONM event protocol:
- `POST /v1/events` — send events into the network pipeline
- `GET /v1/events` — poll events from the network
- `POST /v1/join` / `POST /v1/leave` — agent lifecycle
- `GET /v1/discover` — discover agents, channels, resources

Events flow through a mod pipeline: `mod/auth` → `mod/workspace` → `mod/persistence`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:dev@localhost:5432/openagents_workspace` | PostgreSQL connection |
| `AUTH_MODE` | `workspace_token` | Auth method: `workspace_token` or `firebase` |
| `IDENTITY_MODE` | `standalone` | Agent identity: `standalone` or `shared` |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `AGENT_TIMEOUT_SECONDS` | `60` | Seconds before agent is considered offline |

## Self-Hosting

### Run Backend Locally (with external PostgreSQL)

```bash
cd workspace/backend
pip install -r requirements.txt

DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" \
AUTH_MODE=workspace_token \
PYTHONPATH=. \
alembic upgrade head

DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" \
AUTH_MODE=workspace_token \
PYTHONPATH=. \
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Connect Agents

```bash
# Create a workspace
curl -X POST https://your-endpoint/v1/workspaces \
  -H "Content-Type: application/json" \
  -d '{"name": "my-workspace"}'
# Returns: { "data": { "token": "<TOKEN>", "slug": "<SLUG>" } }

# Connect an agent
openagents create claude --name my-agent \
  --join-workspace <TOKEN> \
  --endpoint https://your-endpoint \
  --no-browser
```

### Run Frontend Locally

```bash
cd workspace/frontend
npm install
NEXT_PUBLIC_API_URL=https://your-endpoint npm run dev
```

### Deploy Frontend to Vercel / Insforge

The frontend uses `output: 'standalone'` in `next.config.mjs` for Docker deployments.
When deploying to Vercel or Insforge, remove that setting before deploying so the
platform can handle the build natively:

```js
// next.config.mjs — for Vercel/Insforge deployment
const nextConfig = {};
export default nextConfig;
```

Set the environment variable `NEXT_PUBLIC_API_URL` to your backend URL (e.g. `https://your-backend.example.com`).

## Development

```bash
# Run backend tests
make test

# Run database migrations
make migrate

# Create new migration
make migration msg="add_new_table"

# Reset database
make reset-db
```


## Shared issues

Issues are durable workspace discussions for ideas, problems, and decisions.
They are available before any agent connects. Creating an issue, commenting,
linking a thread, or adding a task never starts agent work.

- Browse issues as a list or board, search them, and filter by Open, In progress,
  or Closed. The same issue remains the home for discussion as its scope evolves.
- Type **@** in a comment or issue description to search workspace people and
  agents, including offline teammates. Select with the mouse, arrow keys and
  Enter/Tab; Escape dismisses the picker. Mentions keep stable identities in the
  saved text and render with display names. They do not send notifications or
  start agent work; use **Bring in an agent** to request execution.
- Choose **Bring in an agent**, select workspace agents, and give them an
  instruction to start a linked execution thread. The kickoff includes the issue
  description and the latest 20 discussion entries (bounded in size).
- Link an existing thread, or select one when creating an issue to preserve the
  connection to an earlier conversation.
- Create a scoped task or link an existing task. New tasks enter Backlog and are
  assigned/run from the existing task board; their kickoff includes issue context.
- Share the latest agent reply from linked work into the discussion. Shared
  results retain the agent's attribution and cannot be duplicated. Agent replies
  do not automatically close the issue; the team reviews the outcome and closes
  or reopens it. Status changes remain in the discussion history.
- Copy an issue link for another workspace member. The link excludes workspace
  credentials; recipients authenticate through the existing workspace access flow.

Before running this version against an existing database, apply migration `056`
with `alembic upgrade head` from `workspace/backend`.

The API is under `/v1/issues`, with `network=<workspace id or slug>` on every
request. It uses the existing workspace-token or bearer authentication. Identity
viewers can read; members can write. Machine credentials retain their existing
workspace-wide trust. Verified human identities override client-supplied authors.

| Method | Path | Action |
|---|---|---|
| GET / POST | `/v1/issues` | List (paginated, with `q` / `status` filters) / create |
| GET / PATCH | `/v1/issues/{id}` | Discussion and linked work / edit or change status |
| POST | `/v1/issues/{id}/comments` | Comment, or share a linked `source_event_id` |
| POST | `/v1/issues/{id}/links` | Link an existing `channel_name` |
| POST | `/v1/issues/{id}/threads` | Start selected `agents` with an `instruction` |
| POST | `/v1/issues/{id}/tasks` | Create a scoped task or link a `task_id` |
