# Muse Code

Meta's terminal coding agent (Muse Spark models), run headless by the
OpenAgents daemon.

- Registry entry: `registry/muse.json`
- Adapter: `packages/agent-connector/src/adapters/muse.js`, pure helpers in
  `muse-stream.js`
- Product docs: https://dev.meta.ai/docs/muse-code

Checked against Muse Code 1.3.0 (Linux x64) using the CLI's offline
`--provider echo` mode. Not yet checked with a real key: shell tool calls
inside the sandbox, the shape of tool records in the JSONL stream, and a live
call to a workspace MCP tool.

## Install

Meta's own script, not npm:

| Platform | Command |
|---|---|
| macOS / Linux | `curl -fsSL https://dev.meta.ai/install.sh \| sh` |
| Windows | `irm https://dev.meta.ai/install.ps1 \| iex` |

The script installs a launcher plus the versioned binary next to it — in
`~/.local/bin` (`$MUSE_INSTALL_DIR` overrides it), or
`%LOCALAPPDATA%\Programs\muse` with a `muse.cmd` shim on Windows. The launcher
checks for updates at most once an hour (`MUSE_UPDATE_INTERVAL_SECONDS`) and
then execs the binary.

Do not install into a world-writable directory such as `/tmp`. The Linux
sandbox helper is the binary itself, and it refuses to run from an unprotected
writable root — every shell command then fails as an environment error.

## Authentication

Either route works, and `META_API_KEY` wins when both are present:

- `META_API_KEY` — a Meta Model API key from the Meta Developer Console. Set it
  in the agent's configuration; it is passed to the CLI through the
  environment only.
- `muse login` — a Meta-account device-code sign-in in the browser.

Both are stored in `$XDG_CONFIG_HOME/muse/auth.json` (default
`~/.config/muse`) under `providers.meta`; the launcher reads only whether that
entry exists. `muse logout` removes it.

The launcher looks the file up where this agent's CLI will: `XDG_CONFIG_HOME`
from the agent's saved env, else from the environment the launcher passes
down, and `~/.config` when it is empty or unset. A relative value is resolved
by the CLI against the run's working directory, so the launcher reports that
case as unknown rather than guessing; the adapter resolves it the same way the
CLI does. The CLI does not honor
`MUSE_AUTH_PATH` or `MUSE_CONFIG_DIR` (1.3.0), so the credentials always sit
beside the settings file described below.

## How a turn runs

One process per message:

```
muse exec --json --prompt-file <file> --session-id <uuid> --approval-mode never
          [--model …] [--reasoning-effort …] [--max-model-steps …]
          [--disable-write --disable-shell]      # plan mode
```

- **The sandbox stays on.** `--approval-mode never` removes the approval gate a
  headless run cannot answer; nothing passes `--disable-sandbox` or `--yolo`.
- **The prompt is a file**, 0600 under `~/.openagents/muse-prompts`, deleted
  after the run. `--prompt-file` must be a regular file (`/dev/stdin` is
  refused). Muse has no system-prompt flag, so the workspace briefing opens the
  first turn of each session; later turns send the bare message.
- **Sessions are minted by the adapter.** Each channel gets a UUID, and passing
  the same `--session-id` again resumes it. A saved session that produces no
  output is dropped and the turn retried once from scratch.
- **The reply is the `run.terminal.*` record's `text`.** Every stdout line is an
  envelope `{stream, payload_type, payload}`; `run.output.delta` records only
  feed the progress ticker.
- **`task.lifecycle.failed` is not a failure.** A clean run emits one for an
  internal reminder task ("provider does not support base instructions").
- A stopped run posts nothing: the process group is killed and whatever it had
  already written is dropped.

## Workspace tools (MCP)

Muse reads MCP servers from `$XDG_CONFIG_HOME/muse/settings.json`. The adapter
keeps one entry there, `openagents-workspace`, and nothing in it is a secret:

```json
{
  "schema_version": 1,
  "mcp_servers": {
    "openagents-workspace": {
      "transport": "stdio",
      "command": "<node>",
      "args": ["<agent-connector.js>", "mcp-server"],
      "env": {
        "OA_WORKSPACE_TOKEN": "${OA_WORKSPACE_TOKEN}",
        "OPENAGENTS_WORKSPACE_ID": "${OPENAGENTS_WORKSPACE_ID}",
        "OPENAGENTS_CHANNEL_NAME": "${OPENAGENTS_CHANNEL_NAME}",
        "OPENAGENTS_AGENT_NAME": "${OPENAGENTS_AGENT_NAME}",
        "OPENAGENTS_ENDPOINT": "${OPENAGENTS_ENDPOINT}",
        "OPENAGENTS_DISABLED_MODULES": "${OPENAGENTS_DISABLED_MODULES}"
      },
      "framing": "line_delimited_json",
      "enabled": true,
      "mode": "optional"
    }
  }
}
```

What was verified on 1.3.0:

- `env` values are interpolated from the run's environment; `args` are not.
  That is why `mcp-server` also reads its workspace, channel and disabled
  modules from `OPENAGENTS_*` variables.
- An empty variable counts as set. When the variables are absent — a `muse`
  the user starts by hand — the `optional` server is skipped and the session
  starts normally.
- The file must carry `schema_version`, and its top level must be an object;
  otherwise Muse refuses to start.

The adapter merges its entry into an existing file and keeps everything else.
When the file is not valid JSON, is not an object, lacks `schema_version`, or
has an `mcp_servers` that is not an object, the adapter does not touch it and
does not start Muse — the channel gets an error naming the file.

## Configuration

| Variable | Meaning |
|---|---|
| `META_API_KEY` | Meta Model API key (optional with `muse login`) |
| `MUSE_MODEL` | Model id, e.g. `muse-spark-1.3`; blank = CLI default |
| `MUSE_REASONING_EFFORT` | `none` … `ultra`; blank = CLI default (`high`) |
| `MUSE_MAX_MODEL_STEPS` | Cap on model steps per message |

`LLM_API_KEY` / `LLM_MODEL` map onto `META_API_KEY` / `MUSE_MODEL`.
