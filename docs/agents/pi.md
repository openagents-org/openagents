# Pi

OpenAgents supports **Pi**, Earendil's coding agent for the terminal —
executable `pi`, distributed as the npm package
[`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).

- **Internal agent id:** `pi`
- **User-facing name:** Pi
- **Adapter:** `packages/agent-connector/src/adapters/pi.js`
- **Stream parser:** `packages/agent-connector/src/adapters/pi-stream.js`
- **Registry source:** `sdk/src/openagents/registry/pi.yaml`
  (hand-synced into `packages/agent-connector/registry.json`)
- **Verified against:** `pi 0.83.0`

---

## Architecture: one long-lived RPC subprocess per channel

Pi is integrated the same way every other coding agent in this repo is — as a
**CLI subprocess**. Nothing in OpenAgents imports Pi's SDK, `AgentSession`, or
any `@earendil-works/*` module, and no Pi source is vendored in. A test
statically asserts this (`test/pi.test.js` → "never imports a Pi SDK or
internal Pi module").

The adapter reuses the **persistent-process model already proven by
`claude.js`**, structure for structure:

| Concern | `claude.js` | `pi.js` |
|---|---|---|
| per-channel process record | `_persistentProcs[channel]` | same |
| process handle the daemon/stop path reads | `_channelProcesses[channel]` | same |
| release an idle channel | `_resetIdleTimer` (1 h) | same (1 h) |
| kill a wedged process | `_startWatchdog` / `_stopWatchdog` (15 s × 20) | same |
| cross-platform tree kill | `_stopProcess` (SIGTERM→SIGKILL / `taskkill /F /T`) | same |
| stop only one channel | `_onControlAction('stop', {channel})` | same |
| dedup the stop notice | `_stopNoticeSent` | same |
| teardown on daemon shutdown | `stop()` → `_stopAllProcesses` | same |

What differs is the **wire protocol**. Claude Code takes one user message per
stdin line and answers with a `result` event; Pi speaks a request/response RPC:

```
pi --mode rpc --session-dir <oa dir> --session-id <uuid> --no-approve \
   [--provider …] [--model …] [--thinking …] --append-system-prompt <text> --name <agent/channel>
```

- Commands go to **stdin** as JSONL, each with a unique `id`.
- **stdout** carries both `{"type":"response","id":…}` correlations and a live
  event stream.
- **stderr is diagnostics only** and is never parsed as JSONL.

A turn is: send `prompt` → receive `response{success:true}` (this only means
*accepted*) → consume events → the turn is over at **`agent_settled`**.
Provider failures do **not** arrive as a failed response; they arrive as an
assistant message with `stopReason: "error"` and an `errorMessage`. The adapter
handles both paths.

### JSONL framing

Pi's RPC framing is strict and the docs are explicit that **Node's `readline`
is not protocol-compliant** (it also splits on U+2028/U+2029, which are legal
inside JSON strings). `pi-stream.js` therefore implements framing by hand:

- a `StringDecoder('utf8')` does the byte→string step, so a multi-byte UTF-8
  sequence split across two chunks (CJK, emoji) is reassembled rather than
  decoded into `�` — most other adapters in this repo call `chunk.toString()`
  directly, which has exactly that bug
- records split on `\n` and **only** `\n`; a trailing `\r` is stripped
- one record may span many chunks; one chunk may carry many records
- a single un-terminated record over 16 MB is dropped and the framer
  resynchronizes on the next `\n`
- a corrupt line degrades to a redacted `unknown` event — never a throw

### Event mapping

`EVENT_KIND_BY_TYPE` in `pi-stream.js` is the **single** place Pi's type
strings appear; a Pi upgrade is a one-table edit.

| Pi event | OpenAgents |
|---|---|
| `agent_start` | status "Pi is working..." |
| `message_update` (`thinking_end`) | streamed `thinking` message |
| `message_update` (`text_end`) | held until `message_end` decides its role |
| `message_end` (`stopReason: toolUse`) | the text was narration → posted as `thinking` |
| `message_end` (any other stop reason) | the text is the answer candidate |
| `tool_execution_start` | status `<tool> › <redacted, truncated args>` |
| `tool_execution_update` | progress only (keeps the watchdog quiet) |
| `tool_execution_end` | completion status (`<tool> ✓`) or a failure status |
| `bash_execution_update` | treated as tool activity |
| `compaction_start` / `compaction_end` | context-compaction status |
| `auto_retry_start` / `auto_retry_end` | retry status; a failed retry becomes the turn error |
| `extension_error` | redacted, diagnosable status + log |
| `agent_end` | one low-level run done (`willRetry` may follow) |
| `agent_settled` | turn complete → post the final answer |

**Streaming vs. final, deduplicated — twice over.** Pi emits every assistant
content block twice: incrementally via `message_update` and again in the
`message_end` payload. Two mechanisms keep the workspace from ever seeing the
same text more than once:

1. `PiAssistantAccumulator` releases each block **once**, keyed by its
   `contentIndex`, so a block that streamed is not re-released at
   `message_end`, and a block whose streaming `*_end` never arrived is still
   emitted. Blocks are scoped per message; a missing `message_start` reopens
   the accumulator implicitly rather than swallowing the next message.
2. Released **text** blocks are *held*, not posted, until `message_end` says
   what they are. `stopReason: "toolUse"` means the model is about to call a
   tool and will speak again, so that text is narration → posted as `thinking`.
   Any other stop reason means the message stands on its own → it becomes the
   answer candidate and is posted **once**, as a chat message, at settlement.
   A candidate superseded by a later message is flushed as `thinking` rather
   than dropped, so nothing the model said is lost.

The trade-off is deliberate: the final answer arrives whole rather than
streaming, because posting it progressively *and* as the reply is exactly the
duplication this avoids. Tool statuses carry the live progress instead.

**Hidden reasoning is never an answer.** `thinking` content blocks go out
through `sendThinking()` only and can never reach `sendResponse()`.

---

## Installation

```bash
agn install pi
```

Pi installs into the **isolated runtime prefix**
`~/.openagents/runtimes/pi/` — you never need a global `pi` on your PATH, and a
global one can never shadow the launcher-managed copy (the isolated prefix is
resolution tier 0).

### Node.js requirement — a hard gate

`@earendil-works/pi-coding-agent` declares `engines.node >= 22.19.0`. Because
`pi`'s bin is a **Node entry point**, the adapter resolves it to
`[node, dist/cli.js]` and runs it under the **launcher's bundled portable Node
(v22.22.3)**, not whatever `node` happens to be first on PATH. If the only
available interpreter is older than 22.19.0, `preflight()` returns
`REASON.VERSION_INCOMPATIBLE` with the detected version and the agent refuses
to start rather than failing every message.

### Binary resolution order

1. `~/.openagents/runtimes/pi/node_modules/.bin/pi` (`pi.cmd` on Windows)
2. legacy shared prefix `~/.openagents/nodejs/node_modules/.bin/pi`
3. the package's own entry point
   `…/node_modules/@earendil-works/pi-coding-agent/dist/cli.js`
   (covers an install that left no `.bin` shim)
4. codepage-safe PATH lookup (`whereBinary`) — survives a non-ASCII username
5. next to the running Node interpreter
6. common install locations
7. deep scan of every known bin dir (nvm / fnm / volta / Homebrew / …)

On Windows a `.cmd` shim is **parsed** into `[node, entry.js]` rather than
wrapped in `cmd.exe /c`: `cmd.exe`'s 8191-character command-line cap would
truncate the long `--append-system-prompt` argument and hang the agent. Both
npm shim dialects are handled — the modern `SET dp0=%~dp0` … `"%dp0%\…"` form
and the older/hand-written `"%~dp0\…"` form. (The sibling Claude and Cline
adapters recognise only the first; `parseWindowsCmdShim` in `pi-stream.js` is
pure and covered by tests that run on every OS, not just Windows.)

---

## Configuration

The Launcher exposes these values directly on Pi's **Configure** dialog; no
manual Pi file is required. Common profiles are:

| Target | Provider | API format | Base URL | Key |
|---|---|---|---|---|
| Native Claude API | `anthropic` | `auto` | blank | Anthropic key |
| Claude relay (Anthropic protocol) | `anthropic` | `anthropic-messages` | relay base | relay key |
| Claude/Codex relay (OpenAI chat protocol) | `openai` | `openai-completions` | relay base | relay key |
| Codex relay (Responses protocol) | `openai` | `openai-responses` | relay base | relay key |
| Native DeepSeek API | `deepseek` | `auto` | blank | DeepSeek key |
| Native OpenAI API | `openai` | `auto` | blank | OpenAI key |
| Codex subscription login already stored by Pi | `openai-codex` | `auto` | blank | blank |

Set `PI_MODEL` to the exact model id exposed by the selected service. For a
relay, use the relay's documented id rather than guessing from the upstream
model name.

```bash
agn env pi --set PI_PROVIDER=anthropic
agn env pi --set PI_MODEL=claude-sonnet-4-6
agn env pi --set PI_THINKING=medium
agn env pi --set PI_API_KEY=sk-ant-…
```

| Variable | Read by | Effect |
|---|---|---|
| `PI_PROVIDER` | the OpenAgents adapter | `--provider <name>` |
| `PI_MODEL` | the OpenAgents adapter | `--model <pattern>` |
| `PI_API_FORMAT` | the OpenAgents adapter | native auto-detection or a relay protocol |
| `PI_BASE_URL` | the OpenAgents adapter | process-local provider extension for a relay/proxy |
| `PI_API_KEY` | the OpenAgents adapter | mapped to the selected native provider or relay |
| `PI_THINKING` | the OpenAgents adapter | `--thinking <level>` (invalid values are dropped) |
| `PI_TRUST_PROJECT` | the OpenAgents adapter | `--approve` when `1/true/yes/on`, else `--no-approve` |
| provider-specific legacy key variables | **Pi itself** | still accepted for backwards compatibility |

Pi itself has no generic base-URL environment variable. OpenAgents supplies the
missing layer: native providers receive their conventional key environment, and
a custom `PI_BASE_URL` loads the bundled `pi-launcher-provider.mjs` extension
for that child process. It does not modify `~/.pi/agent/models.json`.

> **Naming note.** Pi *injects* resolved session values into commands run by its
> own `bash` tool. OpenAgents also uses the `PI_*` names as launcher inputs and
> translates them before Pi starts; the names remain consistent with
> `CODEX_MODEL` / `CLINE_MODEL` / `GOOSE_MODEL`.

### Authentication: your existing Pi login is reused

OpenAgents does **not** maintain a separate Pi credential store. Pi resolves
credentials from `~/.pi/agent/auth.json` first, then the environment, and the
adapter leaves that file completely alone. So both work:

- run `pi` once and use `/login` — the launcher's readiness check verifies that
  `~/.pi/agent/auth.json` contains at least one top-level provider entry (values
  are never logged or returned; an auto-created empty `{}` stays signed out), **or**
- set a provider API key in the launcher — it is injected as an environment
  variable.

**API keys are never passed as command-line arguments.** `--api-key` is never
emitted, so a key cannot appear in `ps`, a crash dump, a log line, the registry
or a session file. A test asserts the key is absent from argv and present in
the child's environment.

### Custom endpoints

Set `PI_BASE_URL` and select `PI_API_FORMAT`. The adapter explicitly loads a
bundled extension that calls `pi.registerProvider()` using the form values. The
extension reads the key from the child environment, is scoped to that process,
and never writes the secret or overwrites the user's global Pi configuration.

---

## Project trust policy — deny by default

**OpenAgents runs Pi with `--no-approve` unless you explicitly opt in.**

Pi's project trust controls whether it loads project-local resources from the
working directory: `.pi/settings.json`, `.pi/extensions`, `.pi/skills`,
`.pi/prompts`, `.pi/themes`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, and
project `.agents/skills`. Extensions in particular are **TypeScript modules
that execute with the full permissions of the Pi process**.

The workspace points Pi at an arbitrary user repository, which may be a clone
of code the user has not audited. Treating those files as trusted by default
would mean a repository could silently change Pi's settings and run its own
code the first time an agent opens it. So the default is deny:

- `--no-approve` is passed on **every** spawn unless `PI_TRUST_PROJECT` opts in
- OpenAgents **never writes or modifies** `~/.pi/agent/trust.json`; a saved
  decision the user made themselves in interactive Pi is not consulted, because
  the per-run flag overrides it
- to opt in per agent: `agn env pi --set PI_TRUST_PROJECT=1`

**What this does not protect against.** Pi has no sandbox: with trust denied it
still reads, writes and runs shell commands in the working directory with your
user's permissions. Project trust is an *input-loading* guard, not a security
boundary, and it does not stop prompt injection from repository content. For
untrusted repositories, run the launcher inside a container or VM.

`AGENTS.md` / `CLAUDE.md` context files load **regardless** of trust (Pi's
documented behavior). OpenAgents keeps that on. Note this means Pi may see
project instructions that partly overlap the injected workspace system context;
they coexist rather than conflict, but a project file with contradictory
instructions will compete with the workspace prompt. Disable it per agent by
adding `-nc` only if that becomes a problem — the adapter does not pass it today.

### Headless interaction is never blocking

If a user- or CLI-level Pi extension calls a blocking UI method (`select`,
`confirm`, `input`, `editor`), Pi emits an `extension_ui_request` and **waits**.
There is no terminal to answer it. The adapter immediately replies
`{"type":"extension_ui_response","id":…,"cancelled":true}` and posts a status
line saying an extension asked for input and was dismissed. Without this, one
such extension would hang the channel forever.

---

## Sessions

Each channel gets its own Pi session, addressed by a UUID **OpenAgents mints**:

```
--session-dir  ~/.openagents/pi-sessions/<workspaceId>_<agentName>/
--session-id   <uuid minted per channel>
```

`--session-id` **creates the session when it does not exist and resumes it when
it does** (verified against 0.83.0), so there is no session-id correlation
heuristic anywhere — the mapping is deterministic and survives process
restarts, daemon restarts and launcher restarts.

The channel → UUID map is persisted at
`~/.openagents/sessions/<workspaceId>_<agentName>_pi.json`.

Isolation is threefold:

- **Per workspace + agent** — a separate session file *and* a separate session
  directory, so two agents can never read each other's transcripts.
- **Per channel** — a separate UUID and a separate `pi` process.
- **Away from the user's project** — sessions never land in the working
  directory, and never in the shared `~/.pi/agent/sessions/`.

A missing, corrupt, or non-UUID stored id is discarded and a fresh one minted
(logged, redacted). A session bound to a different working directory is not
reused. `/restart` in a channel kills its process and clears its session id.

---

## Using it in a workspace

```bash
agn install pi
agn create my-pi --type pi --path /path/to/project
agn env pi --set PI_PROVIDER=anthropic
agn env pi --set ANTHROPIC_API_KEY=sk-ant-…
agn up
agn connect my-pi <workspace-token>
```

- The child's **cwd is the agent's configured `workingDir`**, always. A missing
  directory is reported as an error instead of silently falling back.
- Spawning uses an **argument array** — never a composed shell string — so a
  path or prompt containing spaces, quotes or shell metacharacters cannot be
  interpreted as a command.
- The workspace system context is injected with **`--append-system-prompt`**,
  never `--system-prompt` (which would *replace* Pi's own coding prompt and
  strip its tool instructions). It is built by `buildPiSystemPrompt()` in
  `workspace-prompt.js` with `toolMode: 'skills'` — Pi reaches the workspace
  REST API through its built-in `bash` tool and curl, exactly like the OpenCode
  and Amp adapters. **Pi is not wired to MCP**; only the Claude adapter uses
  `--mcp-config`.
- Plan mode (`this._mode === 'plan'`) is expressed in the system prompt. Because
  the prompt is fixed at spawn time, switching modes respawns the process — the
  session id is unchanged, so the conversation is preserved.

### Attachments

Image attachments are downloaded from the workspace and passed **inline** on the
RPC `prompt` command as `images: [{type:"image", data:<base64>, mimeType}]` —
Pi's documented image format. Non-image attachments (and images whose download
failed, with a visible notice) are described in the prompt with curl
instructions so Pi can fetch them with its `bash` + `read` tools.

---

## Interrupting & cleanup

**Stop** on a channel:

1. mark that channel's process `userStopped`
2. send the RPC `abort` command (with a unique id)
3. wait a 3 s grace period for `agent_settled` — a clean abort **keeps the
   process alive**, so the next message reuses its context
4. otherwise terminate the process tree (`SIGTERM` → `SIGKILL`, or
   `taskkill /F /T` on Windows)
5. reject every pending RPC with `PiCancelledError`, clear the queue, buffers,
   idle timer, watchdog and stream listeners

Other channels and other agents are untouched. "Execution stopped by user." is
posted exactly once (`_stopNoticeSent`).

Also handled explicitly: a CLI that exits immediately, stdin/stdout closing
early, a non-zero exit mid-turn (reported with redacted stderr tail), an RPC
response timeout, a response with an unknown id (logged, ignored), corrupt
JSONL, and daemon shutdown (`stop()` tears down every `pi` child so nothing
outlives the launcher).

**Asynchronous stdin failures.** A `Writable` reports `EPIPE` and a premature
pipe close through an `error` *event*, which the `try/catch` around
`stdin.write()` cannot see — an unhandled one would take the whole daemon down.
`proc.stdin` therefore carries its own error listener; a broken pipe is
remembered on the process record so later RPCs fail fast with a clear
cancellation instead of writing into the void.

---

## Security & privacy

- **No new dependencies.** Only Node built-ins (`string_decoder`,
  `child_process`, `crypto`, `fs`, `os`, `path`). A test asserts the package's
  dependency list is unchanged.
- **Redaction at one boundary.** `pi-stream.js` is pure and cannot know this
  agent's concrete credential values, so it only applies *pattern* redaction —
  which misses a key like Google's `AIza…` that matches no known shape. Every
  event therefore passes through `_redactEvent()` in the adapter, one choke
  point that re-masks the diagnostic fields (`preview`, `message`, `error`,
  `finalError`, `raw`, `title`) with the agent's exact secrets folded in, so a
  newly added event kind cannot forget it. Assistant message text is
  deliberately left intact — it is the model's reply to the user, and rewriting
  it would corrupt code and command output. Logged argv elides the system
  prompt (which embeds the workspace token) as `<N chars>`.
- **`PI_SKIP_VERSION_CHECK=1`** is set for the child so a launcher-managed
  install does not phone home for update checks mid-session.
- Pi has **no sandbox** and the built-in tools run with your user's permissions.
  This is the same posture as every other CLI agent in the catalog.

---

## Launcher visibility

Pi is implemented, runnable, and included in `CORE_AGENTS`. It is installable
from the Launcher marketplace and available during onboarding. The Configure
dialog owns native-provider and relay setup end to end.

---

## Known limitations

- **The remote catalog may not list `pi` yet.** The launcher reads
  remote API → 24 h local cache → bundled `registry.json`. Until the remote
  catalog is updated, users on a fresh cache see Pi only via the bundled
  fallback; a user whose cache was populated from a remote catalog *without*
  `pi` will not see the row until the cache expires or the remote catalog adds
  it. `agn install pi` works regardless, because the CLI reads the same bundled
  registry.
- **`npm run build:registry` cannot run in this repo.** Its `REGISTRY_DIR`
  resolves to `<repo>/src/openagents/registry`, but the sources live in
  `sdk/src/openagents/registry`, so it exits 1 before reading anything (a
  pre-existing condition, unrelated to Pi). `pi.yaml` and the `pi` entry in
  `packages/agent-connector/registry.json` are therefore maintained **by hand
  in two places**. A test (`test/pi.test.js` → "keeps the registry.json entry
  identical to the pi.yaml source") cross-checks the fields that matter, but a
  new field added to only one of the files will not be caught automatically.
  The adapter reads the npm package name and the version floor **from** the
  registry entry (and the entry-point path from the installed package's own
  manifest), so a catalog bump cannot leave the runtime probing a stale path
  or enforcing a stale minimum.
- **Pi event-schema drift.** The `EVENT_KIND_BY_TYPE` table was verified against
  0.83.0. A future Pi release that renames or restructures an event degrades
  that event to a logged `unknown` — fidelity drops (a status line goes
  missing), the turn does not crash. The one event that would actually break a
  turn if renamed is `agent_settled`; the watchdog is the backstop (it kills a
  process silent for ~5 minutes and tells the user). Re-verify the table on
  every Pi upgrade.
- **No MCP.** Workspace tools go through bash + curl, so Pi cannot use the
  native `workspace_*` MCP tools.
- **Model/provider are fixed per process.** Changing `PI_MODEL` takes effect on
  the next spawn (after an idle release, a `/restart`, or a mode switch), not
  mid-conversation. The RPC `set_model` command exists but is not wired.
- **No end-to-end run against a real provider** has been performed — every test
  uses a mock CLI. See the delivery notes for the manual acceptance steps.
