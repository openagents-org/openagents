# Qoder CLI (and Qoder CLI CN)

[Qoder CLI](https://qoder.com/cli) — Qoder's terminal coding agent, binary
`qodercli` — run as an OpenAgents agent. Its China edition
([qoder.com.cn](https://qoder.com.cn/cli), binary `qoderclicn`) is a second
agent type, `qoder-cn`, driven by the same adapter.

Everything below was verified against qodercli 1.1.72 on Linux; the flags the
adapter passes were also checked on 1.0.45 (the oldest release still published,
and the supported floor) and 1.1.62.

## Two agents, not a region option

The China edition is not a setting of the international CLI. Its brand is
compiled into a separate binary, and every name differs:

| | `qoder` | `qoder-cn` |
|---|---|---|
| Binary | `qodercli` | `qoderclicn` |
| Install (macOS/Linux) | `curl -fsSL https://qoder.com/install \| bash` | `curl -fsSL https://qoder.com.cn/install \| bash` |
| Install (Windows) | `irm https://qoder.com/install.ps1 \| iex` | `irm https://qoder.com.cn/install.ps1 \| iex` |
| Config root | `~/.qoder` | `~/.qoder-cn` |
| Token variable | `QODER_PERSONAL_ACCESS_TOKEN` | `QODERCN_PERSONAL_ACCESS_TOKEN` |
| Account / tokens | qoder.com/account/integrations | qoder.cn/account/integrations |

Install, detection and the sign-in probe all key off the binary, and an account
or token from one service is refused by the other — so they are two catalog
entries. The adapter code is shared (`qoder.js`; `qoder-cn.js` only swaps the
edition table in `qoder-runtime.js`).

## Signing in

Either path works, and the agent form takes both:

- **Browser sign-in** — `qodercli login` prints a device-authorization URL,
  opens the browser and waits; it needs no TTY, so the launcher runs it in-app.
  The session is kept in the config root (`~/.qoder/.auth/user`).
- **Personal access token** — created at the account page above, pasted into
  the agent. The adapter puts it in the token variable, which the CLI reads
  *before* any saved sign-in and never falls back from: a token set on the
  agent always wins.

Readiness comes from `qodercli status -o json` (`"logged_in": true|false`). It
exits 1 only when a token in the environment is rejected.

There is no base URL. Models come from the Qoder account; another provider's
key cannot be used. (Qoder's own bring-your-own-key feature exists, but it
needs a signed-in Qoder account with the feature enabled.)

## What the adapter does

```
qodercli -p -o stream-json --append-system-prompt <briefing> --yolo \
  --disallowed-tools CronCreate,CronDelete,CronList,ScheduleWakeup,EnterWorktree,ExitWorktree \
  [-m <model>] --settings '{"general":{"enableAutoUpdate":false}}' \
  --mcp-config <file> --strict-mcp-config (--session-id <uuid> | -r <id>)
```

One process per message, prompt over stdin. The stream is the Claude Agent SDK
format, so the workspace briefing is the Claude adapter's, reused. A new
session gets a UUID chosen by the adapter; later turns resume it. Transcripts
are filed per working directory, so a session is only resumed from the
directory it started in, and a resume the CLI cannot find (exit 42) re-runs the
turn fresh.

Plan mode runs `--agent Plan` (no Edit/Write) without `--yolo`.
`--permission-mode plan` is documented but 1.1.72 does not accept it.

## Keeping the user's setup out of the run — without `--config-dir`

`--config-dir` / `QODER_CONFIG_DIR` would isolate a run in one move, but the
config root holds the browser sign-in: pointing it elsewhere signs the agent
out. So the run is isolated layer by layer:

| From `~/.qoder` | Kept out by |
|---|---|
| Saved sign-in | the token variable (read first, no fallback) |
| `model.name` in settings.json | `-m` |
| `mcpServers` in settings.json, project `.mcp.json` | `--strict-mcp-config` |
| Auto-update | `--settings` (headless runs skip it anyway) |

## Side effects

- **Shell rc files.** On a machine where the CLI has never run, its first start
  rewrites `.zshrc`/`.bashrc` (and friends) to put its dispatcher on PATH. The
  adapter sets `QODER_NO_RC=1` (`QODERCN_NO_RC=1`), so a daemon run never edits
  the user's shell.
- **Global git ignore.** Every start appends `AGENTS.local.md` and
  `*.local.md` to `$XDG_CONFIG_HOME/git/ignore` once (idempotent). There is no
  switch for it.
- **The project directory** gets nothing: transcripts, memory and plans live
  under the config root.

## Stopping a run

The CLI ignores SIGINT for ~30s while its MCP servers connect, and on SIGTERM
it exits but leaves those servers running; its shell commands run in sessions
of their own. Stop therefore reads the process table while the CLI is alive and
signals every descendant (Windows: `taskkill /T /F`).

## Failure shapes

| Situation | What the CLI does | Adapter reports |
|---|---|---|
| Signed out | `result` with subtype `success` but `is_error: true` ("Not logged in · Please run /login"), exit 1 | sign in or set a token |
| Token rejected | no stdout; `QoderAuthError …` on stderr, exit 1 | token rejected |
| Resume not found | stderr `Error resuming session: Invalid session identifier`, exit 42 | re-runs fresh |
| Out of credits | `is_error` result, `error_code` 110–122 | quota |
| Sign-in expired | `error_code` 105 | sign in again |

## Testing

- `test/qoder-runtime.test.js`, `test/qoder.test.js` — unit tests, with a mock
  CLI replaying the shapes above.
- `test/qoder-cli.test.js` — opt-in, against the real binary:
  `QODER_TEST_CLI=/path/to/qodercli node --test test/qoder-cli.test.js`
  (add `QODER_TEST_EDITION=cn` for `qoderclicn`). Needs network, no account.
