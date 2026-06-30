# NanoClaw `openagents` channel

A **native NanoClaw channel** that bridges a NanoClaw Agent Group to an
OpenAgents Workspace. This is the NanoClaw-side half of the OpenAgents
`nanoclaw` adapter; the OpenAgents-side half lives in
`../src/adapters/nanoclaw*.js`.

## Why a channel (and not DB polling)

NanoClaw is a containerized agent runtime with **no HTTP API and no message
queue** — its only message transports are SQLite files per session and the
official *channel* extension point. Channels (telegram, slack, discord, the
built-in `cli`) are how external systems exchange messages with an Agent Group.
Implementing OpenAgents as a channel means we ride the native
router → session → container → delivery path with **zero database access** and
correct, isolated, per-channel sessions.

## Files

- `openagents.ts` — the channel (a `ChannelAdapter`). Owns a Unix-socket server
  at `<nanoclaw>/data/openagents.sock`. The OpenAgents connector is the client.
- `skill/SKILL.md` — the `/add-openagents` install skill (NanoClaw skill
  format), the auditable manual install path.

## Install

Either:

1. **Automatic** — the OpenAgents Launcher copies `openagents.ts` into
   `<nanoclaw>/src/channels/` and adds the barrel import for you, then asks you
   to restart the NanoClaw host. (See `../src/adapters/nanoclaw-channel-install.js`.)
2. **Manual** — run the `/add-openagents` skill, or copy the file and append
   `import './openagents.js';` to `src/channels/index.ts`, then restart.

## Wire format & trust boundary

One JSON object per line, both directions over `data/openagents/bridge.sock`
(in a `0700` dir; socket `0600`). The connector must present a random per-host
**secret** (from the `0600` `data/openagents/secret` file) in `hello` with
`protocol: 1`; until the handshake succeeds no `inbound`/`cancel`/`ack` is
accepted and no `outbound` is sent, and the server re-authenticates on every
reconnect. **Only one** authenticated connector is allowed (a second is rejected
`single_connection`). The Workspace token and the secret are **never** sent to
the Workspace, the container, or logs. **Trust boundary = the current OS user**:
the perms + secret defend against other local users, NOT a process running as the
same user. See the header of `openagents.ts` for the full spec.

## Delivery

At-least-once with dedup. The channel **persists** each outbound to
`data/openagents/outbox/` (`0600` records in a `0700` dir) *before* sending and
holds it until the connector ACKs it, so un-ACKed replies survive a **Channel or
host restart** (reloaded on startup, replayed on every reconnect). The connector
ACKs only after the reply is persisted in the Workspace backend, and dedups by
persisted `outId`. This is **not** unconditional exactly-once: the outbox is
bounded + TTL'd and **drops + signals** on overflow/expiry, and a crash between
deliver and persist (or a cleared connector state dir) can drop or re-display a
reply. The outbox holds reply **bodies** — local sensitive cache; it never holds
the secret, the Workspace token, or credentials.

## Stop = detach + fresh session

NanoClaw has no native per-message cancel and exposes no outbound-drained signal
(`container_status: stopped` ≠ drained — the delivery sweep still flushes a
stopped session's replies), so the connector never reuses the stopped session.
On Stop it rotates a per-channel **thread epoch** → the next message opens a fresh
NanoClaw session (per-thread routing, same wiring). NanoClaw stamps outbound with
the authoritative `thread_id` of its triggering inbound, so the old session's late
replies carry the old `threadId` and are reliably dropped. The container task may
keep running.

## Mapping

| OpenAgents            | NanoClaw                                              |
| --------------------- | ---------------------------------------------------- |
| Agent                 | Agent Group (`NANOCLAW_AGENT_GROUP`)                 |
| Channel               | Session (one per channel, `session_mode shared`)     |
| Channel id            | `platform_id = oa:<workspace>:<channel>` (`openagents`) |

## Compatibility

Verified against NanoClaw remote `https://github.com/nanocoai/nanoclaw`, **commit
`625264ba4b9de0a466d10debb267ca9ad688f4c0`** (cloned `main` HEAD reporting 2.1.19
— **not** a confirmed tagged release; `tag: null`). The installer auto-installs
**only into this exact commit** and **refuses a different/unknown commit without
modifying the checkout** (an off-by-default, admin-only `force` can override the
commit gate but never the structural check). If NanoClaw changes the
`ChannelAdapter` interface, update `openagents.ts`; the wire protocol is versioned
(`protocol: 1`).
