# MiMo Code

Xiaomi's terminal coding agent, run headless by the OpenAgents daemon.

- Registry entry: `registry/mimo-code.json`
- Adapter: `packages/agent-connector/src/adapters/mimo-code.js` (extends `opencode.js`), with its pure helpers in `mimo-code-runtime.js`
- Project: https://github.com/XiaomiMiMo/MiMo-Code

## What it is

MiMo Code is a fork of OpenCode. `mimo run --format json` streams OpenCode's
JSON events (`step_start`, `text`, `tool_use`, `step_finish`, `error`) and
`--session` resumes a session, so the adapter reuses OpenCodeAdapter for stream
parsing and the failure taxonomy, and overrides how the CLI is found,
configured, stopped and how its failures are read.

Checked against CLI 0.1.14 and 0.1.15 (Linux x64) — the only two releases the
download server still serves. 0.1.14 is the registry's `min_version`.

## Install

Xiaomi's own script, not npm:

| Platform | Command |
|---|---|
| macOS / Linux | `curl -fsSL https://mimo.xiaomi.com/install \| bash` |
| Windows | `irm https://mimo.xiaomi.com/install.ps1 \| iex` |

Both install one native binary (Bun-compiled, ~135 MB):

| Platform | Location |
|---|---|
| macOS / Linux | `~/.mimocode/bin/mimo` |
| Windows | `%USERPROFILE%\.mimocode\bin\mimo.exe`, or `%MIMOCODE_INSTALL_DIR%\mimo.exe` when that is set |

The scripts reach PATH through a shell rc edit or the user `Path` value, which
an already-running app never sees, so `paths.js` lists both directories. The
binary is spawned directly; there is no wrapper.

The first command on a machine migrates MiMo's database and imports the user's
Claude Code transcripts (`~/.claude/projects`) into it — about a minute for
~1,600 transcripts. Later runs rescan quickly.

## Configuration

