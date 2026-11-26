/**
 * OpenAgents Share: owner approval of guests' requests, read from the thread.
 *
 * A held guest message carries `metadata.share_request = {id, status}`. A
 * decision posts a notice (`message_type: "notice"`, `metadata.share_request_update
 * = {id, messageId, status}`), and an approval re-posts the guest's message for
 * the agent with `metadata.share_released_from = <original id>` — the share
 * pages and the workspace hide that copy and mark the original instead.
 * Kept free of React so it can be unit tested.
 */

export type ShareRequestStatus = 'pending' | 'approved' | 'declined';

interface MessageLike {
  messageId: string;
  messageType?: string | null;
  senderAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

function isStatus(value: unknown): value is ShareRequestStatus {
  return value === 'pending' || value === 'approved' || value === 'declined';
}

/** The request a held guest message opened, if any. */
export function shareRequestOf(message: Pick<MessageLike, 'metadata'>): { id: string; status: ShareRequestStatus } | null {
  const req = message.metadata?.share_request as { id?: unknown; status?: unknown } | undefined;
  if (!req || typeof req !== 'object' || typeof req.id !== 'string' || !req.id) return null;
  return { id: req.id, status: isStatus(req.status) ? req.status : 'pending' };
}

/** The copy of an approved message re-posted for the agent (hidden in the thread). */
export function isReleasedCopy(message: Pick<MessageLike, 'metadata'>): boolean {
  const from = message.metadata?.share_released_from;
  return typeof from === 'string' && !!from;
}

/** A small system line ("Raphael approved Maya's request."). */
export function isShareNotice(message: Pick<MessageLike, 'messageType' | 'senderAddress'>): boolean {
  return message.messageType === 'notice' || message.senderAddress === 'system:share';
}

/** Decisions seen in the thread so far: request id → status. */
export function requestDecisions(messages: MessageLike[]): Record<string, ShareRequestStatus> {
  const out: Record<string, ShareRequestStatus> = {};
  for (const m of messages) {
    const update = m.metadata?.share_request_update as { id?: unknown; status?: unknown } | undefined;
    if (update && typeof update.id === 'string' && isStatus(update.status)) out[update.id] = update.status;
    else if (isReleasedCopy(m)) {
      const req = shareRequestOf(m);
      if (req && !out[req.id]) out[req.id] = 'approved';
    }
  }
  return out;
}

/** Where a held message stands: a decision seen anywhere wins over its own snapshot. */
export function requestStatus(request: { id: string; status: ShareRequestStatus }, ...decided: Array<Record<string, ShareRequestStatus> | undefined>): ShareRequestStatus {
  for (const map of decided) {
    const status = map?.[request.id];
    if (status && status !== 'pending') return status;
  }
  return request.status;
}
