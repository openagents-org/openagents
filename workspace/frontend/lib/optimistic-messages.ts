import type { WorkspaceMessage } from './types';

/** How far before the optimistic message a real one may be stamped (clock skew). */
export const OPTIMISTIC_MATCH_SKEW_MS = 5_000;
/** An optimistic message nobody confirmed or answered for this long is dropped. */
export const OPTIMISTIC_EXPIRY_MS = 3 * 60_000;

function timeMs(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The optimistic messages of one thread that the server has not confirmed
 * yet, given the real messages loaded for that thread:
 * - the optimistic user message stays until the real user message arrives;
 * - the "…" waiting bubble stays until a real agent message arrives after
 *   that user message.
 *
 * Derived from the thread's real messages on every render rather than
 * cleared by hand, so it holds across a thread switch: coming back to a
 * thread the agent has not acknowledged yet still shows the bubble, and
 * coming back to one it answered in the meantime never shows a stale one.
 *
 * Only real messages stamped no earlier than OPTIMISTIC_MATCH_SKEW_MS before
 * the send can confirm it, and an entry older than OPTIMISTIC_EXPIRY_MS is
 * dropped outright so a reply that never arrives cannot leave it stuck.
 */
export function pendingOptimisticMessages(
  optimistic: WorkspaceMessage[],
  sessionMessages: WorkspaceMessage[],
  now: number = Date.now(),
): WorkspaceMessage[] {
  return optimistic.filter((m) => {
    const sentAt = timeMs(m.createdAt);
    // A message sent earlier with the same text ("ok" twice) does not
    // confirm this one: only real messages from around or after the send count.
    const isOwnEcho = (real: WorkspaceMessage, content: unknown) => {
      if (real.senderType === 'agent' || real.content !== content) return false;
      const realAt = timeMs(real.createdAt);
      return sentAt === null || realAt === null || realAt >= sentAt - OPTIMISTIC_MATCH_SKEW_MS;
    };
    // The reply never came (or never will): let the bubble go.
    if (sentAt !== null && now - sentAt > OPTIMISTIC_EXPIRY_MS) return false;
    if (m.messageId.startsWith('optimistic-user-')) {
      return !sessionMessages.some((real) => isOwnEcho(real, m.content));
    }
    if (m.messageId.startsWith('optimistic-loading-')) {
      const userMsgIdx = sessionMessages.findIndex((real) => isOwnEcho(real, m.metadata?._userContent));
      const hasAgentAfterUser = userMsgIdx >= 0 && sessionMessages.slice(userMsgIdx + 1).some(
        (real) => real.senderType === 'agent'
      );
      return !hasAgentAfterUser;
    }
    return true;
  });
}

/** When the earliest of these optimistic messages expires, if any has a timestamp. */
export function nextOptimisticExpiry(optimistic: WorkspaceMessage[]): number | null {
  let next: number | null = null;
  for (const m of optimistic) {
    const sentAt = timeMs(m.createdAt);
    if (sentAt === null) continue;
    const at = sentAt + OPTIMISTIC_EXPIRY_MS;
    if (next === null || at < next) next = at;
  }
  return next;
}
