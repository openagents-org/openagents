# Goose (Beta)

[Goose](https://github.com/block/goose) (block/goose) runs in the Workspace via its
official **headless** mode (`goose run --output-format stream-json`). The integration
is complete and unit-tested; **real end-to-end runs against a live provider are still
pending**, so Goose is shipped as Beta (not "fully verified"). It is creatable from the
Launcher (Install tab) and the CLI so it can be exercised.

**Minimum version: Goose CLI ≥ 1.37.0.** Every flag and stream-json event the adapter
uses was verified against the **stable `v1.37.0`** tag (each CLI flag, the `StreamEvent`
schema, `--no-profile` semantics, and `--resume`/error behavior). Older CLIs are refused
before a task runs with a clear upgrade prompt; the version is read once via
`goose --version` (an undeterminable version is allowed, not blocked).

**Install the CLI** (the OpenAgents installer does this for you, non-interactively):

```bash
# macOS / Linux — CONFIGURE=false keeps it non-interactive (no `goose configure`)
curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash
# Windows (PowerShell)
powershell -c "$env:CONFIGURE='false'; irm https://raw.githubusercontent.com/block/goose/main/download_cli.ps1 | iex"
```

The CLI installs to `~/.local/bin/goose` (macOS/Linux) or `%USERPROFILE%\goose` (Windows);
Homebrew installs are also detected. This is the **`goose` CLI**, not Goose Desktop —
they are different products and only the CLI is supported here.

**Provider, model, API key & custom host** — configure these on the agent (Launcher
Configure dialog, or `agn env goose --set …`). They map 1:1 to Goose's native env vars:

| Field | Goose env var | Notes |
|-------|---------------|-------|
| Provider | `GOOSE_PROVIDER` | e.g. `openai`, `anthropic`, `google`, `openrouter`, `ollama` |
| Model | `GOOSE_MODEL` | e.g. `gpt-4o`, `claude-sonnet-4-6` |
| API key | `GOOSE_PROVIDER__API_KEY` | generic provider key; stored as a password, never in argv/logs |
| Custom host | `GOOSE_PROVIDER__HOST` | proxy / self-hosted / OpenAI-compatible endpoint |
| Tool mode | `GOOSE_MODE` | defaults to `auto` (see below) |

**Existing login is reused.** Leave the fields blank to fall back to your existing Goose
config (`~/.config/goose/config.yaml`), keyring, OAuth provider, or local provider
(e.g. Ollama). OpenAgents never edits your global `config.yaml`/`secrets.yaml`, never
writes plaintext secrets, and never runs `goose configure`. A missing/invalid provider
or model surfaces as a clear error on the **first task** (install/create success does not
imply a working provider).

**Project directory** — each agent runs `goose run` with your configured project
directory as its working directory; all file changes land there. Sessions and OpenAgents
state are stored under `~/.openagents`, never in your repo. Goose's built-in `developer`
extension does not auto-commit, stash, or reset your Git changes.

**Headless permission mode (important).** Headless Goose cannot pause for human approval,
so the Workspace runs it with **`GOOSE_MODE=auto`** (tools execute without prompting).
Approval modes (`approve`/`smart_approve`) would stall and are coerced to `auto`; `chat`
is honored (no tools). Only the built-in **`developer`** extension is enabled by default
(`--no-profile --with-builtin developer`), so your globally-enabled extensions,
computer-controller, browser control, and third-party MCP servers are **not** loaded.
Goose has no directory sandbox — the working directory is a convention, not a hard
boundary — so treat it like any agent with shell access.

**Sessions & channel isolation.** Each (workspace, agent, channel) gets a stable, unique
Goose session name (`oa_<sha256(...)[:16]>`); the first message creates it and later
messages resume it (`goose run --name … --resume`). Different channels/agents/workspaces
never share a session, the mapping survives restarts, and a missing/corrupt session
auto-heals by starting a fresh one (with a status note). Tasks on one channel run
serially.

**Stop & cleanup.** Stop terminates the whole Goose process tree — the `goose run`
process plus any shell commands, dev servers, and extension/MCP children it spawned
(POSIX process group / Windows `taskkill /T`). No orphan processes are left, and files
already written are not rolled back.

**Limits / long tasks.** Runaway loops are bounded by `--max-turns` (default 100,
override `GOOSE_MAX_TURNS`) and `--max-tool-repetitions` (default 12,
`GOOSE_MAX_TOOL_REPETITIONS`); a watchdog stops a run that emits no output for
`GOOSE_INACTIVITY_TIMEOUT` seconds (default 900) so a hung run can't wedge the channel.

**Troubleshooting**
- *Authentication failed* — check `GOOSE_PROVIDER__API_KEY` / `GOOSE_PROVIDER__HOST`.
- *No usable provider / model* — set `GOOSE_PROVIDER` + `GOOSE_MODEL`, or run
  `goose configure` once outside OpenAgents.
- *"Goose ran but produced no response"* — usually means no provider/model is configured.
- *CLI not found after install* — ensure `~/.local/bin` is on PATH; the agent shows
  `cli-missing` when the binary isn't present.

**Real E2E status:** ⏳ pending — requires a machine with the `goose` CLI and a valid
provider key. To verify manually: `goose --version`; create a Goose agent with a provider
+ model + key; connect it to a Workspace; send a message and confirm the reply, tool
status, and that file edits land in the project directory; send a second message in the
same channel and confirm context is retained; open a new channel and confirm it does not
inherit context; press Stop mid-task and confirm no leftover processes.
