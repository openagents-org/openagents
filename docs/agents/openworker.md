# OpenWorker

[OpenWorker](https://openworker.com) ([source](https://github.com/andrewyng/openworker))
run as an OpenAgents agent.

OpenWorker is the odd one out in this catalog. Every other agent here is a
terminal program with a headless mode — `claude -p`, `dsh --profile headless`,
`command-code -p --output-format json`. OpenWorker has no such mode. Its
`openworker` command is a [Textual](https://textual.textualize.io/) TUI that
exits with the terminal, and its GUI is a Tauri shell. The only programmable
surface is **`openworker-server`**: a FastAPI process that speaks REST for state
and one WebSocket per session for turns.

So OpenAgents runs the server itself. Nothing about that is visible in the
workspace — you add the agent, give it a model key, and it answers messages —
but it is the fact that explains every design decision below.

---

## What the adapter does

```
openworker-server --host 127.0.0.1 --port <free> --cwd <working dir> --model <provider:model> --mode bypass-approvals
```

1. `preflight()` runs **before the daemon joins the workspace** and resolves
   `openworker-server`. No server, no join — with the install command instead of
   a poll loop that cannot succeed.
2. On the first message the adapter provisions a private state directory, mints
   a launch token, picks a free loopback port, and starts **one** server. Every
   channel of that agent shares it; booting the server imports FastAPI, uvicorn
   and three model SDKs, which is not a cost worth paying per message.
3. For each message it opens `ws://127.0.0.1:<port>/ws/session/<id>`, sends one
   `user_message` frame, and reads events until `turn_done`.
4. The socket closes after the turn. Session state lives on the server, keyed by
   an id derived from the channel, so a channel keeps its history across daemon
   restarts without idle sockets being held open.

### Authentication of the local socket

The server gates both surfaces on a launch token. OpenAgents supplies its own
through `COWORKER_API_TOKEN` rather than letting the server write a
`sidecar-<port>.token` file, so there is no file to race with, leak or clean up.

REST calls send it as `X-OpenWorker-Token`. The WebSocket has no headers to use,
so the token rides as a **subprotocol** — and the client must offer *two*:

```js
new WebSocket(url, ['openworker', token])
```

The server authenticates by finding the token among the offered protocols, then
accepts by echoing back `openworker`. A client that offered only the token would
have its own handshake rejected locally, because the server picked a protocol it
never proposed.

## Behaviour you should expect

| | |
|---|---|
| **No token streaming** | OpenWorker's event model is per-message, not per-token. The workspace shows a live tool ticker (`running a command`, `reading a file`) and then the answer. |
| **Real conversation memory** | Unlike the one-shot CLI agents, the server keeps each channel's thread on disk and resumes it. The workspace briefing is therefore sent once per session, not per message. |
| **One turn at a time per channel** | Standard BaseAdapter queuing, and the server enforces it too — a second turn on a live session is refused rather than interleaved. |
| **15-minute ceiling** | A turn is interrupted after 15 minutes, or after five minutes with no event at all. |

## Approvals, and why they are answered for you

OpenWorker is built around a person confirming consequential actions. Its engine
suspends the turn — indefinitely — on five different prompts: a tool approval, a
request to reach a folder outside the workspace, a request to install a tool, a
proposed plan, and a direct question to the user. `bypass-approvals` reduces how
often they fire but does not remove them: OpenWorker keeps hard floors around
settings files, writes outside the workspace root, and `.git/hooks`.

Nobody is at the other end of this socket. An unanswered prompt is therefore not
a degraded turn, it is a turn that never ends. The adapter answers all of them,
and posts the decision into the channel so it is visible rather than silent:

| Prompt | Answer | Why |
|---|---|---|
| Tool approval | Approve **once** | Never `always_*`: a standing rule minted on the agent's behalf would outlive this turn and widen what an unrelated later message may do. |
| Folder access | Grant only inside the working directory, otherwise decline | Widening an unattended agent's filesystem reach is exactly the decision a human is supposed to make. |
| Install a tool | Decline | Declining is a first-class outcome upstream — the agent falls back and says so. Set `OPENWORKER_ALLOW_TOOL_INSTALL=1` to allow it. |
| Proposed plan | Approve in execute mode; decline in plan mode | In plan mode the plan *is* the deliverable; approving would flip the live session out of read-only. |
| Question to the user | "Choose the most reasonable option, proceed, and state the assumption you made." | The question text is posted to the channel, so the human can see what was assumed. |
| Propose a team | Decline | Staffing sub-agents pre-spawns worker sessions, each burning its own tokens. That is a spend decision. |
| Propose work items | Approve | Board bookkeeping only. |

Plan mode maps onto OpenWorker's own read-only `plan` mode, and tool approvals
are denied there rather than granted.

## Setup

```bash
agn install openworker            # uv tool install git+https://github.com/andrewyng/openworker
agn create my-worker --type openworker
agn env openworker --set OPENWORKER_PROVIDER=anthropic
agn env openworker --set OPENWORKER_API_KEY=sk-ant-...
agn up
agn connect my-worker <workspace-token>
```

Installation needs **git** and **uv** on the machine. Both are checked before
the install runs, so a machine missing either gets one named remedy with a
copyable command rather than a shell error inside installer output.

In the Launcher, use **Configure** for the same fields. The model picker loads
its list from whichever provider you selected.

### Settings

| Variable | Meaning |
|---|---|
| `OPENWORKER_PROVIDER` | Which provider the key belongs to. OpenWorker is bring-your-own-model; this decides the endpoint and how the model id is routed. Default `openai`. |
| `OPENWORKER_API_KEY` | Key for that provider. Passed in the server's environment; see [Secrets](#secrets). |
| `OPENWORKER_BASE_URL` | Endpoint override — a relay, a self-hosted gateway, Azure OpenAI, or where `ollama serve` is listening. |
| `OPENWORKER_MODEL` | Model id. The provider prefix is added automatically, so `claude-opus-5` is enough. |
| `OPENWORKER_MODE` | Permission mode. Default `bypass-approvals`; `interactive` and `auto-approve` will stall on the first prompt the adapter cannot pre-empt. |
| `OPENWORKER_ALLOW_TOOL_INSTALL` | `1` lets the agent install tools from OpenWorker's pinned catalog. Off by default. |
| `OPENWORKER_STATE_DIR` | Advanced — see [Storage](#storage). |
| `OPENWORKER_SERVER_BIN` | Advanced. An explicit path to `openworker-server`, when it lives somewhere the tiers below do not look. |

### Providers

Anything OpenWorker configures from a single key plus an optional endpoint:
`openai`, `anthropic`, `gemini`, `deepseek`, `kimi`, `qwen`, `minimax`, `xai`,
`mistral`, `meta`, `together`, `fireworks`, `openrouter`, `zai`, `ark`, plus
`ollama` (no key) and `openai-codex` (a ChatGPT subscription).

`bedrock` and `vertex` are deliberately absent: they take a multi-field
credential form (role ARNs, service-account JSON, region) with no honest
single-key mapping. `openai-codex` needs an OAuth sign-in performed in a browser,
which is not something OpenAgents can drive — both are reachable only by pointing
`OPENWORKER_STATE_DIR` at a state directory where the desktop app already stored
the credentials.

## Workspace tools

OpenWorker has no system-prompt hook and no skill directory OpenAgents could
write to without editing the user's own config. The workspace briefing —
identity, collaboration rules, and the REST API reference — is therefore
prepended to the **first user message** of a session.

That is durable rather than wasteful: the server persists the thread, so the
block is sent once and remains in context for every later turn. The briefing
names `run_shell`, which is the actual name of OpenWorker's shell tool; naming a
tool the agent does not have is how a model ends up printing curl commands as
text instead of running them.

## Secrets

The API key is passed to the server **in its environment** and referenced from
the provider profile as `${OPENWORKER_API_KEY}`. OpenWorker's SecretStore
resolves `${VAR}` references at read time, so the key reaches the provider
without ever being written to disk.

The profile file exists only because `base_url` has no environment path in
OpenWorker — its provider builders read the endpoint from the store and nowhere
else. It is written `0600`, and merged rather than overwritten, so MCP OAuth
tokens the server stored itself survive.

## Storage

| Path | Contents |
|---|---|
| `~/.openagents/openworker/<workspace>_<agent>/` | The server's state directory: conversations, SQLite stores, provider profiles. One per (workspace, agent) pair. |
| `~/.openagents/sessions/<workspace>_<agent>_openworker.json` | Which channels have already been sent the workspace briefing, and under which working directory. |

The state directory is ours on purpose. If the launcher shared
`~/.config/coworker` (or `%APPDATA%\coworker`) with the OpenWorker desktop app,
two processes would be writing one SQLite file — the failure OpenWorker's own
`ocw` CLI documentation warns about.

`OPENWORKER_STATE_DIR` overrides it, which is how you reuse the desktop app's
sign-ins. **Only do that while the desktop app is closed**, and note that a
directory you point at is never written to by OpenAgents.

## Troubleshooting

| Symptom | Cause |
|---|---|
| "OpenWorker is not installed (`openworker-server` not found)" | `uv tool install git+https://github.com/andrewyng/openworker`. If it is installed, `OPENWORKER_SERVER_BIN` names the path explicitly. |
| "The OpenWorker install is incomplete (a Python dependency is missing)" | A partial install. `uv tool install --force git+https://github.com/andrewyng/openworker`. |
| "cannot be installed yet — a required tool is missing" | git or uv is absent. The message carries the command for your platform. |
| "No API key for the … provider" | Set `OPENWORKER_API_KEY`, or pick `ollama`, which needs none. |
| "The OpenWorker server did not start within 90s" | First runs are slow while Python imports warm up; a repeat failure quotes the server's own output. |

## Not supported yet

- **Attachments** are flattened into the prompt as text, not uploaded through the
  server's attachment API.
- **MCP servers** the user configured in OpenWorker are not registered by
  OpenAgents; registering one writes into the user's global OpenWorker config,
  which is not ours to edit. They do apply when `OPENWORKER_STATE_DIR` points at
  a directory that already has them.
- **The board / `ocw` surface** (work items, journal) is not bridged to workspace
  todos.
