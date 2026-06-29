# NanoClaw (containerized agent runtime)

NanoClaw lets a NanoClaw **Agent Group** act as an OpenAgents Workspace agent.
Unlike most OpenAgents agents, NanoClaw is **not** a stdin/stdout CLI and **not**
a direct LLM API — it is an independent **containerized agent runtime**. Each
Agent Group runs in its own Docker container (Apple Container on macOS; WSL2 on
Windows), with its own `CLAUDE.md`, memory, and mounts, on top of the Claude
Agent SDK.

Because NanoClaw exposes **no HTTP API and no message queue** — its only
integration surface is the official *channel* extension point — OpenAgents
bridges to it through a small **native NanoClaw `openagents` channel**, the same
way Telegram/Slack/Discord plug in. The OpenAgents connector talks to that
channel over a local Unix socket and does all Workspace IO; **no Workspace token
is ever stored inside NanoClaw**, and **no NanoClaw database is read or written**.

```
OpenAgents Workspace
   │  (poll messages / post events)
   ▼
OpenAgents connector  ── nanoclaw adapter ──┐   data/openagents/bridge.sock (local IPC)
                                            ▼
NanoClaw host ── router ── Session ── Docker container (Agent Group) ── reply
   ▲                                                                     │
   └────────────── native openagents channel ◀──────────────────────────┘
```

| OpenAgents      | NanoClaw                                                       |
| --------------- | -------------------------------------------------------------- |
| Agent           | **Agent Group** (`NANOCLAW_AGENT_GROUP`)                       |
| Channel         | **Session** (per channel + thread epoch; `session_mode per-thread` recommended) |
| Channel id      | messaging group `platform_id = oa:<workspace>:<channel>` (`channel_type openagents`) |

## How NanoClaw differs from an ordinary CLI agent

| | Ordinary CLI agent (Claude, Codex, …) | NanoClaw |
| --- | --- | --- |
| Execution | local subprocess per message | persistent Docker container per Agent Group |
| Transport | stdin/stdout / API | native NanoClaw channel over a local socket |
| Isolation | process | container + filesystem mounts |
| State | per-channel session file | Agent Group memory + per-session DBs (managed by NanoClaw) |
| Credentials | OpenAgents env | configured **inside** NanoClaw (never duplicated) |

## Requirements

- **NanoClaw** checked out and set up (`pnpm install`, `./nanoclaw.sh setup`).
  Verified against:
  - remote `https://github.com/nanocoai/nanoclaw`
  - commit `625264ba4b9de0a466d10debb267ca9ad688f4c0` (the cloned `main` HEAD,
    reporting version 2.1.19) — **this is a `main` commit, NOT a confirmed tagged
    release** (`tag: null`).

  The channel installer auto-installs **only into this exact verified commit**
  (a different commit — even with the same version number — or an undeterminable
  commit is **not** auto-installed and the checkout is left untouched). An
  explicit, off-by-default `force` (admin/CLI only; never a Workspace user) can
  override the commit gate, but the structural/interface check is always
  enforced.
