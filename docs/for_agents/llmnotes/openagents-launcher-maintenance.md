# OpenAgents Launcher — development and maintenance

Reviewed 2026-10-26 against repository release `5409a710a`. This supersedes the
July session notes. Source paths are repository-relative. Workspace v1.1,
launcher package versions and connector npm versions are separate release tracks.

## Architecture and source locations

- `packages/launcher/`: Electron desktop application, React/TypeScript renderer,
  electron-vite build, Zustand state and Tailwind styling. Read `package.json`
  for current dependency versions rather than pinning them in these notes.
- `packages/agent-connector/`: the `agn` CLI, daemon, agent adapters and installation
  logic. The launcher depends on a specific published connector version.
- `workspace/frontend/`: shared Workspace UI. The launcher bundles its desktop
  build and hosts workspace views through `src/main/workspace-bundle.ts`,
  `workspace-host.ts` and the workspace-view modules. Backend/UI work can therefore
  affect both the web app and desktop distribution.
- Website download routing lives in the separate `openagents-web` repository.
  Locate that repository through the current workspace configuration, not a
  particular developer's home or Conda directory.

The supported local-agent flow is device pairing followed by creating/configuring
agents and binding them to a paired workspace. v1.1 device ownership, private
agents and resource grants apply in desktop too. Do not restore old raw-token
connection instructions or assume a signed-in administrator can read all private
content. See [Workspace notes](openagents-workspace.md).

## Build and verification

From `packages/launcher`, use the scripts defined by the target commit:

```bash
npm run typecheck
npm test
npm run check:changelog
npm run build
```

Install the launcher and Workspace frontend dependencies as the current workflows
specify. `npm run build` builds and validates the Workspace desktop bundle before
building Electron. Running only `electron-vite build` is insufficient when the
bundled Workspace UI also changed. The bundle becomes an installer extra resource.

The `Workspace Desktop Bundle` workflow checks affected pull requests. GUI E2E is
implemented in `packages/launcher/e2e/`; see the
[testing guide](launcher-automatic-testing-plan.md). Do not infer that every test
runs on every PR, or that an old test count describes current coverage.

## Release tracks

- Workspace backend: merge into `develop`, then use the protected promotion
  workflow to advance `release`; DigitalOcean performs the backend rollout.
- Launcher installers: `.github/workflows/desktop-build.yml` responds to
  `launcher-v*` / `desktop-v*` tags and manual dispatch. Creating an installer tag
  is separate from deploying the hosted Workspace UI/backend.
- Connector npm package: `.github/workflows/agent-connector.yml` tests and publishes
  eligible `develop` builds using npm trusted publishing. An already-published
  version is skipped; publishing requires a new version. Installed daemons need
  their own update to receive adapter changes.

For an authorized launcher release:

1. Select a reviewed commit; keep the launcher package version and release tag in
   agreement. Confirm the bundled connector version and Workspace desktop build.
2. Add the matching `packages/launcher/changelog/<version>.json` and run the
   changelog check. The release workflow validates launcher release notes and
   publishes them for the updater as well as bundling them in the app.
3. Push the reviewed release tag through the repository's normal workflow.
4. Complete required Windows signing approval in the configured SignPath portal.
5. Verify build/signing results, published installer bytes, update metadata,
   blockmaps, release notes and the distribution feed.

Use the configured authenticated Git remote or credential helper. Never put an
expanded access token in a remote URL, shell command, documentation or logs. Do
not prescribe a developer's SSH key or account. For a published release fix,
prefer a new version; do not casually delete or move a published tag.

## Signing and update integrity

Windows signing uses the SignPath GitHub integration and the configured production
policy. Manual dispatch has a signing option; tagged releases use the production
signing path and its approval. Read current workflow settings for organization,
project, policy and timeout values; do not copy operator names or organization
identifiers into generic maintenance instructions.

The artifact configuration is tracked at
`packages/launcher/signpath/artifact-config.xml`. The GitHub artifact is a ZIP;
rules must cover all intended EXE/MSI files. Signing changes installer bytes, so
hashes, sizes and blockmaps must describe the signed artifacts. Do not reuse
unsigned metadata or select an arbitrary EXE when there are several installers.

macOS signing/notarization is configured in the build workflow and package build
settings, with credentials injected through CI. macOS update ZIPs must preserve
framework symlinks. Verify the actual final artifacts rather than assuming that
successful packaging alone proves signing or update integrity.

## Distribution

GitHub Releases is the canonical installer source. The release workflow also
contains a best-effort Cloudflare R2 mirror and stable update-channel sync;
`https://dl.openagents.org/launcher/stable` is the launcher's configured generic
update feed. Release notes and differential-update artifacts are part of that
publication path. The old proposal to add a download mirror is no longer a
statement of missing implementation.

The website download API is maintained in `openagents-web`; inspect that repository
for its current mirror/fallback behavior. When diagnosing a release, distinguish
canonical GitHub assets, mirror availability/cache state, stable-feed metadata,
website redirects and the version a client has already installed.

## Registry and UI maintenance

`registry/` is the source of truth for agent metadata; `cloud_providers/` contains
provider metadata. `scripts/sync-registry.js` generates the connector/backend
copies. Edit sources, then run:

```bash
node scripts/sync-registry.js
node scripts/sync-registry.js --check
```

Inspect pending changes before regenerating so unrelated local edits are not
lost. Icon handling intentionally preserves existing UI-specific variants; inspect
the script and relevant icon components before overwriting artwork. Do not
hand-maintain divergent catalog lists or rely on an old seven-agent product list.

Historical statements such as “hide Chat,” “all skills always on,” or “unused code
is acceptable” were decisions from a past session, not standing project policy.
Use the current user request, repository instructions and implementation instead.
