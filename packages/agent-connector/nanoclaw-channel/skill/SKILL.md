---
name: add-openagents
description: Add the OpenAgents Workspace channel so this NanoClaw Agent Group can be driven from an OpenAgents Workspace.
---

# Add OpenAgents Channel

Adds a native NanoClaw channel (`channel_type: openagents`) that lets an
OpenAgents Workspace talk to one of your Agent Groups. It plumbs into the normal
router/delivery path like the built-in `cli` channel — **no database access**,
no host special-casing. The channel owns a local Unix socket at
`data/openagents/bridge.sock`; the OpenAgents agent-connector (`@openagents-org/agent-launcher`,
adapter `nanoclaw`) is the client and does all Workspace IO. **No OpenAgents
token is stored in NanoClaw.**

## Install

### Pre-flight (idempotent)

Skip to **Wire an Agent Group** if all of these are already in place:

- `src/channels/openagents.ts` exists
- `src/channels/index.ts` contains `import './openagents.js';`

Otherwise continue. Every step below is safe to re-run.

### 1. Copy the channel module

The channel source ships with the OpenAgents agent-launcher. Copy it from the
installed package (preferred), or fetch it from the OpenAgents repo:

```bash
# From the installed launcher package (path may vary by install method):
cp "$(node -e "process.stdout.write(require.resolve('@openagents-org/agent-launcher/nanoclaw-channel/openagents.ts'))" 2>/dev/null \
   || echo "$HOME/.openagents/runtimes/nanoclaw/node_modules/@openagents-org/agent-launcher/nanoclaw-channel/openagents.ts")" \
  src/channels/openagents.ts

# …or fetch from source:
# curl -fsSL https://raw.githubusercontent.com/openagents-org/openagents/develop/packages/agent-connector/nanoclaw-channel/openagents.ts \
#   -o src/channels/openagents.ts
```

> The OpenAgents Launcher can also install this for you automatically — it calls
> the same copy + barrel-patch. This skill is the manual / auditable path.

### 2. Append the self-registration import

Append to `src/channels/index.ts` (skip if already present):

```typescript
// openagents channel (OpenAgents Workspace bridge)
import './openagents.js';
```

### 3. Restart the NanoClaw host

The channel self-registers on startup. Restart the host (`./nanoclaw.sh restart`,
or your launchd/systemd unit) so it loads. After restart you should see
`openagents channel listening` in the logs and a `data/openagents/bridge.sock` file.

## Wire an Agent Group

Routing requires a wiring from an `openagents` messaging group to your Agent
Group. **Creating wirings is approval-gated in NanoClaw** — do it explicitly:

1. Pick (or create) the Agent Group you want to expose: `ncl groups list`.
2. The OpenAgents connector addresses each Workspace channel as
   `platform_id = oa:<workspace>:<channel>` on `channel_type = openagents`.
   The first inbound message auto-creates that messaging group.
3. Wire it to your Agent Group with an always-engaging mode (DM-style mention,
   or pattern `.`), approving when prompted:

   ```bash
   ncl wirings create \
     --messaging-group-id <openagents-mg-id> \
     --agent-group-id <your-agent-group-id> \
     --engage-mode mention \
     --session-mode shared
   ```

   `session-mode shared` gives one isolated NanoClaw Session per Workspace
   channel. Use `mention` (engages on DM-style messages) or `pattern` with
   `--engage-pattern .` to always engage.

## Notes & limits

- The host (and therefore this channel) sees the agent's **outbound chat
  messages** and a coarse **typing/working** indicator — not granular
  in-container tool calls. The bridge maps typing→status, chat→text, and
  surfaces errors; fine-grained tool-call traces are not exposed by NanoClaw's
  channel surface.
- **Local IPC is authenticated.** The socket lives in a `0700` `data/openagents/`
  dir (socket `0600`); the connector presents a random per-host secret
  (`data/openagents/secret`, `0600`) in its handshake. Only one connector is
  allowed at a time. The secret never leaves the host. **Trust boundary = the
  current OS user** — the perms + secret defend against other local users, not a
  process running as the same user.
- **Delivery is at-least-once with dedup, not exactly-once.** Each reply is
  PERSISTED to `data/openagents/outbox/` (`0600`) before sending and held until
  ACKed, so un-ACKed replies survive a Channel/host restart (replayed on
  reconnect). The connector ACKs after the reply is persisted in the Workspace and
  dedups by persisted `outId`. The outbox is bounded + TTL'd and drops + signals
  on overflow/expiry; a crash between deliver and persist, or a cleared state dir,
  can drop or re-display a reply. The outbox holds reply bodies (local sensitive
  cache) — never the secret/token/credentials.
- **Stop = detach + fresh session, not cancel.** NanoClaw exposes no
  outbound-drained signal (and `container_status: stopped` ≠ drained), so the
  connector never reuses the stopped session. On Stop it rotates a per-channel
  thread epoch → the next message opens a fresh NanoClaw session (per-thread
  routing under the same wiring); the old session's replies carry the authoritative
  old `thread_id` and are dropped. The container task may keep running — use
  NanoClaw's own controls for true cancellation. Wire `session_mode: per-thread`
  for clean, concurrent fresh sessions.
- **Auto-install is gated to the exact verified NanoClaw commit** — a different/
  unknown commit is refused (admin-only `force` can override; structural check is
  always enforced).
- Removing the channel: run the OpenAgents uninstaller, or delete
  `src/channels/openagents.ts` and drop the marker-delimited barrel block, then
  restart. This never stops the host or other channels.
