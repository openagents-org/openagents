/**
 * What a platform has to provide.
 *
 * Slack, Lark and Telegram disagree about almost everything at the surface —
 * how a request is signed, whether a thread exists, how a file is fetched —
 * but the shape underneath is the same: verify, decide whether the message is
 * for us, normalise it, and know how to post a reply back to where it came
 * from. Keeping that shape explicit is what stops the second and third
 * platforms turning into copies of the first with edits.
 */

export type PlatformId = 'slack' | 'lark' | 'telegram';

export interface Installation {
  id: string;
  platform: PlatformId;
  platformAppId: string;
  tenantId: string;
  /** Decrypted. Shape is the platform's business. */
  credentials: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

/** A webhook as received, before we know whether it concerns us. */
export interface RawWebhook {
  headers: Record<string, string | string[] | undefined>;
  /** Exact bytes as received — signatures are computed over these, so a
   *  re-serialised body will not verify. */
  rawBody: Buffer;
  body: unknown;
}

/**
 * What a platform makes of a webhook.
 *
 * `ignore` is the common case and matters as much as the others: a busy Slack
 * channel sends us everything said in it, and only the messages addressed to
 * this bot are ours to act on. Everything else is dropped without reaching the
 * workspace at all.
 */
export type WebhookVerdict =
  | { kind: 'ignore'; reason: string }
  /** A handshake the platform requires before it will deliver events. */
  | { kind: 'challenge'; response: unknown }
  | { kind: 'message'; message: InboundMessage };

export interface InboundMessage {
  /** The platform's own event id — the inbound idempotency key. */
  externalEventId: string;
  conversation: {
    kind: 'dm' | 'channel' | 'thread';
    tenantId: string;
    conversationId: string;
    threadId?: string | null;
    title?: string | null;
  };
  sender: { externalUserId: string; displayName?: string };
  text: string;
  attachments: InboundAttachment[];
}

export interface InboundAttachment {
  externalFileId: string;
  filename: string;
  contentType: string;
  /** Fetching is the platform's job: these files are private and need the
   *  installation's own credentials, so a plain URL is not enough. */
  download: () => Promise<Buffer>;
}

/** One message to post back, already resolved to a destination. */
export interface OutboundMessage {
  /** The conversation key the backend handed back with the event. */
  externalKey: string;
  /** Who said it. Everything leaves through one bot, so a message from a human
   *  or a second agent has to say so in its own body. */
  author: { kind: 'agent' | 'human' | 'system'; name: string };
  text: string;
}

export interface PlatformAdapter {
  readonly id: PlatformId;

  /**
   * Verify and classify a webhook.
   *
   * Verification belongs here rather than in shared code because each platform
   * signs differently — Slack over the raw body with a timestamp, Lark with an
   * encrypted envelope, Telegram with a header token we chose ourselves.
   */
  handleWebhook(
    raw: RawWebhook,
    installation: Installation,
  ): Promise<WebhookVerdict>;

  /**
   * Find which installation a webhook belongs to, before we have one.
   *
   * Returns the (platformAppId, tenantId) pair to look up. Called with an
   * unverified body, so it must only read routing identifiers and never trust
   * anything else in there.
   */
  identify(raw: RawWebhook): { platformAppId: string; tenantId: string } | null;

  /** Post a message. Returns the platform's id for it, for the outbox record. */
  send(
    installation: Installation,
    message: OutboundMessage,
  ): Promise<{ externalMessageId: string }>;
}

const registry = new Map<PlatformId, PlatformAdapter>();

export function registerPlatform(adapter: PlatformAdapter): void {
  registry.set(adapter.id, adapter);
}

export function getPlatform(id: string): PlatformAdapter | null {
  return registry.get(id as PlatformId) ?? null;
}

export function registeredPlatforms(): PlatformId[] {
  return [...registry.keys()];
}
