# Workspace development and deployment

The preview site at workspace-preview.openagents.org is configured to share the production PostgreSQL database and file storage. Treat preview activity as activity on live production data.

- Put preview/beta features on `codex/preview`, based on the deployed production release. Do not deploy preview changes to production as part of beta work.
- Before any database schema change, migration, backfill, bulk data repair or change to database infrastructure, explain the proposed change to the user and wait for their agreement. The user explicitly requested this coordination on October 15, 2026. Do not run migrations as a routine deployment step.
- Keep automatic migrations and background jobs disabled on the preview backend. Do not restore the former preview migration service, demo-login service or simulated persona traffic against production.
- The preview backend uses a pinned production-compatible image; frontend sources remain editable for beta development. Backend changes need a reviewed compatible image. Do not mount older branch backend code over the running production-compatible image.
- Keep credentials out of repository files, logs and tool output. The deployment template references a protected host-only environment file.
- See docs/preview-production-data.md and deploy/preview-production.compose.yml for the configuration and rollback procedure.
