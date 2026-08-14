/**
 * Slack adapter.
 *
 * One Slack app per exported agent. That is what makes the bot carry the
 * agent's own name — a shared app would show ours — and it removes the
 * question of which agent should answer, because an installation has exactly
 * one binding.
 *
 * Three Slack behaviours shape most of the code here:
 *
 * - **Signatures are over the raw bytes.** A body that was parsed and
 *   re-serialised will not verify, so the request handler keeps the original
 *   and passes it through untouched.
 * - **A channel sends us everything said in it.** Only messages addressed to
 *   this bot are ours; the rest are dropped before they reach the workspace.
 * - **Files are private.** `url_private` needs the installation's bot token,
 *   so downloading is the adapter's job rather than something the backend can
 *   be handed a URL for.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  InboundAttachment,
  Installation,
  OutboundMessage,
  PlatformAdapter,
  RawWebhook,
  WebhookVerdict,
} from './types.js';

const SLACK_API = 'https://slack.com/api';

/** Slack's own replay window. Anything older is refused. */
const MAX_SIGNATURE_AGE_SECONDS = 60 * 5;

interface SlackCredentials {
  botToken: string;
  signingSecret: string;
  botUserId: string;
}

interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  event_id?: string;
  team_id?: string;
  api_app_id?: string;
  event?: SlackEvent;
}

interface SlackEvent {
  type?: string;
  subtype?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  channel?: string;
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
  files?: SlackFile[];
}

interface SlackFile {
  id?: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
}

