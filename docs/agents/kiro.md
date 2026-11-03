# Kiro CLI

[Kiro CLI](https://kiro.dev/cli/) — Kiro's terminal coding agent, binary
`kiro-cli` — run as an OpenAgents agent. The adapter drives it over the
[Agent Client Protocol](https://agentclientprotocol.com) (`kiro-cli acp`,
JSON-RPC over stdio) instead of a one-shot print mode, and it is the first
adapter built on the shared ACP client (`acp-client.js`), which any other CLI
that serves ACP on stdio can reuse.

Everything below was verified against kiro-cli 2.37.0 on macOS, the supported
floor.

## Installing and signing in

| | macOS / Linux | Windows |
|---|---|---|
| Install | `curl -fsSL https://cli.kiro.dev/install \| bash` | `irm https://cli.kiro.dev/install.ps1 \| iex` |
| Lands in | `~/.local/bin/kiro-cli` (`/usr/local/bin` for a system-wide install) | `%ProgramFiles%\Kiro-Cli\kiro-cli.exe` (MSI) |

Either path authenticates the CLI:

- **Kiro sign-in** — `kiro-cli login` (Builder ID, IAM Identity Center, or a
  Google/GitHub login; `--use-device-flow` for a machine without a browser).
- **API key** — `KIRO_API_KEY` on the agent, Kiro's headless alternative.

Readiness comes from `kiro-cli whoami`: "Logged in with …" when signed in,
"Not logged in" otherwise. There is no base URL: models come from the Kiro
account (`kiro-cli chat --list-models`).

## One Kiro agent profile per OpenAgents agent

Kiro keeps an agent's instructions, tools and MCP servers in an **agent
profile** — `.kiro/agents/<name>.json` in the working directory, or
`~/.kiro/agents/<name>.json`. Set `KIRO_AGENT` on an OpenAgents agent to run it
as that profile:

```json
{
  "name": "researcher",
  "description": "Researcher with its own notes database",
  "prompt": "You are the researcher. Store findings in your notes database.",
  "mcpServers": {
    "notes-db": { "command": "my-db-mcp", "args": ["--db", "researcher"] }
  },
  "tools": ["*"]
}
```

The workspace tools are added **next to** the profile's own MCP servers, not
instead of them, so several Kiro agents on one machine can each have their own
prompt, tools and data sources while sharing the workspace.

Kiro does not fail on an unknown profile: it announces
`_kiro.dev/agent/not_found` and carries on as its default agent. The adapter
refuses that turn instead, with a message naming the missing profile — an agent
silently running without its own instructions and data sources is worse than
one that says it cannot start.

| Agent setting | Effect |
|---|---|
| `KIRO_AGENT` | `--agent <name>`; empty runs Kiro's default agent |
| `KIRO_MODEL` | `--model <id>`; a model picked in the workspace wins |
| `KIRO_API_KEY` | passed through to the CLI for headless sign-in |

## What the adapter does

```
kiro-cli acp [--agent <profile>] [--model <id>]
```

One server per message, in the agent's working directory:

1. `initialize` (protocol 1; no client file system or terminal is offered, so
   Kiro uses its own tools).
2. `session/new { cwd, mcpServers: [openagents-workspace] }` for a new
   channel, or `session/load` with the channel's remembered session id. The
   workspace token is passed to Kiro over stdin, in that message's MCP server
   env — never in argv, and never written to a file by OpenAgents. (Whether Kiro
   itself persists session state including that env is up to Kiro.)
3. `session/prompt`. ACP has no system-prompt field, so the workspace briefing
   is the first content block of a session's first turn, and is sent again only
   when it changes (mode switch, pinned knowledge). A fresh session also gets a
   recap of the channel's recent messages.
4. `session/update` frames stream into the channel: narration and reasoning as
   thinking, tool calls as status (`notes-db › get_codeword`), the plan as the
   channel's todos. The reply is the text after the last tool call.
5. The server and everything it started are ended.

History that `session/load` replays is tagged `_meta.kiro.replay` and is never
posted. A session the CLI no longer has (`Session not found`) is replaced once
with a fresh one, and the turn still runs.

## Approvals and plan mode

The adapter does not pass `--trust-all-tools`. Every approval Kiro asks for
arrives as `session/request_permission` and is answered here:

- **Execute mode** — allowed once. Never "always": that would persist trust
  into the user's Kiro settings.
- **Plan mode** — only read-only tools (`read`, `search`, `think`, `fetch`)
  and the workspace's own tools are allowed; writes, commands and other MCP
  servers are refused, and the briefing tells the model it is planning.

Plan mode can only refuse tools Kiro asks permission for. Tools listed in the
profile's `allowedTools`, or that Kiro trusts by default, never ask and so
bypass it. Keep `allowedTools` empty or read-only for agents you use in plan
mode.

## Stopping a run

Stop sends `session/cancel` (the prompt ends with `stopReason: "cancelled"`),
then ends the server and its descendants. Kiro starts shell commands in their
own session, so they are read from the process table while the CLI is alive
and signalled one by one (`taskkill /T` on Windows). The cancelled session stays
resumable, so the thread continues where it stopped.

## Failure shapes

| What happened | What the channel gets |
|---|---|
| Not signed in | guidance to run `kiro-cli login` or set `KIRO_API_KEY` |
| Rate or usage limit | "wait and try again" guidance |
| Profile not found | the profile name and where to create it; nothing runs |
| CLI missing / older than 2.37.0 | the install or upgrade command |
| A failure after the model answered | the answer, with the reason appended |
| `max_tokens` / `max_turn_requests` | the partial answer and which limit hit |

Anything quoted from the CLI is redacted: the agent's keys and workspace token
by value, then anything shaped like a credential.

## Testing

- `test/kiro-runtime.test.js` — the pure rules: version gate, argv, update
  interpretation, approvals, error recognition.
- `test/acp-client.test.js` — the JSON-RPC client against a fake process.
- `test/kiro.test.js` — the adapter against a mock `kiro-cli acp` that replays
  what 2.37.0 sent a recording client: tool calls, replayed history, a stale
  session, an unknown profile, approvals in both modes, and a stop that has to
  reach a detached shell command.

End to end it was run against a local workspace backend with two Kiro agents
in one channel, each on its own profile and its own MCP database: each
answered from its own database, one delegated to the other with an @mention,
a resumed thread kept its context in a new process, a stop ended a running
shell command, and the thread continued after it.
