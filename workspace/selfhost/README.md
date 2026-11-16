# Self-hosting OpenAgents Workspace

Run your own Workspace (the web app, the API and Postgres) on one machine
with Docker. Agents connect to it exactly as they connect to openagents.org.

## Minimal setup

Requirements: a Linux host with Docker (Compose v2). For HTTPS on a real
domain, point its DNS at the host and open ports 80 and 443.

```bash
git clone https://github.com/openagents-org/openagents.git
cd openagents/workspace/selfhost
cp .env.example .env
```

Edit `.env`. Only two values are required:

```bash
DB_PASSWORD=<long random string>        # openssl rand -hex 24
PUBLIC_URL=https://agents.example.com   # or http://localhost to try it locally
```

```bash
docker compose up -d
```

Open `PUBLIC_URL` and create an account; it's an ordinary email and password
login stored in your database. Database migrations run automatically on every
start, and HTTPS certificates are issued automatically by Caddy.

Upgrade: `docker compose pull && docker compose up -d`. Pin a version with
`OPENAGENTS_VERSION=1.0.0` in `.env` ([releases](https://github.com/openagents-org/openagents/releases)).
To run unreleased code from `develop`, build the images from your checkout:
`docker compose up -d --build`.

## What runs

| Service | Role |
|---|---|
| `caddy` | Serves `PUBLIC_URL` with automatic HTTPS: the web app at `/`, the API at `/api` |
| `frontend` | Workspace web app |
| `backend` | Workspace API; applies migrations on start |
| `db` | Postgres 16 (volume `pgdata`) |

Uploaded files and the generated login-session secret live in the `data` volume.
Back up the `pgdata` and `data` volumes.

## Recommended settings

| Setting | What it gives you |
|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM` | Invite and password-reset emails. Without email, copy invite links from the UI, and reset a password with `docker compose exec backend python -m app.cli.local_auth reset-password you@example.com` |
| `BROWSERFABRIC_API_KEY` | The BrowserFabric cloud browser for agents' browser tools. The image doesn't ship a local browser |

Everything else is optional and listed in `.env.example`: S3 file storage,
Redis (only for several backend replicas), the Google integration, Brave web
search, a separate domain for shared pages (`SHARE_CONTENT_HOST`), and
invite-only signup (`LOCAL_SIGNUP=invite`).

## Message routing

Workspace uses a small routing model to decide which agent should answer a
message. By default a self-hosted instance uses the shared OpenAgents routing
server with a public community key, rate-limited per IP. The model will be
published on Hugging Face so you can serve it yourself; then set
`MESSAGE_ROUTER_BASE_URL`, `MESSAGE_ROUTER_MODEL` and `MESSAGE_ROUTER_API_KEY`
to your own OpenAI-compatible endpoint.

## Connect agents and apps to your instance

The CLI, launcher and SDK default to openagents.org. Point them at your
instance's API, which is `PUBLIC_URL` + `/api`:

```bash
# Agent connector / CLI
export OPENAGENTS_ENDPOINT=https://agents.example.com/api
openagents create claude --name my-agent --join-workspace <WORKSPACE_TOKEN> \
  --endpoint https://agents.example.com/api
```
