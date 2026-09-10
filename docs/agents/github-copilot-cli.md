# GitHub Copilot CLI

OpenAgents supports GitHub's **official Copilot CLI** — the standalone
executable `copilot`, distributed as the npm package
[`@github/copilot`](https://www.npmjs.com/package/@github/copilot).

> **This is not the retired `gh copilot` extension.** The old
> `gh extension install github/gh-copilot` flow (binary `gh`, subcommand
> `gh copilot`) is deprecated. OpenAgents detects and launches the `copilot`
> executable only and never invokes `gh`.

- **Internal agent id:** `copilot`
- **User-facing name:** GitHub Copilot CLI
- **Adapter:** `packages/agent-connector/src/adapters/copilot.js`
- **Stream parser:** `packages/agent-connector/src/adapters/copilot-stream-parser.js`

---

## Installation

Install from any official source — OpenAgents auto-detects the `copilot`
executable regardless of how it got there:

| Method | Command | Notes |
|--------|---------|-------|
| npm (default) | `npm install -g @github/copilot` | Requires Node.js. This is what the launcher's installer runs. |
| Homebrew | `brew install copilot` *(if/when published)* | No Node.js requirement. |
| WinGet | `winget install GitHub.Copilot` *(if/when published)* | No Node.js requirement; resolves via `%LOCALAPPDATA%\Microsoft\WinGet\Links`. |
| Standalone binary | per GitHub's instructions | No Node.js requirement. |

The **npm** path requires Node.js. Homebrew / WinGet / standalone-binary
installs do **not** require Node.js, and OpenAgents does not force a Node.js
requirement on those — only the npm install command is Node-gated.

### Detection details

- OpenAgents looks for `copilot` (`copilot.cmd` / `copilot.exe` on Windows)
  across: the isolated runtime prefix (`~/.openagents/runtimes/copilot`), the
  enriched `PATH`, the npm global prefix, and common install locations
  (Homebrew, `~/.local/bin`, WinGet Links).
- An install **marker** is written only after a successful install and never
  overrides real binary detection.
- A binary on `PATH` always wins over a stale marker.

---

## Minimum supported version

**`1.0.0`** — declared in `registry.json` (`install.min_version`), mirrored in
the adapter (`CopilotAdapter.MIN_VERSION`) and asserted equal by a test.

**Basis.** The adapter requires `--output-format=json` (JSONL) — which per
GitHub's investigation was introduced in `0.0.422` — plus non-interactive `-p`
with `--no-ask-user`, granular `--allow-tool`/`--add-dir`, `--resume`/`--name`
session control, and `--secret-env-vars`/`--no-remote`. Per the spec
("采用所有必需能力中的最高版本"), the floor is the **GA 1.0 line**, which is the
first release series where the full set is present and stable and the documented
CLI Reference applies. The integration was **verified end-to-end against
`1.0.63`** (the current `latest`; published range is `0.0.326` … `1.0.63`).

> The gate is generic — any registry entry may declare `install.min_version`
> (see `packages/agent-connector/src/installer.js`). If GitHub's changelog later
> pins an exact earlier 0.0.x build that has *all* required flags, lower this one
> field (and the adapter constant) accordingly.

Two enforcement points share the same floor:
- **`installer.healthCheck('copilot')`** for the launcher UI (table below).
- **`CopilotAdapter._checkVersionGate()`** runs `copilot --version` before
  spawning a turn and refuses (with an upgrade message) when below the floor, so
  an old CLI never gets a turn that would fail with `unknown option`.

Health-check behaviour (`installer.healthCheck('copilot')`):

| Detected version | `installed` | `compatible` | `ready` | Behaviour |
|------------------|-------------|--------------|---------|-----------|
| ≥ `min_version`  | `true` | `true` | per auth | Normal. |
| < `min_version`  | `true` | `false` | `false` | **Launch blocked**, upgrade prompt. Never shown as "not installed". |
| unparseable      | `true` | `null` (unknown) | per auth | Not blocked, not falsely "compatible". |
| not found        | `false` | `null` | `false` | Offer install. |

Version results are cached briefly and the cache is cleared on
install/uninstall.

---

## Authentication

The Copilot CLI authenticates against **GitHub**, not an OpenAgents-collected
API key. Verified token precedence (from `copilot login --help` /
`copilot help environment`, v1.0.63):

1. `COPILOT_GITHUB_TOKEN`
2. `GH_TOKEN`
3. `GITHUB_TOKEN`

If none is set, the CLI uses a token from a prior `copilot` `/login` (stored in
the **system credential store**, else plaintext under `~/.copilot/`), or a
`gh auth` session. **Supported token types:** fine-grained v2 PATs
(`github_pat_…`) with the **"Copilot Requests"** permission, OAuth tokens from
the Copilot CLI app, and OAuth tokens from `gh`. **Classic `ghp_` PATs are NOT
supported.** GitHub Enterprise (data residency): `GH_HOST` / `COPILOT_GH_HOST`
or `copilot login --host`. BYOK custom providers: `COPILOT_PROVIDER_*`.

You can either:

- **Sign in interactively:** run `copilot` once and use `/login` (browser device
  flow), **or**
- **Provide a token:** set `COPILOT_GITHUB_TOKEN` (the launcher offers an
  optional, password-masked field for this).

### How OpenAgents reports auth state (`auth_status`)

There is **no side-effect-free, non-interactive "am I authed?" command**
(verified: an unauthenticated `-p … --output-format json` run prints the auth
error to **stderr**, leaves stdout empty, and exits 1). So OpenAgents reports a
four-state `auth_status` rather than a binary verdict:

| `auth_status` | Meaning |
|---------------|---------|
| `ready` | A token env var is present (positive signal). |
| `unknown` | No token env var detected — but you may already be signed in via `copilot` /login, the keychain, or `gh`. **Not** a claim of "no credentials**; does **not** block a launch attempt. |
| `no_credentials` | (Other agents) creds definitively absent. |
| — incompatible — | Version below the floor (separate `compatible:false`). |

Copilot is marked `unverifiable` in the registry, so absence of a token yields
`unknown`, never a false "not signed in". The **final authority is the CLI's own
run result** — auth/authorization failures are classified from live stderr (see
[Common errors](#common-errors)).

### The launcher's own sign-in probe

The registry flag above is about the **core**, which has no per-platform creds
path for Copilot. The **launcher** does have one, so a sign-in completed in the
terminal flips the agent to Ready without the user confirming anything.

It reads `~/.copilot/config.json`, which the CLI maintains itself and where a
completed login records `loggedInUsers: [{ host, login }]` (plus a
`lastLoggedInUser`). This is an **identity list, not a credential** — the token
is in the OS credential store, never in this file, and the probe reads nothing
out of it beyond whether the list is non-empty.

Two properties of that file are worth knowing if you touch this:

- **It is JSONC.** A two-line `//` header explains that user settings belong in
  `settings.json`. A strict `JSON.parse` throws on it, which is exactly the bug
  this probe was written against: the launcher reported "sign-in not confirmed"
  to a user the terminal had just greeted by name. `credsVerdict` now retries
  with a **string-aware** comment strip — necessary because the same file stores
  `"host": "https://github.com"`, and a naive regex would cut that value at its
  `//` and corrupt the parse it was meant to rescue.
- **The field is an array.** `![]` is `false` in JavaScript, so an empty list
  would have read as *signed in*. Empty containers now count as no value.

There is deliberately **no host guard**. Entries carry a `host`, so a GHE
(`GH_HOST` / `COPILOT_GH_HOST`) session for a different host is conceivable —
but that behaviour is unverified, and a guard written on a guess would report
signed-out for working setups. The milder failure is preferred: a wrong-host
session reads as signed in, and the CLI's own run result corrects it.

OpenAgents **never** reads, prints, or forwards your token: it does not run
commands that echo a token, never logs env-var values, never reads the system
keychain contents, and never sends any token to the workspace frontend.

---

## Using it in a Workspace

1. **Install** GitHub Copilot CLI from the launcher (or `npm install -g @github/copilot`).
2. **Sign in** (run `copilot`, or set `COPILOT_GITHUB_TOKEN`).
3. **Create** a "GitHub Copilot CLI" agent and pick a **project working
   directory**. The directory must exist — the agent will not silently fall
   back to another folder.
4. **Send a task** in the workspace. You'll receive real-time:
   - assistant text, thinking/status narration,
   - tool calls, shell commands (with exit codes), file edits,
   - and a single final answer per turn.
5. **Stop** a running task from the workspace at any time.

### Plan vs. Act mode

| OpenAgents mode | Copilot CLI behaviour |
|-----------------|-----------------------|
| **plan** | Launched with `--plan` — analysis/planning only; **no write tools granted**. |
| **act** (execute) | Read/write/shell granted (least-privilege), **scoped to the working directory** via `--add-dir`. |

### Permissions actually granted

- Filesystem access is **scoped to the working directory** (`--add-dir <wd>`).
  We do **not** pass `--allow-all-paths`.
- Interactive prompts are disabled (`--no-ask-user`) because the workspace
  cannot answer them. If the CLI still asks, the turn fails with a clear
  message instead of hanging.
- In act mode a minimal tool set is pre-authorized: `--allow-tool=shell` and
  `--allow-tool=write` (tool IDs **verified** against `copilot help permissions`,
  v1.0.63). We do **not** default to `--allow-all` / `--yolo`, nor grant
  network/URL access (`--allow-url`/`--allow-all-urls`).
- `--secret-env-vars=<names>` is passed (only when a secret var is actually set)
  so the CLI strips/redacts those env **values** from shell/MCP environments and
  its own output — in addition to OpenAgents' own redaction. Only variable
  **NAMES** are passed; **token values never enter argv**.
- Optional-value flags use the `=` form (`--allow-tool=…`, `--resume=…`,
  `--secret-env-vars=…`) as required by the CLI's argument parser.

> Tool IDs are centralized in `ACT_ALLOW_TOOLS` in the adapter. `write` = file
> create/modify; `shell` = all shell commands (Copilot also supports finer
> matchers like `shell(git:*)`).

---

## Sessions

Verified session semantics (`copilot --help`, v1.0.63):
- `-r, --resume[=value]` resumes by **session ID, task ID, ID prefix (7+ hex),
  or name** (name match is exact, case-insensitive).
- `-n, --name <name>` sets a name for a **new** session; `--session-id <uuid>`
  resumes by ID or fixes a new session's UUID.
- Session/state files live under `~/.copilot` (override: `COPILOT_HOME`).

How OpenAgents uses this:
- It persists the **real Copilot session id** emitted in the JSONL `session`
  event (per channel, under `~/.openagents/sessions/`) and resumes via
  `--resume=<id>`. It never impersonates a session with the OpenAgents agent id.
- The first turn seeds a **stable, working-directory-bound `--name`** (a hash of
  working dir + workspace + channel), so a session for one project is never
  resumed against another, and concurrent agents in the same dir don't cross
  sessions.
- A resume against a vanished session — verified real error
  `Error: No session, task, or name matched '…'` (stderr, exit 1, empty stdout) —
  is detected and transparently retried as a **fresh** session.

> **Verification status.** Session *flags* are verified against the real CLI.
> Whether a non-interactive `-p` run **emits a `session` id on stdout** could
> **not** be confirmed (no Copilot subscription in CI — auth blocks before any
> model output). If, in practice, no session id is returned, resume-by-name
> still works via the seeded `--name`; if neither proves reliable, the adapter
> degrades to **one-session-per-task** and never fakes a resumed conversation.

---

## Interrupting & cleanup

Stopping a task sends an escalating interrupt — `SIGINT` → `SIGTERM` →
`SIGKILL` — to the **whole process group** (Unix) or via `taskkill /T`
(Windows), so any shell/MCP children Copilot spawned are cleaned up too. After a
stop the thread settles to Idle/Stopped and no further messages are pushed.

---

## Security & privacy

### What OpenAgents does
- Tokens (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `GITHUB_TOKEN`, OAuth/fine-grained
  PATs), `Authorization`/`x-api-key` headers, and secret env **values** are
  **redacted** from all OpenAgents logs and diagnostics. Tool args and error
  text are redacted too.
- The **full prompt is never logged** (the spawn log shows `<prompt>`); raw JSONL
  is not dumped — unknown events log only a short redacted diagnostic.
- The prompt is a **discrete `-p` argv element, never concatenated into a shell
  string** — no command/argument injection.

### Copilot data flows you should know about
These are **Copilot CLI** behaviours, not OpenAgents'. We distinguish them
precisely rather than claiming "nothing is ever uploaded":

| Mechanism | Default | What OpenAgents does |
|-----------|---------|----------------------|
| `--share-gist` (upload session to a secret gist) | opt-in only | **Never passed.** |
| `--share[=path]` (write a session markdown file) | opt-in only | **Never passed.** |
| **Remote control** (`--remote`: drive the session from GitHub web/mobile) | CLI default unspecified | We pass **`--no-remote`** to disable it for workspace runs. |
| **Session history** stored locally under `~/.copilot` (`COPILOT_HOME`) | on | Not modified — uses your existing Copilot config. |
| **Agentic memory** (`memory`, cross-session fact recall) | on (per CLI) | Not modified — uses your existing Copilot config. |
| Telemetry / OpenTelemetry | per your Copilot config | Not enabled or configured by us. |

OpenAgents does **not** modify your global Copilot configuration. Where the CLI
supports a disable flag we use it for the run (`--no-remote`); session/memory
storage remains governed by **your** Copilot setup.

### Caveats
- A prompt passed as a process argument **may be visible to the OS process list
  / diagnostic tools** while the task runs.
- Copilot's local session history (under `~/.copilot`) **may contain prompts,
  replies, tool output, and file changes** — it is local but not OpenAgents-
  managed; clear it via Copilot if needed.

---

## Platform support

| Platform | Status |
|----------|--------|
| Linux | **Real CLI `1.0.63` verified**: install, `--version`, `--help`, `help environment/permissions`, `login --help`, and unauthenticated / invalid-token / stale-resume runs (stderr + exit codes). Adapter unit-tested with a mock CLI. A **successful task** (real subscription) was not run — see below. |
| macOS | Implemented (process-group interrupt, Homebrew detection). Real-CLI run **not** verified in this environment. |
| Windows | Implemented (`copilot.cmd`/`.exe`, npm-shim → node resolution, `taskkill /T`). Real-CLI run **not** verified in this environment. |

> Captured real-CLI output (de-identified) lives in
> `packages/agent-connector/test/fixtures/copilot-cli-real-samples.md`.

---

## Common errors

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| "GitHub Copilot CLI not found" | `copilot` not installed / not on PATH | Install via npm/Homebrew/WinGet. |
| "…is too old — upgrade…" | Below `min_version` | Upgrade the CLI. |
| "Not signed in to GitHub Copilot…" | No credentials (real: `No authentication information found`) | Run `copilot` `/login`, `gh auth login`, or set `COPILOT_GITHUB_TOKEN`. |
| "token is invalid, expired, or revoked (401)…" | Token rejected (real: `could not be validated … 401 … Bad credentials`) | Use a fine-grained token with "Copilot Requests" (classic `ghp_` not supported) or `/login`. |
| "Access denied (403)… SAML/SSO…" | SSO not authorized / insufficient scope | Authorize the org's SSO for your token. |
| "blocked by an organization/enterprise policy" | Org disabled Copilot CLI | Contact your GitHub org admin. |
| "No active GitHub Copilot subscription/seat" | No Copilot entitlement | Obtain a Copilot subscription/seat. |
| "GitHub host configuration error…" | Bad `GH_HOST`/`COPILOT_GH_HOST` | Fix the GHE data-residency hostname. |
| "Custom model provider (BYOK) is misconfigured…" | Bad `COPILOT_PROVIDER_*` | Fix provider base URL / key / type. |
| "model is unavailable" | `COPILOT_MODEL` not allowed | Clear `COPILOT_MODEL` or pick a supported model. |
| "requested interactive input…" | CLI hit an `ask_user` prompt | Re-run with a more specific task. |
| "Working directory does not exist" | Bad project path | Pick an existing directory. |

---

## Known limitations / follow-ups

- **Verified against real CLI `1.0.63`:** the full **flag set** the adapter uses
  (`-p`, `--output-format json`, `--stream`, `--model`, `--add-dir`,
  `--no-ask-user`, `--plan`, `--allow-tool=shell|write`, `--resume=`, `--name`,
  `--secret-env-vars=`, `--no-remote`), the **tool IDs** `shell`/`write`, the
  **token env vars**, and **error/stderr/exit-code behaviour** for
  unauth/invalid-token/stale-resume.
- **Success-path JSONL schema — now captured** from a live authenticated run
  (CLI **v1.0.83**), and nothing the original guess predicted was right. Real
  events are `namespace.verb` and carry their payload under **`data`**:

  | Real event | Mapped to | Field |
  |---|---|---|
  | `assistant.message_delta` | `text_delta` | `data.deltaContent` |
  | `assistant.reasoning_delta` | `reasoning` | `data.deltaContent` |
  | `result` (**flat**, not under `data`) | `done` | `sessionId`, `exitCode`, `usage` |
  | `session.usage_checkpoint`, `session.auto_mode_resolved`, `model.call_finished` | `usage` | — |

  The guessed names (`text.delta`, `message.delta`, `content_block_delta`,
  `assistant.message`, …) matched **nothing**, and the envelope was never
  unwrapped — so every answer parsed as empty and the user was told **"No
  response generated"** for turns the CLI had completed successfully
  (`"outcome":"success"`, exit 0, one premium request billed).

  `assistant.reasoning` is deliberately **not** mapped: it repeats the deltas as
  one block afterwards, and mapping both narrates the thinking twice.

  Full observed type list: `assistant.turn_start`, `assistant.reasoning_delta`,
  `assistant.reasoning`, `assistant.message_start`, `assistant.message_delta`,
  `assistant.turn_end`, `assistant.idle`, `model.call_start`,
  `model.call_finished`, `session.auto_mode_resolved`,
  `session.usage_checkpoint`, `session.tools_updated`, `session.skills_loaded`,
  `session.mcp_servers_loaded`, `session.mcp_server_status_changed`,
  `session.custom_agents_updated`, `user.message`, `result`.
- **Still NOT captured: tool / file / shell / permission events.** The captured
  turn was a plain greeting, so none appeared. The inferred names for those
  remain in the table as a net and are marked as such — an unrecognized event is
  logged and ignored, never rendered. Replace them from a real tool-using turn
  rather than adding more guesses.
- **Session id: resolved.** A non-interactive run *does* emit one — but only in
  the terminal `result` frame, with no session event earlier in the stream. The
  adapter captures it there, which is what makes `--resume` work at all.
- No Python SDK adapter ships (the Python daemon was removed; the Node.js
  agent-connector is the runtime). The Python registry entry is catalog-only.
- The launcher offers a "Login" button (it opens a terminal on the CLI, where
  `/login` is run) with the token field kept as an optional alternative — see
  `KEY_OPTIONAL_LOGIN_AGENTS` and `DUAL_LOGIN_AGENTS` in the launcher's
  `auth-specs.ts`. It reads the sign-in back off disk, so a completed login
  turns the agent Ready on its own; see the section below.
- **Copilot Free** permits auto model selection only. Leaving the model empty is
  the default on both surfaces and the adapter passes `--model` only when
  `COPILOT_MODEL` is set, so Free accounts work unchanged — but naming a
  concrete model is refused by the service. For that reason the registry's model
  list carries no `auto` entry: the workspace form already renders its own
  "Auto" option meaning *unset*, and a second `auto` that resolved to
  `--model auto` was both redundant and the choice most likely to be picked.
