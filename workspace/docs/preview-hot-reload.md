# Collaboration preview hot reload

The preview at https://workspace-preview.openagents.org runs the frontend with
`next dev --webpack --hostname 0.0.0.0 --port 3000` in the existing frontend image.
Docker builds are not part of the UI iteration workflow.

After editing frontend files, run from this checkout:

```sh
bash workspace/scripts/sync-preview-frontend.sh
```

Source changes are synced to `/opt/openagents-preview/repo/workspace/frontend`
on `root@164.92.127.159`. The container mounts that directory at `/app`; dedicated
volumes preserve Linux dependencies and the development cache. Nginx forwards
the development WebSocket, so connected pages receive hot updates.

The server's `/opt/openagents-preview/docker-compose.override.yml` enables this
mode automatically. Do not run `docker compose build` for UI changes. Run focused
local checks; save production builds for explicit release checkpoints. Browser
verification is not required for routine iterations.

The sync excludes environment files, dependencies, caches, and logs. It does not
delete remote files; remove a renamed or deleted source file explicitly on the
preview as part of that change. If dependencies change, sync the lockfile, run
`docker compose exec frontend npm ci` on the server, then restart only frontend.
Backend source (`app` and `alembic`) is also mounted from the preview checkout.
For backend edits, sync only the changed source files, run focused tests in an
isolated container, apply any migration with the existing image, then recreate
only backend using `docker compose up -d --no-deps --no-build backend` and reload
nginx. No Docker build is needed for source-only backend changes either.

The existing production image is retained. To return to it, move the override
file aside, recreate frontend with `docker compose up -d --no-deps --no-build
frontend`, and reload nginx. Configuration backups are under
`/opt/openagents-preview/backups`.