- **Node.js** + **pnpm** (NanoClaw's host process).
- **Docker** running (the container runtime). `docker info` must succeed.
- The OpenAgents **`openagents` channel** installed into your NanoClaw checkout
  (see below) and the NanoClaw **host running**.

### Platform support

- **macOS** — Docker Desktop, or NanoClaw's Apple Container runtime.
- **Linux** — Docker Engine / Docker Desktop.
- **Windows** — **requires WSL2 + Docker Desktop**. Run NanoClaw inside WSL2; the
  OpenAgents connector and the `data/*.sock` IPC live inside the WSL2 filesystem.
  (Native-Windows NanoClaw is not supported.)

## Setup

### 1. Install + run NanoClaw

Follow <https://github.com/nanocoai/nanoclaw>: clone, `pnpm install`,
`./nanoclaw.sh setup`, configure a provider (e.g. Anthropic) for your Agent
Group. Symlink the CLI onto your PATH so detection and management work:

```bash
ln -s "$(pwd)/bin/ncl" /usr/local/bin/ncl
```

Confirm the host is up:

```bash
ncl groups list        # lists your Agent Groups (host must be running)
```

### 2. Install the OpenAgents channel into NanoClaw

The channel ships with the OpenAgents launcher
(`packages/agent-connector/nanoclaw-channel/openagents.ts`). Install it either:

- **Automatically** — the Launcher copies it into `<nanoclaw>/src/channels/` and
  adds the barrel import for you, then asks you to restart the host, **or**
- **Manually** — run the `/add-openagents` skill, or copy `openagents.ts` to
  `<nanoclaw>/src/channels/` and append `import './openagents.js';` to
  `src/channels/index.ts`.

Then **restart the NanoClaw host**. You should see `openagents channel listening`
in the logs and a `data/openagents/bridge.sock` socket file (plus a `0600`
`data/openagents/secret` and an `outbox/` dir). The installer is **commit-gated
and rollback-safe**: it auto-installs only into the exact verified commit (a
different/unknown commit is refused without modifying anything), enforces the
ChannelAdapter structural check even under `force`, never overwrites a channel
file you wrote yourself, edits the barrel via a precise marker block, and restores
the barrel on any failure.

### 3. Pick (or create) an Agent Group

```bash
ncl groups list        # note the id/name you want to expose
```

Creating Agent Groups (and wirings) is **approval-gated** in NanoClaw — the
bridge never creates or mutates them silently. Create groups through NanoClaw's
own onboarding (`/init-first-agent`, `/manage-channels`).

### 4. Wire the channel to the Agent Group

Routing requires a wiring from the `openagents` messaging group to your Agent
Group. The first inbound message auto-creates the messaging group; wire it
(approving when prompted):

```bash
ncl wirings create \
  --messaging-group-id <openagents-mg-id> \
  --agent-group-id <your-agent-group-id> \
  --engage-mode pattern --engage-pattern . \
  --session-mode per-thread
```

Use `--engage-mode pattern --engage-pattern .` to always engage (recommended), or
`--engage-mode mention` (engages on DM-style messages — the channel marks each
OpenAgents channel as a DM). **`--session-mode per-thread` is recommended**: the
connector uses a per-channel thread "epoch", so each conversation maps to its own
NanoClaw session and a Stop opens a fresh one (concurrent + clean). `shared` also
works and is safe, but after a Stop the next message is processed serially behind
the old task in the one shared container.

### 5. Connect from OpenAgents

Configure the agent's environment:

| Variable | Required | Meaning |
| --- | --- | --- |
| `NANOCLAW_AGENT_GROUP` | yes | Agent Group id **or** name to bridge |
| `NANOCLAW_HOME` | if `ncl` not on PATH | path to your NanoClaw checkout |
| `NANOCLAW_REPLY_TIMEOUT_MS` | no | per-turn hard timeout (default 180000) |
| `NANOCLAW_REPLY_SILENCE_MS` | no | end a turn this long after the last reply chunk (default 6000) |

Start the agent from the Launcher (NanoClaw appears under Install as **Beta**) or
the `agn` CLI. On connect the adapter detects NanoClaw, Docker, the host, and the
Agent Group, and surfaces actionable errors if anything is missing.

## Sessions & message isolation

- Each OpenAgents **channel** maps to a distinct `platform_id`
  (`oa:<workspace>:<channel>`) → a distinct NanoClaw messaging group. The connector
  also sends a per-channel **thread epoch** (`threadId = oa-<epoch>`); with
  `session_mode per-thread` each epoch is its own **session**, and a Stop bumps the
  epoch to start a fresh one. Channels never share a session.
- Within one session, NanoClaw runs turns **serially** (its native semantics);
  the bridge preserves that and does not override concurrency. Different sessions
  (channels) run concurrently in their own containers.
- Every forwarded message carries a **stable unique id** (`oa:<workspace>:<msgid>`),
  so a reconnect or redelivery never produces a duplicate NanoClaw message, and
  the agent's own output is never looped back in.

## Status, interruption, reconnect

- **Status** — the bridge maps NanoClaw's typing/working indicator to OpenAgents
  *status* events, outbound chat to *text*/*completion*, and host/channel errors
  to *error*. A coarse container-status watchdog (`ncl sessions list`) flags a
  container that exits unexpectedly.
- **Reliable delivery (at-least-once + dedup)** — outbound replies are not
  fire-and-forget. Each reply is **persisted by the channel to a local outbox**
  (`data/openagents/outbox/`) *before* it is sent, and held until the connector
  ACKs it; the connector ACKs only after the reply is reliably handed to the
  Workspace, then deletes the disk record. Because the outbox is on disk, un-ACKed
  replies survive a **Channel or NanoClaw-host restart** (not just a connector
  reconnect) — they are reloaded on startup and replayed on every (re)connect. The
  connector persists processed `outId`s, so a replay is re-ACKed but **not**
  re-displayed.
  - Precise guarantee: *In the case where the Channel's persisted outbox is
    available, has not exceeded its retention window, and its state files have
    not been manually deleted, ACK + replay provides at-least-once outbound
    delivery, and the connector's persisted `outId` dedup avoids re-displaying
    duplicates.* This is **NOT** unconditional exactly-once.
  - **Bounds & loss:** the outbox is bounded (max records) and TTL'd. On overflow
    or expiry a queued reply is **dropped** (the channel emits a `dropped`
    overflow/expired signal that surfaces as a Workspace status, and logs it) and
    **may be unrecoverable.** A crash between delivering a reply and persisting
    its `outId`, or a deleted/corrupt connector state dir, can re-display one
    reply.
  - **Sensitive cache:** the outbox stores reply **bodies** — it is local
    sensitive cache (`0600` files in a `0700` dir). It never stores the handshake
    secret, the Workspace token, or provider credentials. The connector's `outId`
    dedup file stores **only** `outId`s + timestamps (no bodies/tokens).
- **ACK confirmation point** — the connector ACKs a reply only after
  `sendMessage` (an HTTP POST to the Workspace REST API) returns success, i.e. the
  reply is **persisted in the Workspace backend**, not merely emitted. A failed
  POST does not ACK, so the channel replays it.
- **Timeout** — if no reply arrives within `NANOCLAW_REPLY_TIMEOUT_MS`, the
  channel reports a timeout (the agent may still be working — send again).
- **Stop = stop waiting (detach), NOT cancel** — NanoClaw has **no** native
  per-message cancel from a channel surface. When you press Stop, the bridge
  stops *waiting on* and *delivering* the current turn and shows **"Stopped —
  replies from the previous task are dropped; a new message starts a fresh NanoClaw
  session"** (not "Cancelled"). The container task may **keep running** — to truly
  cancel it, use NanoClaw's own controls. Stop never kills the Agent Group, the
  NanoClaw host, or any shared container.
  - **Why a fresh session, not reuse.** NanoClaw exposes **no** outbound-drained /
    queue-empty / delivery-completed signal, and `container_status: stopped` does
    **not** prove the host delivery sweep has flushed the session's last outbound
    (the sweep delivers any *active* session's remaining replies regardless of
    container state). So the bridge never waits on or reuses the stopped session.
  - **How old replies are kept out.** Each Stop bumps a per-channel **thread
    epoch** → the next message uses a new `threadId` → a fresh NanoClaw session
    (the officially-supported per-thread routing, under the *same* wiring — no new
    approval, no DB access). NanoClaw stamps every outbound with the **authoritative
    `thread_id` of its triggering inbound**, so the old session's replies — even
    arriving long after the new message — carry the old `threadId` and are dropped
    reliably. The new session's replies carry the new `threadId` and flow normally.

## Local IPC security

The `data/openagents/bridge.sock` socket is the trust boundary between the
OpenAgents connector and the NanoClaw channel. It is protected by:

- A dedicated **`data/openagents/` directory locked to `0700`** (owned by the
  host user), holding the **socket `0600`**, the **secret file `0600`**, and the
  **`outbox/` (`0700`, records `0600`)**. Stale-socket cleanup only removes an
  actual socket file (never a regular file or symlink), and symlinked paths are
  refused (no path-escape).
- A **handshake secret**: on startup the channel generates a random per-host
  secret and writes it to `data/openagents/secret`; the connector reads it and
  presents it in `hello` (with `protocol: 1`). Until the handshake succeeds, no
  `inbound`/`cancel`/`ack` is accepted and no `outbound` is sent; the server
  re-authenticates on every reconnect.
- **Single connector**: only one authenticated connector is allowed at a time. A
  second handshake is rejected (`single_connection`) while one is attached; the
  old connection must drop before a new one can take over.
- **Trust boundary = the current OS user.** The `0600`/`0700` perms plus the
  secret defend against *other local users*. They do **not** defend against a
  malicious process running **as the same OS user** — such a process can read the
  secret file and connect. Treat the host account as the boundary. (Peer-credential
  checks aren't uniformly available in pure Node, so the random secret is the
  cross-platform mechanism; on Linux/macOS the file modes restrict to the same
  user.)
- The secret **never** enters the Workspace, the container (the channel runs in
  the host, not the container), or logs.

## Permissions, mounts & security

- Agents run in **containers** and see only what the Agent Group's config mounts.
  Manage mounts inside NanoClaw (`/manage-mounts`) — the bridge does not change
  them.
- Credentials live **inside NanoClaw** (its provider config / OneCLI vault). The
  OpenAgents Workspace token is **never** sent over the IPC socket or stored in
  NanoClaw.
- The control socket (`data/ncl.sock`) is NanoClaw's own (`0600`); the bridge
  only issues read-only `list`/`get` commands on it.
- Logs are redacted: tokens, API keys, bearer/cookie values, the IPC secret, and
  configured secrets never appear in adapter logs.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "NanoClaw is not installed…" | checkout not found | set `NANOCLAW_HOME`, or symlink `ncl` onto PATH |
| "Docker is not available…" | Docker daemon down | start Docker Desktop / the daemon (Windows: WSL2) |
| "host service is not running…" | NanoClaw host stopped | start it (`./nanoclaw.sh start`, launchd/systemd) |
| "Agent Group was not found…" | wrong `NANOCLAW_AGENT_GROUP` | `ncl groups list` and set id/name; or it's ambiguous (set one) |
| "`openagents` channel is not loaded…" | channel not installed / host not restarted | run `/add-openagents`, restart the host |
| "not wired to the Agent Group…" | wiring missing (approval-gated) | `ncl wirings create …` and approve |
| "did not reply in time…" | cold container / long task | raise `NANOCLAW_REPLY_TIMEOUT_MS`; retry |

## Known limitations

- **Tool-call granularity** — the host (and any channel) sees the agent's
  outbound chat messages and a coarse typing/working indicator, **not** granular
  in-container tool-call traces. The bridge surfaces status/text/completion/error
  events; per-tool events are not exposed by NanoClaw's channel surface.
- **Stop is detach + fresh session, not cancel** — Stop stops OpenAgents from
  waiting on / delivering the turn; the NanoClaw container task may keep running.
  NanoClaw exposes **no** outbound-drained/queue-empty signal (and
  `container_status: stopped` ≠ drained — the delivery sweep still flushes a
  stopped session's replies), so the bridge never reuses the stopped session.
  Instead each Stop rotates the channel's **thread epoch** so the next message
  opens a fresh NanoClaw session (per-thread routing under the same wiring); the
  old session's replies carry the authoritative old `thread_id` and are dropped.
  No native per-message cancel exists. **Best behaviour needs the wiring's
  `session_mode: per-thread`** so each epoch is its own container (concurrent +
  clean); with `shared` it is still safe, but a post-Stop message is processed
  serially behind the old task in the one container.
- **Delivery is at-least-once with dedup, not exactly-once** — a crash between
  delivering a reply and persisting its `outId`, a deleted/corrupt connector state
  dir, or an **outbox overflow/expiry** (the channel outbox is bounded + TTL'd and
  drops + signals on overflow/expiry) can drop or re-display a reply (see
  *Reliable delivery* above).
- **Agent Group / wiring creation is approval-gated** — the bridge detects and
  guides, it does not auto-provision.
- **Commit-gated channel install** — installing the channel modifies the NanoClaw
  checkout (one file + a marker-delimited barrel import) and needs a host restart.
  It is `protocol: 1` and auto-installs **only into the exact verified commit**
  `625264ba…` (a `main` commit, NOT a confirmed tagged release); a different/
  unknown commit is refused and the checkout left untouched. An off-by-default,
  admin-only `force` can override the commit gate but never the structural check.
  If NanoClaw changes its `ChannelAdapter` interface, update `openagents.ts`.
- **One connector per NanoClaw host** — the channel rejects a second connector
  while one is attached (`single_connection`); the old must drop first. Bridging
  multiple workspaces from one NanoClaw host is not supported.
- **Real Docker container E2E is not yet run in this environment** (no Docker +
  provider credentials + running host on the dev box); see *Verification* notes.
- **`support.collaboration` is `false`** — this bridge has no native OpenAgents
  A2A/MCP collaboration; the Agent Group participates as a single agent.
