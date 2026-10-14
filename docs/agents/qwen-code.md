# Qwen Code

[Qwen Code](https://github.com/QwenLM/qwen-code) — Alibaba's open-source
terminal coding agent for Qwen models, installed as `@qwen-code/qwen-code`
(binary `qwen`) — run as an OpenAgents agent.

Verified end to end against Qwen Code 0.25.1. The minimum supported version is
0.16.0, the first release that accepts `--mcp-config`.

## What the adapter does

```
qwen --output-format stream-json --approval-mode yolo \
  --exclude-tools cron_create cron_list cron_delete loop_wakeup \
  --auth-type openai --model <model> --mcp-config <config> \
  [--resume <session>] --append-system-prompt <workspace briefing>
```

One process per user message, with the prompt piped over stdin. With no
positional query the CLI reads the turn from stdin and runs it once, so a long
turn never meets the OS argv limit and a quote in a message cannot become a
command-line injection.

The output is the same stream-json Claude Code writes: a `system/init` frame
with the session id, one `assistant` frame per content block, `user` frames
with tool results, and one closing `result` frame. The reply is read from
`result.result`. Assistant text and tool calls only drive the channel's
progress ticker.

Older supported releases such as 0.16.0 put `[API Error: ...]` in a successful
`result` and exit 0. The adapter recognizes that form as a failure too, so an
authentication or model error is never posted as a completed answer.

Workspace tools (`workspace_read_file`, the shared browser, todos, …) come
through the same stdio MCP server the Claude adapter uses, so the briefing is
the same one too. Qwen Code defers MCP tools. The model looks one up with
`tool_search` and calls it through a generic `tool_call` wrapper, and the
ticker names the tool that actually ran.

Sessions are kept per channel. The CLI's `session_id` comes back on its first
frame, is stored with the working directory, and is passed back with
`--resume` on the next turn. Qwen Code files transcripts under the directory a
session ran in, so a session is only resumed from that same directory. If the
CLI answers a resume with "No saved session found", the binding is dropped and
the turn runs once more from scratch.

The channel's decision log and glossary are refreshed before each turn and
pinned into the system prompt, including resumed turns and fresh sessions.

## Authentication

Qwen Code has no CLI sign-in: `qwen auth` was removed upstream, along with its
OAuth login. The agent runs on an OpenAI-compatible key:

| Field | Passed to the CLI as | Notes |
|---|---|---|
| `LLM_API_KEY` | `OPENAI_API_KEY` (environment) | Required. Never put in argv. |
| `LLM_BASE_URL` | `OPENAI_BASE_URL` | Required, prefilled with Model Studio China, `https://dashscope.aliyuncs.com/compatible-mode/v1`. |
| `LLM_MODEL` | `--model` and `OPENAI_MODEL` | Required. The launcher's picker lists what the base URL serves. The workspace's model picker overrides it. |

Both the base URL and the model are required in the launcher, for two reasons:

- Left to itself, the CLI runs `qwen3.7-max`, the most expensive tier, and a
  Coding Plan account may not offer it at all.
- The launcher's "Test connection" probes whatever the form holds. With a
  blank model it tried the endpoint's first listed model, which an account may
  not be entitled to (a 403 that reads as a broken key). With a blank base URL
  it probed api.openai.com, while the agent itself would have used Model
  Studio.

The workspace's own agent form can still create the agent with only a key
(the model left on "Auto"). The adapter then sends a blank base URL to Model
Studio and lets the CLI pick its default model.

Base URLs for the common keys:

| Key | Base URL |
|---|---|
| Model Studio (DashScope), China | `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| Model Studio, international | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| Bailian Coding Plan, China | `https://coding.dashscope.aliyuncs.com/v1` |
| Bailian Coding Plan, international | `https://coding-intl.dashscope.aliyuncs.com/v1` |

A Model Studio key and a Coding Plan key are not interchangeable. Each fails
with a 401 against the other's URL.

The adapter always passes `--auth-type openai` when it has a key. On its own,
the CLI only detects that provider when `OPENAI_API_KEY` **and** a model are
both set. A key and base URL without a model fail with "No auth type is
selected".

The key, base URL and model are taken as one set: all three from the agent's
form, or all three from `OPENAI_*`. They are never mixed. Otherwise a blank
form base URL would pick up an `OPENAI_BASE_URL` exported for some other tool
and send the Qwen key there.

Saved Qwen `modelProviders` take precedence even over CLI arguments. When an
explicit key is supplied, a private per-run system-settings file clears that
provider map so the key and endpoint above stay together. Other machine-wide
system settings are preserved, and the temporary file is deleted after the
run. If the original system-settings file exists but cannot be read as JSONC,
the adapter reports an error before starting the CLI. User and project
settings files are not rewritten by the adapter.

An `OPENAI_API_KEY` with no `OPENAI_BASE_URL` explicitly uses
`https://api.openai.com/v1`, so a saved endpoint cannot redirect that key.

When the agent has no key at all, nothing is overridden and the CLI's own
`~/.qwen/settings.json` decides. A provider set up with `/auth` in an
interactive session still works that way.

## Settings the adapter changes

Some settings have no command-line flag. The adapter writes them to
`~/.openagents/qwen-code/system-defaults.json` and points
`QWEN_CODE_SYSTEM_DEFAULTS_PATH` at that file. This is Qwen Code's
lowest-precedence settings scope, so your own `~/.qwen/settings.json` and a
project's `.qwen/settings.json` still override it.

| Setting | Value | Why |
|---|---|---|
| `memory.enableManagedAutoMemory` | `false` | See below. |
| `memory.enableManagedAutoDream` | `false` | Background memory consolidation, same reason. |
| `general.enableAutoUpdate` | `false` | A self-update would replace the CLI, and the stream format the adapter parses, in the middle of a run. |

The separate per-run system-settings file only overrides `modelProviders`
when an explicit key is supplied. Settings a headless run does not depend on,
such as usage statistics, are left to the user.

The CLI writes a `"$version"` stamp back into this file the first time it
loads it. The adapter treats that stamp as no change, so the file is written
once rather than on every turn.

**Why auto-memory is off.** When it is on, every turn ends with a
"memory extractor" subagent, and the run's `result` frame waits for it to
finish. Measured on a resumed session, the answer was on stdout after 7 seconds
and the `result` frame arrived after 194 seconds, with over 100k extra tokens
spent. With auto-memory off, the same turn finished in 7 seconds.

If the machine already has a system-defaults file (for example
`/etc/qwen-code/system-defaults.json`), it is merged in and its values win. If
that file exists but cannot be parsed, the adapter leaves it in charge and does
not override anything.

## Tools that are turned off

`cron_create`, `cron_list`, `cron_delete` and `loop_wakeup` schedule work
inside the CLI process. A headless run exits when its turn ends, so a reminder
set this way would never fire. Timers and routines that need to outlive the
turn go through the workspace, over MCP.

In plan mode the run is `--approval-mode plan`, and the CLI removes its edit,
write and shell tools. Otherwise the run is `yolo`, because nobody is at a
keyboard to approve a tool call. Without `yolo`, a headless run silently drops
every write and shell tool. The CLI's per-run warning about `yolo` is silenced
with `QWEN_CODE_SUPPRESS_YOLO_WARNING=1` so that it cannot bury a real error on
stderr.

## Stopping

On macOS and Linux, Stop sends SIGINT to the run's process group, then SIGTERM
and SIGKILL if it is still running. Qwen Code handles SIGINT itself. It
cancels the turn, kills its own shell tools (they run in a PTY session outside
the group) and exits with code 130 within about 100 ms. The session can be
resumed afterwards, so the channel keeps its conversation.

On Windows the npm entry script starts the CLI again as a child process
(`node --expose-gc cli.js`). `ChildProcess.kill()` there terminates only the
parent, which would leave the child running the turn. Stop therefore uses
`taskkill /T /F` on the whole tree.

## Installing

| Route | Where `qwen` lands | Detected |
|---|---|---|
| `npm install -g @qwen-code/qwen-code` (what the launcher runs) | the npm global prefix | yes |
| `install-qwen-standalone.sh` | `~/.local/bin/qwen`, a wrapper around `~/.local/lib/qwen-code` | yes |
| `install-qwen-standalone.ps1` | `%LOCALAPPDATA%\qwen-code\bin\qwen.cmd`, a wrapper around `%LOCALAPPDATA%\qwen-code\qwen-code` | yes |
| either installer with `QWEN_INSTALL_ROOT` / `QWEN_INSTALL_BIN_DIR` | where those point | yes |

The CLI needs Node 22 or newer. The adapter runs the npm package's
`cli-entry.js` under the launcher's managed Node, not through a `.cmd` shim, so
the system prompt never goes through `cmd.exe` and its 8191-character
command-line limit. A standalone install runs on the Node it ships with.

## Storage

| Path | Contents |
|---|---|
| `~/.openagents/sessions/<workspace>_<agent>_qwen-code.json` | The CLI session id per channel, and the working directory it was created in. |
| `~/.openagents/mcp-configs/qwen-code-*.json` | The workspace MCP config for one run. Written `0600` and deleted when the run ends, because it carries the workspace token. |
| `~/.openagents/qwen-code/system-defaults.json` | The settings layer described above. |
| `~/.openagents/qwen-code/run-settings/*.json` | Private per-run settings that isolate explicit credentials from saved providers; deleted with any CLI migration backup when the run ends. |
| `~/.qwen/projects/<dir>/chats/<session>.jsonl` | Qwen Code's own transcripts (`$QWEN_HOME` if set). |

## Troubleshooting

| Symptom | Cause |
|---|---|
| "Qwen Code CLI not found" | Run `npm install -g @qwen-code/qwen-code`, or use the standalone installer. |
| "below the minimum supported version 0.16.0" | Older releases reject `--mcp-config`. Upgrade. |
| "has no model credentials" | No API key is set for the agent and `~/.qwen/settings.json` has no provider either. |
| "rejected the API key" | The key is wrong or expired, or it belongs to the other service (Model Studio vs Coding Plan). The provider's own message is quoted in brackets. |
| "does not serve the configured model" | The model id is not available at that base URL. Coding Plan offers a shorter list than Model Studio. |
| "could not reach the model endpoint" | The base URL is wrong, or there is a network or proxy problem. |
| Answers arrive but workspace tools do nothing | The MCP config could not be written, or the `openagents` binary was not found. The run goes ahead without workspace tools and the daemon log says so. |

## Not supported yet

- **Attachments** are flattened into the prompt as text.
- **Model reasoning** (`thinking` blocks) is not posted to the channel. The
  Claude adapter does not post it either.
- **ACP** (`qwen --acp`) and **`qwen serve`** are not used. One headless run
  per message is the only mode.
