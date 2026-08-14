# Platform Gateway

Bridges an OpenAgents agent to Slack, Lark or Telegram. Someone messages the
bot on their platform, the agent answers, and the whole exchange is visible and
answerable from the workspace.

Runs as its own deployment unit — same repository, separate Railway service,
separate database. Not a separate machine.

## Why it isn't part of the backend

Four reasons, in the order they bite:

- **A webhook has three seconds; an agent takes minutes.** Something in between
  has to accept the delivery, acknowledge it, and finish later. That needs a
  durable queue, not a request handler.
- **The backend runs two replicas.** A consumer living inside it would run
  twice, and both copies would send the same reply.
- **The backend does not hold third-party credentials, and should not start.**
  It holds every customer's workspace data, which makes it the more valuable
  target; Slack tokens belong on the smaller, more replaceable service.
- **Platform APIs change on their own schedule.** Deploying a Slack fix should
  not restart the workspace API.

## How a message moves

```
Slack ──webhook──▶ gateway ──ingest──▶ backend ──▶ agent
                      ▲                   │
                      └────event stream───┘
                                │
Slack ◀───── outbox ◀───────────┘
```

Inbound, the request handler does exactly one durable write and returns. A
worker then downloads any attachments, stores them, and posts a single message
carrying their ids. The unique key on `(platform, installation, external event
id)` is what makes a platform's retry harmless.

Outbound is driven by the stream, not by a timer. The stream carries no
content — only "there is news" — because the backend publishes through Redis
pub/sub, which cannot replay what you missed while reconnecting. So a frame
wakes the gateway and a durable cursor moves the data. Draining writes to the
outbox and advances the cursor in one transaction, so the cursor can never
point past an event with no record of it.

## What the guarantee actually is

**Effectively-once.** Both directions are deduplicated on ids that survive a
restart — the platform's event id inbound, the OA event id outbound — and no
reply is sent before a row exists for it.

The gap is the last hop. A send can succeed while its response is lost, and no
platform offers a transactional way to close that. So a redelivery is possible;
a silent loss is not.

## Local development

```bash
cp .env.example .env      # fill in OA_SERVICE_KEY and GATEWAY_ENCRYPTION_KEY
npm install
npm run dev
```

`openssl rand -base64 32` produces an encryption key. Treat it as durable
state: rotating it makes stored credentials unreadable, which means every
connected workspace has to run OAuth again.

Platforms need to reach the gateway, so local work needs a tunnel:

```bash
cloudflared tunnel --url http://localhost:8080
```

Then point the platform's Request URL at `<tunnel>/webhooks/slack`. A free
ngrok tunnel changes hostname on every restart, and the URL has to be updated
in the platform's settings each time — worth knowing before it wastes an
afternoon.

## Schema

Four tables, applied at boot from `migrations/001_init.sql`.

| Table | Holds |
|---|---|
| `platform_installations` | Per-app credentials, encrypted |
| `bindings` | Exported agent, its credential, its cursor and lease |
| `inbound_deliveries` | Webhooks, deduplicated and retried |
| `outbound_deliveries` | Replies, deduplicated and retried |

Conversation mapping is deliberately not here. It has to be created in the same
transaction as the OA channel it points at, so the backend owns it and hands
the identifiers back with every outbound event.

## Adding a platform

Implement `PlatformAdapter` in `src/platforms/` and register it. The interface
is deliberately small — identify, verify and classify, send — because that is
the whole of what differs. Everything about durability, retries, deduplication
and cursors is shared and should stay that way.

Two differences worth knowing before starting:

- **Lark and Feishu are separate tenant systems** with different API hosts.
  Getting this wrong produces confusing authentication failures rather than an
  obvious error.
- **Telegram's privacy mode** stops a bot in a group from seeing ordinary
  messages. The documented guarantees cover commands and replies to the bot;
  plain `@mentions` need testing against the real thing rather than trusting
  the docs.
