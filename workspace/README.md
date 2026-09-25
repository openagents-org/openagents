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
| `AUTH_MODE` | `workspace_token` | Human auth mode: `workspace_token`, `firebase`, or `oidc` |
| `IDENTITY_MODE` | `standalone` | Agent identity: `standalone` or `shared` |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `AGENT_TIMEOUT_SECONDS` | `60` | Seconds before agent is considered offline |

`AUTH_MODE=oidc` rejects wildcard CORS. Set `CORS_ORIGINS` to the exact frontend origin before enabling OIDC. `OIDC_ALLOW_INSECURE_HTTP=true` is intended only for loopback development; production must leave it false.

## Authentication modes

Workspace keeps human login separate from agent and workspace machine credentials.

1. `workspace_token` is the original self-hosted mode. Workspace and per-node tokens continue to work without a human identity provider.
2. `firebase` keeps the existing hosted Google/Firebase login and `POST /v1/auth/session` handoff. Existing Firebase deployments do not need OIDC settings or a Firebase configuration change.
3. `oidc` adds standards-compliant browser login for self-hosted human users. The backend uses Authlib discovery and Authorization Code Flow with PKCE; the provider must expose compatible discovery, authorization, token, userinfo, and JWKS endpoints, and must provide the configured email claim.

OIDC identity is keyed by the exact issuer and `sub` claim. The email claim is required for this first slice; email-less accounts and explicit account linking are out of scope. A new OIDC subject with an email that already belongs to another account is rejected rather than silently linked, except when that address belongs to an unclaimed invitation placeholder. After authentication, the existing `User` and `WorkspaceMembership` role checks apply; this contribution does not map provider groups to roles.

`OIDC_REQUIRE_EMAIL_VERIFICATION=true` is the secure default for email-bound invitations. Some providers, including common Microsoft Entra configurations, omit the optional `email_verified` claim; only set it to `false` when the operator has independently established that the configured issuer's signed email claim is trustworthy.

### OIDC configuration

Set these only on the backend. Never put `OIDC_CLIENT_SECRET` in a `NEXT_PUBLIC_*` variable:

```dotenv
AUTH_MODE=oidc
OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
OIDC_CLIENT_ID=<application-client-id>
OIDC_CLIENT_SECRET=<client-secret>
OIDC_SCOPES=openid profile email
OIDC_EMAIL_CLAIM=email
OIDC_NAME_CLAIM=name
OIDC_REQUIRE_EMAIL_VERIFICATION=true
OIDC_REDIRECT_URI=https://api.example.com/v1/auth/oidc/callback
WORKSPACE_SESSION_SECRET=<long-random-secret>
FRONTEND_BASE_URL=https://workspace.example.com
PUBLIC_API_BASE=https://api.example.com
CORS_ORIGINS=https://workspace.example.com
```

Register the exact `OIDC_REDIRECT_URI` with the provider. The frontend obtains public auth capabilities from `GET /v1/auth/config`; it does not receive the client secret. The callback sets an HttpOnly, Secure, SameSite=Lax browser session cookie. OIDC API calls use that cookie through the backend middleware; the local session JWT is never returned to JavaScript or browser storage. SameSite=Lax assumes the frontend and API share a site-compatible origin; cross-site deployments need a separate deployment design. OIDC mode requires an explicit non-wildcard `CORS_ORIGINS` value containing `FRONTEND_BASE_URL`, and production deployments must use HTTPS. Logout clears the local cookie and follows the provider's discovered end-session endpoint when one is advertised; this first slice does not send `id_token_hint` or otherwise guarantee upstream provider-session termination.

Provider interoperability is not certified by the unit tests. Validate discovery, claim mapping, and logout behavior against the selected provider before production rollout.

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
