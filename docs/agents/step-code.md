# Step Code

[Step Code](https://github.com/stepfun-ai/Step-Code) — StepFun's terminal
coding agent, binary `step` — run as an OpenAgents agent (type `step-code`).
It is StepFun's build of the [Pi](https://pi.dev) runtime, so its headless
JSON stream is Pi's.

Everything below was verified against `step` 0.1.5 on Linux, end to end with a
mainland Step Platform key (`step-3.5-flash`); the adapter's flags and
isolation were also checked on 0.1.4, the supported floor — the first release
with the Full Access tier. Windows is not verified yet.

## Installing

| | Command | Lands in |
|---|---|---|
| macOS / Linux | `curl -fsSL https://static-openapi.stepfun.com/stepcode/install.sh \| bash` | `~/.stepcode/bin/step` |
| Windows | `irm https://static-openapi.stepfun.com/stepcode/install.ps1 \| iex` | `%USERPROFILE%\.stepcode\bin\step.exe` |

A native (Bun-compiled) binary; no Node needed. Both scripts also put fd and
ripgrep in `~/.stepcode/agent/bin`, and add the bin directories to PATH —
install.sh through the login shell's rc file (`STEP_NO_MODIFY_PATH=1` skips
that, `STEP_INSTALL_DIR` moves the binary), install.ps1 through the user `Path`
registry value (always). Releases from 0.1.0 on stay downloadable;
`step update` upgrades in place.

`step` is also the name of Smallstep's certificate CLI, which a PATH lookup can
find first. The registry entry opts into `install.identify`:

```json
"identify": {
  "install_dirs": ["$STEP_INSTALL_DIR", "~/.stepcode/bin"],
  "version_pattern": "^v?\\d+\\.\\d+\\.\\d+$"
}
```

Installer detection (`Installer._whichBinary`, which the launcher's install
check, sign-in and status probe all go through) takes a copy in those dirs
first, and accepts a `step` found anywhere else only when `--version` prints a
bare version (Smallstep prints `Smallstep CLI/0.28.7 (linux/amd64)`). The
adapter reads the same block through the same helpers (`binary-identity.js`).
No other agent sets the option, and their detection order is unchanged.

On Windows the launcher runs install.ps1 in its own PowerShell environment
(as for Hermes): it verifies the download with `Get-FileHash` and unpacks it
with `Expand-Archive`, which do not load under a PSModulePath inherited from
PowerShell 7.

## Signing in

Either path works, and the agent form takes both:

- **Step Plan (browser sign-in)** — `step login` in a terminal. It is a
  full-screen picker (Step Plan or Step Plan Oversea, or a Step Platform key)
  and refuses to run without a TTY, so the launcher opens a terminal. The
  credential and the chosen region are kept in `~/.stepcode/auth.json`, and the
  region decides the endpoint (`api.stepfun.com/step_plan` or
  `api.stepfun.ai/step_plan`).
