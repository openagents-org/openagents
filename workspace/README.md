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

## Deploy Frontend to Vercel / Insforge

The frontend uses `output: 'standalone'` in `next.config.mjs` for Docker deployments.
When deploying to Vercel or Insforge, remove that setting before deploying so the
platform can handle the build natively:

```js
// next.config.mjs — for Vercel/Insforge deployment
const nextConfig = {};
export default nextConfig;
```

Set the environment variable `NEXT_PUBLIC_API_URL` to your backend URL (e.g. `https://agents-api.caremojo.app`).

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
