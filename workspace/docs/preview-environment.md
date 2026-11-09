# Isolated preview following develop

Configured at the user's request October 26, 2026. Preview is a separate application deployment and dataset; it does not read or write production records or production file storage.

- URL: https://workspace-preview.openagents.org
- Droplet: 164.92.127.159 (4 CPUs, 8 GB RAM)
- Runtime directory: `/opt/openagents-preview-isolated/`
- Docker Compose project: `openagents-preview-isolated`
- Database: PostgreSQL 16, user/database `openagents_preview`, service hostname `postgres`, no host port
- Storage: dedicated Compose volumes `postgres_data` and `files`
- Login: same public identity provider configuration, independent workspace session-signing secret
- No production model, email, push, gateway-credit, browser-service or object-storage credentials are copied. Configure preview-specific provider credentials in `secrets/backend.env` when needed. Yumi and paid routing are disabled until preview credentials are available.
- Application background jobs are enabled against the local preview database.

## Deployment

The systemd timer `openagents-preview-tracker.timer` checks the public `develop` branch every two minutes. `Environment=PREVIEW_BRANCH=` in `openagents-preview-tracker.service` selects the branch (default `develop`). A root-owned tracker fetches the exact commit without repository credentials, builds both images on the droplet and invokes the guarded deployer. Builds have a 2.5 GB per-process memory limit and run serially with low scheduling priority. A failed commit is retried after 30 minutes, or immediately when develop changes. Existing services stay up while images build.

Manual run: `ssh root@164.92.127.159 systemctl start openagents-preview-tracker.service`.

Logs: `journalctl -u openagents-preview-tracker.service`. Status: `systemctl list-timers openagents-preview-tracker.timer`. Use `/usr/local/sbin/openagents-preview-track-branch --retry` to retry a failed build immediately.

The deployer validates the full SHA, image revision labels and local DB URL, takes a PostgreSQL dump, stops application writers, runs Alembic, starts both images, reloads nginx and checks API readiness and frontend routing. Failure restores only the isolated database and previous images. Large incoming archives retain the latest two builds; Docker images and DB backups require periodic disk-space review. Production uses its existing separate release process.

`deployed.json` records the active commit, backup and deployment time. Both image tags contain the full commit SHA. This replaces source uploads and `codex/preview` as the deployment source.

## Host setup

Copy `workspace/operations/preview/` to a root-owned staging directory and run `provision.py` as root. It generates dedicated database and signing secrets and copies only public login settings from the previous preview container. It installs root-owned tracker/deployer scripts and systemd units, retires the earlier `openagents-preview-develop` tracker and enables `openagents-preview-tracker.timer` so tracking continues without a gap. On a brand-new host, run `systemctl disable --now openagents-preview-tracker.timer` right after provisioning and re-enable it only after validating the first isolated deployment and switching the public proxy.

The first stack is validated on `127.0.0.1:8081`; then stop the legacy stack, set `PREVIEW_HTTP_BIND=0.0.0.0:80` in the root-only `.env` and recreate nginx. Keep the old config and data volumes. Never run `docker compose down -v` as part of a deployment.

## Recovery

On the droplet, inspect `/opt/openagents-preview-isolated/deployed.json`, `docker compose ps`, and `backups/`. Secrets are in `.env` and `secrets/` and must not be printed in support logs.

The deployer's rollback stops writers, clears **only the isolated preview DB's public schema**, restores its pre-deploy dump and starts the previous images. To roll back manually, stop frontend/backend, restore a chosen local dump to the local `postgres` service, restore the matching `deployment.env`, and restart services. File volumes are retained.

The old `/opt/openagents-preview/` project and its local data remain stopped for historical recovery. Its `production-beta.env` points at production: never reactivate it as an ordinary rollback.