| Variable | Required | Meaning |
|---|---|---|
| `LLM_API_KEY` | yes | A MiMo API key (https://platform.xiaomimimo.com), a MiMo Token Plan key, or a key for the endpoint below |
| `LLM_BASE_URL` | yes, prefilled | `https://api.xiaomimimo.com/v1`. Token Plan: `https://token-plan-cn.xiaomimimo.com/v1` (also `-ams`, `-sgp`). Any OpenAI-compatible endpoint works. |
| `LLM_MODEL` | yes | Model id, e.g. `mimo-v2.5-pro`; sent upstream as written, a gateway's `vendor/model` ids included |

The workspace's model choice, when set, replaces `LLM_MODEL`.

- A MiMo endpoint (any `*.xiaomimimo.com` host) runs on MiMo's built-in
  `xiaomi` provider with this key and base URL, which keeps what MiMo's catalog
  knows about each model (context window, reasoning round-trip). With no model
  set it uses `mimo-v2.5-pro`, the model MiMo selects after a sign-in.
- Any other endpoint is declared for the run as an `@ai-sdk/openai-compatible`
  provider named `openagents`; a model is required.

With no key, the run uses MiMo Code's own credential — a Xiaomi-account sign-in
(`mimo providers login`, which stores a key under `xiaomi` in
`~/.local/share/mimocode/auth.json`) or `XIAOMI_API_KEY`. The launcher has no
sign-in button or probe for this; it is there for people who already use MiMo.

## How a message runs

```
mimo run --format json --dangerously-skip-permissions --dir <workdir> --model <provider>/<model>
         [--title "OpenAgents - <channel>" | --session <id>] [--agent plan]
```

Environment:

| Variable | Why |
|---|---|
| `MIMOCODE_CONFIG_CONTENT` | The run's config (below). MiMo loads it after the user's global and project config and removes it from the environment of the commands its tools run |
| `MIMOCODE_EXPERIMENTAL_CRON=0` | A one-shot run cannot fire a schedule; with the scheduler on, MiMo creates `.mimocode/` in the project and the next run installs its plugin package there |
| `MIMOCODE_DISABLE_AUTOUPDATE=1` | A run does not replace the binary |

`LLM_API_KEY` itself is removed from the CLI's environment: the key travels in
the config, where the model's shell commands cannot print it.

The config:

- `provider` — the key and base URL as configured (key mode only).
- `enabled_providers: [<that provider>]`, `disabled_providers: []`, and
  `model`, `small_model`, `model_groups.{lite,standard,ultra}` and
  `agent.{general,explore}.model` all set to the run's model. Without this the
  user's own MiMo config reroutes parts of a run under the user's own keys: a
  `small_model` received the first message of every session for titling, and
  a subagent ran on the user's `agent.general.model`. Providers MiMo picks up
  from the environment (`DASHSCOPE_API_KEY`, `XIAOMI_API_KEY`, …) or auth.json
  are likewise switched off. `test/mimo-code-cli.test.js` reproduces both
  against a real CLI.
- `mcp.openagents-workspace` — the workspace MCP server
  (`agent-connector mcp-server`), its token in the server's own environment.
  MiMo names its tools `openagents-workspace_<tool>`.
- `instructions: [<briefing file>]` — the workspace briefing, rewritten before
  every run under `~/.openagents/agents/<agent>/mimo-code/`. MiMo puts it in
  the system prompt each turn, so mode changes and pinned decisions are
  current; it holds no key or token. MiMo concatenates `instructions` with the
  user's own.

Nothing is written into the project or into the user's MiMo config.

- The prompt goes on stdin. `run` reads stdin to EOF whenever it is not a TTY,
  so it is always closed.
- `--dangerously-skip-permissions`: a permission MiMo would ask for (writing
  outside the project, for one) is otherwise refused on the spot and the turn
  ends with no reply. The daemon is the approval boundary, as for every other
  agent here. Plan mode uses MiMo's `plan` agent, whose edit ban is a hard
  permission the bypass does not lift.
- `--title` on a new session saves a request: without it MiMo asks the model to
  title the session, sending it the first message a second time.
- The session id is stored per channel as soon as the stream names it, so a
  stopped turn's session is resumed by the next message.

## Stop

MiMo has no signal handling: SIGINT or SIGTERM ends it at once. Each shell
command its tools start runs in a session of its own, outside the CLI's process
group, so signalling the group leaves those commands running. Stop therefore
reads the process tree first (`ps -A -o pid=,ppid=,pgid=`), then signals the
CLI's group and every descendant's group — SIGTERM, then SIGKILL after 1.5 s.
On Windows `taskkill /T /F` is run straight away, while the CLI is still alive
to walk the tree from.

A stopped session resumes; its first event is the interrupted tool call with
status `error`.

## Failures

Nearly everything exits 0:

| Situation | What the CLI does | Category |
|---|---|---|
| Key rejected (401) | `error` event on stdout | `auth_failed` |
| Model MiMo's API does not serve | HTTP 400 `Unsupported model <id>`, an `error` event at once | `model_not_found` |
| Unknown model on another endpoint (404) | retries for about three minutes, then an `error` event | `model_not_found` |
| Server error (5xx) | retries without end, nothing on stdout | `timeout` (idle watchdog, 5 min) |
| No credential | stderr `error: MiMo free API service has ended. Sign in or configure a third-party API.` | `credential_missing` |
| `--session` it does not have | stderr `NotFoundError … Session not found: <id>` | `session_missing` — the adapter drops the session and runs the turn again in a new one |

On stderr the error line follows a chunk of the CLI's bundled source and is
followed by a stack trace; only the error line is classified.

## Not yet verified

- A Token Plan key. A MiMo API key on `api.xiaomimimo.com/v1` with
  `mimo-v2.6-pro` was run end to end (reply, multi-turn on one session, an MCP
  tool, Stop and continuing after it), as was a Model Studio key through the
  custom-provider route. `GET /v1/models` with the key lists what the model
  pickers offer — including MiMo's ASR/TTS models, which are not chat models.
- Windows: install layout read from install.ps1; the Stop path there is
  `taskkill /T`, not exercised.
- The Xiaomi-account sign-in path.
