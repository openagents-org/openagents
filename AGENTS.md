# OpenAgents — notes for coding agents

## Branches

| Branch | What it is | What a push does |
|---|---|---|
| `develop` | The open-source, self-hostable mainline. Default branch; all normal PRs target it. | Preview at workspace-preview.openagents.org (see `workspace/AGENTS.md`); npm publish of the agent connector on version bumps. |
| `openagents-release` | Hosted openagents.org production = `develop` **plus the hosted layer** (code that only applies to the openagents.org platform). | Deploys production: DigitalOcean backend (`deploy-digitalocean.yml`) and the Vercel frontend (project `openagents-workspace`, production branch). |
| `release` | Self-hosted release track. Always a fast-forward of `develop`; each release is tagged `workspace-vX.Y.Z`. | Nothing deploys. Vercel skips it on purpose. |

Never push directly to `openagents-release` or `release`; rulesets block it.

## What belongs where

- **`develop` must stay open-source and self-hostable.** Don't add openagents.org-only features to it: analytics or tracking (PostHog, GA), the API credits campaign or pilot grants, platform growth or marketing tools, hosted-only integrations, or hardcoded openagents.org infrastructure that a self-hoster can't override.
- **Hosted-only code lives only on `openagents-release`.** Put it there with a PR whose base is `openagents-release` (merge commit, no squash). Keep hosted code in separate modules, and keep its hooks into core files small. Every `develop` change then merges into production cleanly.
- Optional third-party integrations that self-hosters can use with their own credentials stay in `develop`, gated by env vars. Example: BrowserFabric through `BROWSERFABRIC_API_KEY`, which falls back to local Playwright when unset.
- Clients (the agent connector, SDK and launcher) default to openagents.org so hosted onboarding has no setup. Every endpoint must also be overridable for self-hosting, and the override must be documented.
- Don't delete or rewrite alembic migrations on `develop`, even for removed hosted features. The chain is linear and production databases depend on it.

## Shipping to hosted production (openagents.org)

1. Merge the change into `develop`, or into `openagents-release` if it is hosted-only.
2. Check what will ship: `git log --no-merges origin/openagents-release..origin/develop`. Other agents promote too, so don't rely on what you last saw.
3. Run `gh workflow run promote-release.yml -R openagents-org/openagents` (optional `-f ref=<develop sha>`). It merges the `develop` commit into `openagents-release` and pushes with the promotion deploy key.
   - If the merge conflicts, nothing is pushed. Open a PR into `openagents-release` that merges `develop` and resolves the conflicts, then rerun.
   - The hosted-layer guard (`HOSTED_LAYER_FILES` in the workflow) fails the run if a hosted-only file would be missing from production. Don't "fix" this by editing the list unless that hosted feature is really being retired. Update the list whenever you add or retire a hosted module.
4. The push starts the DigitalOcean rollout (secondary node, then primary; see `workspace/operations/digitalocean/cd/README.md`) and the Vercel production deploy. Confirm both finished: `gh run list --workflow deploy-digitalocean.yml`, and the Vercel deployment for `openagents-release`.
5. Production schema changes, migrations, backfills and data repair need the user's explicit agreement first. Preview authorization doesn't count.

## Cutting a self-hosted release

`gh workflow run selfhost-release.yml -R openagents-org/openagents -f version=X.Y.Z` (optional `-f ref=<develop sha>`). It:

- fast-forwards `release` to that `develop` commit,
- tags `workspace-vX.Y.Z`,
- pushes `ghcr.io/openagents-org/openagents-workspace-backend:X.Y.Z` (and `:latest` unless it's a pre-release such as `1.0.0-rc.1`),
- creates a GitHub Release.

Self-hosters build the frontend from source with `workspace/docker-compose.prod.yml`, because its API URL is baked in at build time. Self-hosting docs are in `workspace/README.md`.

## Other release tracks

- Launcher installers: tag `launcher-v*` / `desktop-v*` → `desktop-build.yml`.
- Agent connector (`@openagents-org/agent-launcher` on npm): version bump merged to `develop` → `agent-connector.yml`.

## Repo conventions

- Commits must not contain `Co-Authored-By:` lines; CI rejects them.
- Push over HTTPS with `gh`; the shared SSH key can't push to this repo.
