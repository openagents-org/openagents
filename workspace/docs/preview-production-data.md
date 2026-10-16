# Preview with production data

Configured October 15, 2026 at the user's request.

Preview feature branch: **`codex/preview`**, based on deployed production commit `8eeea530d70c39ca67b25c12b111518330542fc4`. Put future beta work on this branch; deploying it must not update the production application.

- Preview: `https://workspace-preview.openagents.org`, host `164.92.127.159`.
- Production configuration source: the running backend on `134.199.221.208`.
- Database: managed PostgreSQL, **`openagents_workspace`**, revision **`083`** at cutover. The provider's `defaultdb` is not the application's database.
- Backend image: `openagents-backend:release-8eeea530d70c39ca67b25c12b111518330542fc4`, copied from the production host without rebuilding it.
- Frontend: existing preview development server with editable sources synchronized from `codex/preview`. Production itself is not redeployed by this switch.
- Credentials: `/opt/openagents-preview/secrets/production-beta.env`, readable only by root. Authentication and file storage configuration match production. No credentials belong in this repository.
- Background jobs and automatic migrations: disabled/absent in preview. The backend pool is capped at four connections total (two workers, two connections each, no overflow).
- Valkey: disabled in preview because the preview host cannot reach the managed endpoint. The backend supports operation without the cache. Do not open production firewall access or change cache configuration without reviewing the proposed change.
- Demo login and simulated persona services: stopped and disabled. `/demo-login` returns 404. Normal account login is required by the application's existing authentication policy.

## Daily development

Preview reads and writes **live production records and file storage**. This is not a disposable test database. Use an intentional test workspace for beta activity and avoid replaying old preview requests.

The old preview-only workspace `cef1c57a` is absent from production. Open the preview root, sign in and choose a production workspace; old preview deep links are not migrated. The previous local database and files remain available for rollback, but their demo records are not merged into production.

Frontend deployment continues to use `workspace/scripts/sync-preview-frontend.sh`. The backend no longer mounts the old branch's source directories. For backend beta work, prepare a production-compatible image, check it against the current schema and then update the pinned preview image. Do not replace it with older code just because that code starts successfully.

**Before any schema change, migration, backfill or bulk database repair, tell the user what needs changing and wait for agreement.** A routine preview deploy must never execute `alembic upgrade`, `alembic downgrade`, `create_all` or a data migration against production. Do not silently copy or change production deployment settings.

The source-controlled Compose template is [preview-production.compose.yml](../deploy/preview-production.compose.yml). On the host it is installed as `/opt/openagents-preview/docker-compose.yml`; the old override is moved into the rollback backup so it cannot reintroduce backend source mounts.

## Verification and rollback

At cutover, read-only checks confirmed schema revision `083`, TLS on the database connection, all 56 registered ORM table projections, and access to an existing stored file. The new backend reports healthy. Public HTTP checks returned 200 for the preview root and `/ready`, 401 for unauthenticated session renewal, the expected CORS origin for login requests, and 404 for `/demo-login`. These checks did not exercise an interactive account login. No database migration or data backfill was run.

Check the backend container health and `/ready` for a database connection; `/health` alone is a liveness check. Verify the root page, normal login/CORS, and file-storage access without posting messages or starting agent tasks. Read `alembic_version` to verify the schema revision; do not run Alembic to change it.

Pre-switch configuration is kept under `/opt/openagents-preview/backups/production-db-switch-20261016T052416Z/`. The local PostgreSQL and file volumes are retained. To return preview to its old data:

1. Stop the preview backend.
2. Restore the backed-up `docker-compose.yml`, `docker-compose.override.yml`, `backend.env` and `nginx.conf`.
3. Start the former backend image with `docker compose up -d --no-deps --no-build backend` after ensuring the retained local database container is running. Do not invoke the migration service.
4. Reload nginx so its backend address is resolved again. Verify readiness and the old preview workspace.
5. Leave demo-login/persona services disabled unless the user explicitly wants the old demo behavior back.

Rollback changes where preview connects. It does not undo any writes already made to production through preview. Never restore the old preview database over production.
