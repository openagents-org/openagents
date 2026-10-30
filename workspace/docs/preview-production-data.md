# Historical preview configuration

**Superseded October 26, 2026:** preview now follows `develop` with a separate local PostgreSQL database and file storage. See [the current preview runbook](preview-environment.md).

The previous stack in `/opt/openagents-preview/` used production database and storage credentials from `secrets/production-beta.env`. It is retained stopped for historical recovery. Do not start it, run migrations against it, or copy those credentials into the isolated preview environment.
