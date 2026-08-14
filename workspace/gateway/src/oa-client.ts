/**
 * Client for the OA backend's integration surface.
 *
 * Every call here carries a binding credential, never a workspace token. The
 * backend resolves that credential to one binding and derives the workspace,
 * the agent and the reachable conversations from it — so the blast radius of a
 * compromised gateway is one exported agent, not one customer's whole
 * workspace.
 *
 * Two endpoints are the exception and use the shared service key: activation,
 * where no binding credential exists yet, and the disconnect acknowledgement,
 * where it has already been revoked.
 */

import { request } from 'undici';

import { config } from './config.js';

export interface ConversationRef {
  kind: 'dm' | 'channel' | 'thread';
  tenant_id: string;
  conversation_id: string;
  thread_id?: string | null;
  title?: string | null;
}

export interface OutboundEvent {
  id: string;
  timestamp: number;
  channel_name: string;
  external_key: string | null;
  conversation_kind: string | null;
  author: { kind: 'agent' | 'human' | 'system'; name: string };
  content: string;
  attachments: Array<{ file_id: string; filename: string; content_type: string; size: number }>;
}

export class OaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Whether trying again could plausibly succeed. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'OaError';
  }
}

async function call<T>(
  method: string,
  path: string,
  {
    body,
    headers = {},
  }: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const res = await request(`${config.oaEndpoint}${path}`, {
    method: method as 'GET' | 'POST' | 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.body.text();
  let parsed: { code?: number; message?: string; data?: T } = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    // Fall through — a non-JSON body means an error page, handled below.
  }

  if (res.statusCode >= 400 || (parsed.code !== undefined && parsed.code !== 0)) {
    const message = parsed.message || text.slice(0, 200) || `HTTP ${res.statusCode}`;
    // 5xx and 429 are worth another attempt; a 4xx means the request itself is
    // wrong and repeating it just burns the retry budget.
    const retryable = res.statusCode >= 500 || res.statusCode === 429;
    throw new OaError(message, res.statusCode, retryable);
  }

  return parsed.data as T;
}

function bindingHeaders(integrationKey: string): Record<string, string> {
  return { 'X-Integration-Key': integrationKey };
}

function serviceHeaders(): Record<string, string> {
  return { 'X-Service-Key': config.oaServiceKey };
}

// ---------------------------------------------------------------------------
// Handshake — service key
// ---------------------------------------------------------------------------

/**
 * Complete a connection: hand the backend our credential's fingerprint and the
 * ticket proving an authorised operator started this.
 *
 * Idempotent by design, so a lost response is a plain retry.
 */
export async function activateBinding(params: {
  bindingId: string;
  ticket: string;
  keyHash: string;
  installation: Record<string, unknown>;
}): Promise<{ binding_id: string; status: string; reused: boolean }> {
  return call('POST', '/v1/integration-bindings/activate', {
    headers: serviceHeaders(),
    body: {
      binding_id: params.bindingId,
      ticket: params.ticket,
      key_hash: params.keyHash,
      installation: params.installation,
    },
  });
}

/** Confirm the platform credentials are gone, completing a disconnect. */
export async function acknowledgeCleanup(bindingId: string): Promise<void> {
  await call('POST', `/v1/integration-bindings/${bindingId}/cleanup-ack`, {
    headers: serviceHeaders(),
  });
}

// ---------------------------------------------------------------------------
// Traffic — binding credential
// ---------------------------------------------------------------------------

/** Store one attachment. Returns its id; posts no message. */
export async function uploadFile(
  integrationKey: string,
  params: {
    filename: string;
    contentType: string;
    data: Buffer;
    platformEventId: string;
    platformFileId: string;
  },
): Promise<{ file_id: string; reused: boolean }> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(params.data)], { type: params.contentType }),
    params.filename,
  );
  form.append('platform_event_id', params.platformEventId);
  form.append('platform_file_id', params.platformFileId);

  // Global fetch rather than undici's `request`: multipart wants the standard
  // FormData, and undici ships its own incompatible declaration of it.
  const res = await fetch(`${config.oaEndpoint}/v1/integrations/files`, {
    method: 'POST',
    headers: bindingHeaders(integrationKey),
    body: form,
  });
  const parsed = (await res.json().catch(() => ({}))) as {
    code?: number;
    message?: string;
    data?: { file_id: string; reused: boolean };
  };
  if (!res.ok || (parsed.code !== undefined && parsed.code !== 0)) {
    throw new OaError(
      parsed.message || `HTTP ${res.status}`,
      res.status,
      res.status >= 500 || res.status === 429,
    );
  }
  return parsed.data as { file_id: string; reused: boolean };
}

/**
 * Land one platform message as one OA message.
 *
 * `idempotencyKey` is the platform's own event id, so a webhook the platform
 * decided to redeliver collapses onto the message it already created.
 */
export async function ingest(
  integrationKey: string,
  params: {
    conversation: ConversationRef;
    sender: { external_user_id: string; display_name?: string };
    content: string;
    fileIds?: string[];
    idempotencyKey: string;
  },
): Promise<{ event_id: string; channel_name: string; duplicate: boolean }> {
  return call('POST', '/v1/integrations/ingest', {
    headers: bindingHeaders(integrationKey),
    body: {
      conversation: params.conversation,
      sender: params.sender,
      content: params.content,
      file_ids: params.fileIds ?? [],
      idempotency_key: params.idempotencyKey,
    },
  });
}

/**
 * Drain messages waiting to go out.
 *
 * The returned `next_cursor` is the one to persist — not the id of the last
 * event in the list. Most of the traffic in these channels is filtered out
 * before we see it, so a cursor parked on the last delivered message would
 * rescan the same discarded rows on every wake-up.
 */
export async function fetchOutbound(
  integrationKey: string,
  params: { after?: string | null; limit?: number } = {},
): Promise<{ events: OutboundEvent[]; has_more: boolean; next_cursor: string | null }> {
  const search = new URLSearchParams();
  if (params.after) search.set('after', params.after);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return call('GET', `/v1/integrations/events${qs ? `?${qs}` : ''}`, {
    headers: bindingHeaders(integrationKey),
  });
}

export function streamUrl(): string {
  return `${config.oaEndpoint}/v1/integrations/events/stream`;
}

export { bindingHeaders };
