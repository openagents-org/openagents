import { dmCounterpart, dmSessionId, isMyAddress } from './dm';
import type { DMConversation } from './types';
import type { UnreadSignals } from './signals';
import { unreadCutoffMs } from './unread-window';

/** Counts are keyed by the same canonical DM IDs used by sidebar navigation. */
export function dmUnreadCounts(conversations: DMConversation[], me: string, open: string | null, readAt: Record<string, number>, signals: UnreadSignals): Record<string, number> {
  const counts: Record<string, number> = {};
  const cutoff = unreadCutoffMs();
  for (const conversation of conversations) {
    const counterpart = dmCounterpart(conversation.agents, me);
    if (!counterpart) continue;
    const id = dmSessionId(...conversation.agents);
    const canonical = dmSessionId(me, counterpart);
    if (id === open || canonical === open) continue;
    const marker = Math.max(readAt[id] ?? 0, readAt[canonical] ?? 0);
    // A request started before the user read the DM must not restore its badge.
    if (conversation.lastMessage.timestamp <= marker || conversation.lastMessage.timestamp < cutoff) continue;
    let count: number;
    if (conversation.unreadCount != null && conversation.readAt === marker) {
      count = conversation.unreadCount;
    } else {
      count = signals[id]?.dms || (marker > 0 && !isMyAddress(conversation.lastMessage.sender, me) ? 1 : 0);
    }
    if (count > 0) counts[canonical] = (counts[canonical] ?? 0) + count;
  }
  return counts;
}