- **Step Platform API key** — `STEP_API_KEY`, from
  [platform.stepfun.com/interface-key](https://platform.stepfun.com/interface-key)
  (mainland China) or [platform.stepfun.ai/interface-key](https://platform.stepfun.ai/interface-key)
  (international). A key works only in its own region, so `STEP_BASE_URL` must
  match: `https://api.stepfun.com/v1` (the form's default) or
  `https://api.stepfun.ai/v1`. Any OpenAI-compatible endpoint that serves
  `/v1/models` and `/v1/chat/completions` works as well (0.1.5's built-in
  provider speaks that protocol).

Readiness comes from `step login status --json` —
`{"loggedIn":true,"loginMethod":"step_plan","validity":"valid"}`, exit 0 either
way. It checks the credential against the model list, so a sign-in that has
expired shows `"validity":"invalid"`.

Models are listed from the endpoint with a key, and by `step --list-models`
for a sign-in. The launcher's picker keeps only the endpoint's entries typed
`大语言模型` (LLM) or `路由模型` (router) — api.stepfun.com lists 33 models, most
of them speech and realtime ones — as the CLI does; an untyped list, or one the
filter would empty, is shown whole. Any model name can still be typed in.

## What the adapter does

```
step -p [--plan] --mode json --session-dir <dir> --session-id <uuid> \
  --no-approve --no-update-check \
  --non-interactive-approval allow \
  --exclude-tools clarify_user,enter_plan_mode,exit_plan_mode[,search_web] \
  [--model <id>] --append-system-prompt <briefing>
```

One process per message, prompt over stdin (`--plan`, an extension flag, would
otherwise swallow the next bare word as its value — `--plan "say hi"` runs
nothing). The session id is chosen by the adapter; `--session-id` creates the
session on the first turn and resumes it on the next. Transcripts are kept in
one directory per agent, and a session is only resumed from the working
directory it started in.

The workspace tools come from MCP. Step names an MCP tool `<server>__<tool>`,
so the server is declared as `mcp__openagents-workspace`, which makes the tools
come out exactly as Claude Code names them — and the Claude briefing applies
as is.

Permissions: execute mode runs on the Full Access tier, as the other CLI agents
run with their skip-permissions flags — dangerous commands (`rm -rf`, …) run
too. Full Access needs a one-time risk acknowledgment, which a headless run
cannot give (the CLI falls back to Approve for Me without it), so
`fullAccessAcknowledged = true` is written into the run's private
`config.toml`; the user's `~/.stepcode/config.toml` is never written. Plan mode
runs on Approve for Me, where the dangerous-command rules refuse, and
`STEP_NON_INTERACTIVE_DENIAL=continue` turns a refusal into a failed tool
result the model can work around instead of ending the run.
`--non-interactive-approval allow` keeps MCP calls unattended either way.

Plan mode is `--plan`. It is state of the session, not of the run: a session
started with `--plan` is still in plan mode on the next run without it. The
stream reports every change (a `step-plan` entry), so when a channel is back in
execute mode on a session still in plan mode, the adapter first sends `/plan` —
a command the CLI handles itself, without a model call. `exit_plan_mode` is
excluded: headless, it exits plan mode on its own, and the run would go on to
edit.

## Keeping the user's setup out of the run

The CLI reads `config.toml`, `auth.json` and `models.json` from the parent of
its agent directory. The adapter points `STEP_CODING_AGENT_DIR` at a directory
of its own per channel (`~/.openagents/step-code/<ws>_<agent>/channels/<id>/agent`)
and writes that parent's `config.toml` for each run (0600, removed after the
run):

| From the user's setup | Kept out by |
|---|---|
| A saved credential in `~/.stepcode/auth.json` (it outranks `STEP_API_KEY`) | the private `auth.json` (key runs); a sign-in run points `STEPCODE_AUTH_PATH` back at the user's file instead |
| `[mcp_servers]` in `~/.stepcode/config.toml` — also the ones imported from Claude Code / Codex | the private `config.toml` |
| `defaultModel` / `defaultProvider`, `models.json` | the private root, and `--model` |
| User plugins (MCP servers, skills) | `STEPCODE_STORAGE_ROOT_DIR` of our own |
| The built-in StepPage plugin (13 site-deploy tools) | `[mcp_servers.steppage__steppage] enabled = false` |
| Project `.stepcode/` config, extensions, plugins | `--no-approve` |
| `STEP_PROVIDER_API_URL`, `STEP_API_URL`, … in the environment (they outrank `STEP_BASE_URL`) | removed from the child's env |
| Cron, goals, workflows (they outlive the run) | `STEP_DISABLE_CRON/GOAL/SCHEDULE/WORKFLOW=1` |

Left as the user has them: project instructions (per directory, the first of
`AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`) and skills. Skills load from
`~/.stepcode/skills`, `~/.agents/skills` and `~/.claude/skills` — the CLI reads
those from HOME. Three sources do not reach an agent run, because they live in
the user's agent directory, config or plugin store: `~/.stepcode/agent/skills`,
paths listed under `skills = [...]` in `~/.stepcode/config.toml`, and skills
that come with a plugin. Project-level skills stay out with the rest of the
untrusted project (`--no-approve`), as in a plain `step -p` run.

Carried over from the user's `config.toml`: a `[telemetry] enabled = false`
opt-out and `shellPath`. The installer's fd/rg directory goes first on PATH —
without it the CLI downloads both from GitHub into the private agent directory.

With a key, the CLI's own `search_web` tool is given the same key and its
region's search endpoint; for a non-StepFun base URL it is excluded.

## Side effects

- **The project directory** gets nothing: plans go to
  `STEP_CODING_AGENT_PLAN_DIR` (ours), transcripts to `--session-dir`.
  Releases before 0.1.3 ignore that variable and write
  `<project>/.stepcode/plans/` — hence the floor.
- **Shell rc files, git ignore**: untouched by a headless run (verified).
  Only install.sh and an interactive `step` edit the rc file.
- **Background commands** (`run_in_background`) log to the system temp dir and
  end with the run.
- `step --version` starts the whole runtime (~1s) and writes telemetry; the
  adapter runs it on a private directory with telemetry off, every 5 minutes at
  most.

## Stopping a run

SIGTERM ends the CLI in ~0.1s, and it takes its shell commands and subagents
along. It does not take an MCP server that is still in its handshake (or one
that ignores the end of its stdin), and SIGKILL leaves the shell commands, which
run in sessions of their own. Stop therefore reads the process table while the
CLI is alive and signals every descendant (Windows: `taskkill /T /F`).

The idle watchdog (5 minutes without output) pauses while a tool call is out.

## Failure shapes

| Situation | What the CLI does | Adapter reports |
|---|---|---|
| No key, never signed in | stderr `No API key found for the selected model.`, exit 1 | sign in or set a key |
| Key rejected, or endpoint unreachable | the same line (or, with `--model`, `Error: No models available.`), exit 1 — the model list failed | asks `/v1/models` itself: 401/403 → key rejected (and which region), no answer → unreachable |
| Rejected mid-run | assistant message with `stopReason: "error"`, `errorMessage: "401: {…}"`, exit 1 | key / sign-in rejected |
| 429 / 5xx | `auto_retry_start` ×3, then `auto_retry_end` `success:false`, exit 1 | quota / server error |
| Malformed base URL | `Step API base URL must be a valid URL`, exit 1 | names the two StepFun URLs |

The CLI hands its environment to its shell commands, so `STEP_API_KEY` is
visible to `env`. Every string of every frame is redacted by value (the key,
the workspace token, and any credential-named variable in the run's
environment) before anything reaches the channel or the log.

## Testing

- `test/step-code-runtime.test.js`, `test/step-code.test.js` — unit tests, with
  a mock CLI replaying the shapes above.
- `test/step-code-install.test.js` — the Windows PowerShell isolation.
- `test/binary-identity.test.js`, and the Smallstep cases in
  `test/agent-detection-matrix.test.js` — both installed (Step Code's copy is
  found), only Smallstep's (not installed).
- `test/step-code-cli.test.js` — opt-in, against the real binary:
  `STEP_CODE_TEST_CLI=/path/to/step node --test test/step-code-cli.test.js`.
  No account and no network: the model is a local endpoint.
