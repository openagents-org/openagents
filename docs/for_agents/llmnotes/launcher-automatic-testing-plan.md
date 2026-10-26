# Launcher automatic testing — implemented coverage and remaining gaps

Reviewed 2026-10-26 against release `5409a710a`. The filename is retained for
existing references; this is a current testing guide, not the July spike plan.
Read executable workflow/spec behavior when older inline comments disagree.

## Current harness

`packages/launcher/e2e/` uses Playwright's Electron support to launch the built
`out/main/index.js`. It tests the source build, not a signed installer. Fixtures
create isolated temporary user profiles and application state; never clear a
real user's home directory or daemon configuration to prepare a test.

Build with the launcher's `npm run build`, which includes the Workspace desktop
bundle. `.github/actions/workspace-frontend-deps` supplies the frontend dependency
setup in CI. Test hooks and full-flow specs already exist; adding all hooks and
proving that hosted Windows can launch Electron are no longer prerequisites.

The harness combines UI actions with IPC/state checks and HTTP assertions. It is
not strictly GUI-only: some credentials are injected through IPC, pairing/config
state is inspected, and workspace APIs drive/observe messages. Keep these checks
aligned with the supported product flow rather than inventing a second setup path.

## Workflow and coverage

`.github/workflows/launcher-agent-e2e.yml` runs nightly at 07:17 UTC and through
manual dispatch. It currently has no launcher-release-tag or per-PR trigger.

- The nightly default selects codex, claude, hermes, openclaw, opencode, gemini and
  cursor on GitHub-hosted macOS and Windows, excluding Hermes on Windows.
- Manual dispatch defaults to OpenClaw and offers agent/OS selection. Explicit
  dispatch inputs and scheduled defaults differ; inspect the generated matrix.
- Cursor's keyed response flow is skipped because gateway credentials cannot
  authenticate it against Cursor's own service. Missing workspace/provider
  credentials also skip keyed tests. A green job does not mean every agent
  completed an authenticated response test.
- Jobs build from source, run Playwright, upload per-cell result rows and produce
  a daily summary artifact. Failure artifacts include traces/screenshots/video
  according to the Playwright configuration. There is no promised persistent
  public history dashboard in this workflow.
- Playwright runs serially with one worker and currently zero test retries.
  Fixture-level launch recovery is separate from test retries. Read current
  per-spec timeouts before diagnosing a slow run.

Important specs and helpers:

| File under `packages/launcher/e2e/` | Responsibility |
| --- | --- |
| `fixtures.ts` | Isolated profiles, Electron launch, usable renderer/window checks and startup recovery |
| `install.spec.ts` | Agent installation through the launcher |
| `respond.spec.ts` | Install, pair device, create/configure/bind/start an agent and assert a workspace reply |
| `workspace.ts` | Pairing and message/polling API helpers |
| `shared-agent-setup.spec.ts` | Shared setup flows |
| `workspace-onboarding.spec.ts` | Workspace onboarding |
| `workspace-appearance.spec.ts` | Workspace appearance behavior |
| `marketplace.ts` | Marketplace interactions used by the release's specs |

These describe implemented coverage, not proof that the latest CI run passed.
Inspect job artifacts, individual test results and skips for the exact commit.

## Credentials and v1.1 access

The workflow passes `E2E_WS_TOKEN`, `E2E_WS_SLUG`, per-provider `E2E_*_API_KEY`
secrets and gateway/base-URL variables. Actual provider/model mappings live in
`respond.spec.ts`; older comments and defaults in `agents.ts` are not sufficient
to determine a cell's current runtime configuration. Do not embed credential
values, personal workspace identifiers or device addresses in fixtures or notes.

The full flow pairs a device before binding an agent to its workspace. Pairing
must respect the test workspace's v1.1 ownership and access configuration.
Do not bypass authorization when a previously token-only fixture receives 401/403;
update it to use an authorized identity/credential for the operation.

A fresh local profile does not isolate remote data. API-driven tests create real
workspace resources and can start billable agent work. Use a dedicated test
workspace with intentional sharing and known cleanup behavior. Preview shares
production data; pointing the suite at preview does not make its writes disposable.

## Running and extending tests

From `packages/launcher`, after installing dependencies and building the desktop
bundle and launcher:

```bash
npx playwright test --list
npx playwright test
```

The second command launches Electron and can install software and contact the
configured workspace/providers. Supply test credentials through the approved
secret mechanism. Use `E2E_AGENT` and the workflow inputs to select the intended
scope; do not assume listing tests exercises the GUI or backend.

For changes to v1.1 flows, include owner/teammate access, private/shared agents,
paired-device persistence and supported configuration paths. Verify DOM/test IDs
against current components; old vanilla-JS selectors and past Sidebar filenames
are not authoritative. Distinguish the splash window from a usable application
window and genuine renderer stalls from network/installation delays.

The `Workspace Desktop Bundle` workflow independently checks the shared desktop
UI build on relevant PRs. Connector tests are run by `agent-connector.yml` across
its OS/Node matrix. Launcher unit tests are available through `npm test`; confirm
which workflow runs a suite before calling it a release gate.

## Remaining limitations

- Hermes/Windows is excluded and Cursor's authenticated response flow is skipped.
- Credential-dependent skips need explicit reporting when assessing coverage.
- Release-tag gating is not present in the GUI E2E workflow.
- Source-build tests do not validate signed installers, update feeds, blockmaps or
  notarization; those need the separate release checks described in the
  [maintenance guide](openagents-launcher-maintenance.md).
- Passing on a machine with warm caches or an existing provider login does not
  establish that fresh-profile onboarding works.

Historical “user decided” notes and requests for approval from the July spike are
not standing instructions. Follow the current task and repository guidance.
