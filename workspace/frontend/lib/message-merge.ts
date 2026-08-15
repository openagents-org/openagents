import type { WorkspaceMessage } from '@/lib/types';

/** Chronological comparator — createdAt first, messageId as tiebreaker. */
export function compareMessages(a: WorkspaceMessage, b: WorkspaceMessage): number {
  const ta = a.createdAt ?? '';
  const tb = b.createdAt ?? '';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.messageId < b.messageId ? -1 : a.messageId > b.messageId ? 1 : 0;
}

/**
 * Merge incoming messages into the list, deduped by id and kept in
 * chronological order. A plain append is not enough: history hydration, the
 * catch-up poll and the SSE stream all run concurrently, so an older batch
 * can arrive after a newer SSE-delivered reply — appended naively it would
 * become the trailing message and make the UI report the agent as still
 * working (the "is the agent busy" heuristics look at the last message).
 */
export function mergeMessages(prev: WorkspaceMessage[], incoming: WorkspaceMessage[]): WorkspaceMessage[] {
  const existingIds = new Set(prev.map((m) => m.messageId));
  const unique = incoming.filter((m) => !existingIds.has(m.messageId));
  if (unique.length === 0) return prev;
  return [...prev, ...unique].sort(compareMessages);
}