function header(raw: RawWebhook, name: string): string | null {
  const value = raw.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Verify `v0=<hmac>` over `v0:<timestamp>:<body>`.
 *
 * The timestamp check is not decoration: without it a captured request stays
 * valid forever, and its signature is genuine.
 */
function verifySignature(raw: RawWebhook, signingSecret: string): void {
  const timestamp = header(raw, 'x-slack-request-timestamp');
  const signature = header(raw, 'x-slack-signature');
  if (!timestamp || !signature) {
    throw new Error('missing Slack signature headers');
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SIGNATURE_AGE_SECONDS) {
    throw new Error('Slack signature timestamp is outside the replay window');
  }

  const expected =
    'v0=' +
    createHmac('sha256', signingSecret)
      .update(`v0:${timestamp}:${raw.rawBody.toString('utf-8')}`)
      .digest('hex');

  const a = Buffer.from(expected, 'utf-8');
  const b = Buffer.from(signature, 'utf-8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('Slack signature mismatch');
  }
}

/** True when the text @-mentions this bot. Slack encodes it as `<@U123>`. */
function mentionsBot(text: string, botUserId: string): boolean {
  return text.includes(`<@${botUserId}>`);
}

/** Drop the bot mention so the agent doesn't read its own handle as content. */
function stripMention(text: string, botUserId: string): string {
  return text.replace(new RegExp(`<@${botUserId}>`, 'g'), '').trim();
}

async function downloadFile(file: SlackFile, botToken: string): Promise<Buffer> {
  if (!file.url_private) throw new Error(`file ${file.id} has no url_private`);
  const res = await fetch(file.url_private, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!res.ok) {
    throw new Error(`downloading ${file.id} returned HTTP ${res.status}`);
  }
  // Slack answers an unauthorised download with an HTML sign-in page and a
  // 200, so the status alone does not tell us it worked.
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    throw new Error(`downloading ${file.id} returned a sign-in page — check the bot token scopes`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function slackApi<T>(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${botToken}`,
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as { ok?: boolean; error?: string } & T;
  if (!parsed.ok) {
    // Slack reports failures in the body with HTTP 200, so the status is not
    // what tells us whether this worked.
    throw new Error(`slack ${method} failed: ${parsed.error ?? 'unknown error'}`);
  }
  return parsed;
}

/**
 * Split the conversation key the backend composed.
 *
 * Mirrors `build_external_key` in app/integrations/conversations.py:
 *   slack/dm/<team>/<channel>
 *   slack/thread/<team>/<channel>/<thread_ts>
 *
 * The backend owns this format precisely so a gateway cannot invent keys of
 * its own; reading it back is the price of that.
 */
function parseExternalKey(
  key: string,
): { channel: string; threadTs: string | null } | null {
  const parts = key.split('/');
  if (parts.length < 4 || parts[0] !== 'slack') return null;
  const kind = parts[1];
  const channel = parts[3];
  if (!channel) return null;
  if (kind === 'thread') {
    return { channel, threadTs: parts[4] ?? null };
  }
  return { channel, threadTs: null };
}

/**
 * Render one outbound message.
 *
 * Everything leaves through a single bot, so a message from a workspace member
 * — or from a second agent someone pulled into the thread — has to say whose
 * it is. Without that the thread reads as though the bot said all of it.
 *
 * The bound agent's own replies are posted plainly: they *are* this bot, and
 * labelling them would be noise on every message.
 */
function renderBlocks(
  message: OutboundMessage,
  boundAgent: string,
): Record<string, unknown>[] | undefined {
  const isBoundAgent =
    message.author.kind === 'agent' && message.author.name === boundAgent;
  if (isBoundAgent) return undefined;

  const label =
    message.author.kind === 'human'
      ? `${message.author.name} · from OpenAgents`
      : `${message.author.name} · agent`;

  return [
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: label }],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: message.text },
    },
  ];
}

export const slackAdapter: PlatformAdapter = {
  id: 'slack',

  identify(raw: RawWebhook) {
    const body = raw.body as SlackEventEnvelope | undefined;
    if (!body || typeof body !== 'object') return null;
    // `api_app_id` is what distinguishes our apps from each other inside one
    // Slack workspace — with an app per agent, `team_id` alone is ambiguous.
    if (!body.api_app_id || !body.team_id) return null;
    return { platformAppId: body.api_app_id, tenantId: body.team_id };
  },

  async handleWebhook(
    raw: RawWebhook,
    installation: Installation,
  ): Promise<WebhookVerdict> {
    const creds = installation.credentials as unknown as SlackCredentials;
    const body = raw.body as SlackEventEnvelope;

    // Verification is skipped only when there is nothing to verify: the worker
    // replays a stored payload with no headers, having already checked the
    // signature when it arrived.
    if (raw.rawBody.length > 0) {
      verifySignature(raw, creds.signingSecret);
    }

    if (body.type === 'url_verification') {
      return { kind: 'challenge', response: { challenge: body.challenge } };
    }
    if (body.type !== 'event_callback' || !body.event) {
      return { kind: 'ignore', reason: `envelope type ${body.type}` };
    }

    const event = body.event;

    // Our own messages come back to us. Echoing them would loop.
    if (event.bot_id || event.user === creds.botUserId) {
      return { kind: 'ignore', reason: 'message from a bot' };
    }
    // Edits, deletions, joins, topic changes — all arrive as `message` with a
    // subtype. Only a plain message is a message.
    if (event.subtype) {
      return { kind: 'ignore', reason: `subtype ${event.subtype}` };
    }
    if (event.type !== 'message' && event.type !== 'app_mention') {
      return { kind: 'ignore', reason: `event type ${event.type}` };
    }
    if (!event.channel || !event.ts) {
      return { kind: 'ignore', reason: 'event has no channel or timestamp' };
    }

    const isDirectMessage = event.channel_type === 'im';
    const text = event.text ?? '';

    // In a channel, only messages addressed to this bot are ours. Both
    // `message` and `app_mention` are delivered for the same mention, so
    // keying on the text rather than the event type keeps one copy —
    // subscribing to `app_mention` alone would instead miss the follow-ups in
    // a thread, which carry no mention at all.
    if (!isDirectMessage) {
      const inThread = Boolean(event.thread_ts);
      if (!mentionsBot(text, creds.botUserId) && !inThread) {
        return { kind: 'ignore', reason: 'channel message without a mention' };
      }
      if (event.type === 'app_mention') {
        return { kind: 'ignore', reason: 'already handled as a message event' };
      }
    }

    if (!body.event_id) {
      return { kind: 'ignore', reason: 'event has no id to deduplicate on' };
    }

    const attachments: InboundAttachment[] = (event.files ?? [])
      .filter((file) => file.id && file.url_private)
      .map((file) => ({
        externalFileId: file.id!,
        filename: file.name ?? file.id!,
        contentType: file.mimetype ?? 'application/octet-stream',
        download: () => downloadFile(file, creds.botToken),
      }));

    return {
      kind: 'message',
      message: {
        externalEventId: body.event_id,
        conversation: isDirectMessage
          ? {
              // One rolling conversation per person, per the product decision:
              // a DM is not threaded.
              kind: 'dm',
              tenantId: installation.tenantId,
              conversationId: event.channel,
              title: 'Slack DM',
            }
          : {
              // Replies go in a thread, so a mention that isn't already in one
              // starts a thread rooted at itself.
              kind: 'thread',
              tenantId: installation.tenantId,
              conversationId: event.channel,
              threadId: event.thread_ts ?? event.ts,
              title: 'Slack thread',
            },
        sender: { externalUserId: event.user ?? 'unknown' },
        text: stripMention(text, creds.botUserId),
        attachments,
      },
    };
  },

  async send(installation: Installation, message: OutboundMessage) {
    const creds = installation.credentials as unknown as SlackCredentials;
    const target = parseExternalKey(message.externalKey);
    if (!target) {
      throw Object.assign(
        new Error(`unrecognised conversation key ${message.externalKey}`),
        { permanent: true },
      );
    }

    const boundAgent = String(installation.metadata.oaAgentName ?? '');
    const blocks = renderBlocks(message, boundAgent);

    const result = await slackApi<{ ts?: string }>(creds.botToken, 'chat.postMessage', {
      channel: target.channel,
      ...(target.threadTs ? { thread_ts: target.threadTs } : {}),
      // `text` is sent even with blocks: it is what notifications and
      // accessibility tools read.
      text: message.text,
      ...(blocks ? { blocks } : {}),
    });

    return { externalMessageId: result.ts ?? '' };
  },
};

/**
 * A manifest that creates this agent's Slack app in a few clicks.
 *
 * Doing it by hand means filling in a name, a request URL and a dozen scopes
 * without mistyping any of them — which is the cost of giving each agent its
 * own app, and the reason to remove it.
 */
export function appManifest(params: {
  agentName: string;
  publicUrl: string;
}): Record<string, unknown> {
  const requestUrl = `${params.publicUrl}/webhooks/slack`;
  return {
    display_information: {
      name: params.agentName,
      description: `${params.agentName}, an OpenAgents agent`,
    },
    features: {
      bot_user: { display_name: params.agentName, always_online: true },
    },
    oauth_config: {
      scopes: {
        bot: [
          'app_mentions:read',
          'channels:history',   // thread follow-ups carry no mention
          'chat:write',
          'files:read',         // inbound attachments
          'groups:history',
          'im:history',
          'im:read',
          'users:read',         // display names for the workspace side
        ],
      },
    },
    settings: {
      event_subscriptions: {
        request_url: requestUrl,
        bot_events: ['app_mention', 'message.im', 'message.channels', 'message.groups'],
      },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  };
}
