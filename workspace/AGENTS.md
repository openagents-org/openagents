# Workspace development and deployment

Preview at workspace-preview.openagents.org follows `develop` and has its own frontend, backend, PostgreSQL database and file storage on droplet 164.92.127.159. The user authorized this isolation and automated preview database migrations on October 26, 2026.

- Merge preview work into `develop`; the droplet’s `openagents-preview-develop.timer` checks the public branch every two minutes, builds both images from the same commit and deploys the isolated stack automatically. Production continues to follow `release` through the existing promotion workflow.
- Preview's active configuration lives at `/opt/openagents-preview-isolated/`. Its database is `openagents_preview` on the private Compose `postgres` service, with a dedicated named volume. Files use a separate local volume. Never configure preview to use production database or storage credentials.
- Preview migrations are permitted only after the deployment guard validates that local database target, and after a local backup. Deployments stop app writers for migrations and restore the local backup and previous images on failure.
- Production schema changes, migrations, backfills, bulk repair or database infrastructure changes still require explaining the proposed change and waiting for the user's agreement. Preview authorization does not authorize production changes.
- Secrets stay in root-only files on the host. The tracker reads public Git without a repository token; never print or commit secrets.
- The previous shared-production-data stack at `/opt/openagents-preview/` is retained stopped for recovery. Do not start it or use its `production-beta.env` for preview.
- See `docs/preview-environment.md` and `operations/preview/` for setup, deployment and recovery.
