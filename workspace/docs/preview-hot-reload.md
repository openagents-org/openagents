# Preview frontend deployment

Preview now serves an optimized Next.js build. The former development server
served very large uncached bundles and made workspace startup appear stuck.
Editable sources still live on the preview host, but changes require a build.

From `codex/preview`, run:

```sh
bash workspace/scripts/sync-preview-frontend.sh
```

This synchronizes frontend sources (excluding secrets, dependencies and caches),
builds a versioned image with preview-specific public configuration, checks its
login page on a loopback-only candidate port, and replaces only the frontend.
The deployed backend image, jobs and database settings are preserved. Nginx is
reloaded after replacement. Failed deployment checks restore the previous
Compose configuration from `/opt/openagents-preview/backups/frontend-<release>`.
Old images are retained for rollback. Source files deleted or renamed locally
must also be removed from the host before building.

Do not return the public preview to `next dev` or mount a development `.next`
cache into the optimized server. Local development can continue using `npm run dev`.

See [preview-production-data.md](preview-production-data.md) for backend rules:
preview shares production data, and deployments must not run migrations.
