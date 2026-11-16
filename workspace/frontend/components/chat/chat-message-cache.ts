import { workspaceApi } from '@/lib/api';
import { eventToMessage } from '@/lib/types';
import type { WorkspaceMessage } from '@/lib/types';

// Module-level message cache — survives component re-renders/unmounts.
// Keyed by sessionId, stores the last known messages for instant thread switching.
export const messageCache = new Map<string, WorkspaceMessage[]>();
const CACHE_MAX_SESSIONS = 10;
// Track last seen message ID per cached session for incremental refresh
const cacheLastSeenId = new Map<string, string>();
// Module-level per-thread input drafts. Switching the sidebar to Files, Shared
// Browser etc. unmounts ChatView, so drafts held in component state or a ref
// were lost on the way back.
export const draftStore: Record<string, string> = {};
// Module-level optimistic messages (the sent message + "…" waiting bubble) per
// thread, keyed `${workspaceId}:${sessionId}` — DM ids like `dm:a,b` repeat
// across workspaces. ChatView unmounts on mobile (thread list pane) and on a
// detour through Files/Browser, so component state alone lost the bubble.
// Each thread holds at most one send (2 entries); empty threads are deleted.
const optimisticStore = new Map<string, WorkspaceMessage[]>();

export function readOptimistic(workspaceKey: string): WorkspaceMessage[] {
  const prefix = `${workspaceKey}:`;
  const all: WorkspaceMessage[] = [];
  optimisticStore.forEach((msgs, key) => {
    if (key.startsWith(prefix)) all.push(...msgs);
  });
  return all;
}

export function writeOptimistic(workspaceKey: string, msgs: WorkspaceMessage[]) {
  const prefix = `${workspaceKey}:`;
  Array.from(optimisticStore.keys()).forEach((key) => {
    if (key.startsWith(prefix)) optimisticStore.delete(key);
  });
  for (const m of msgs) {
    const key = `${prefix}${m.sessionId}`;
    optimisticStore.set(key, [...(optimisticStore.get(key) ?? []), m]);
  }
}

/** Test hook: forget every stored optimistic message. */
export function resetOptimisticStoreForTests() {
  optimisticStore.clear();
}

function parseDMSession(sessionId: string | null): [string, string] | null {
  if (!sessionId?.startsWith('dm:')) return null;
  const parts = sessionId.slice(3).split(',', 2);
  if (parts.length === 2) return [parts[0], parts[1]];
  return null;
}

export function normalizeAgentAddress(address: string): string {
  return address.replace(/^openagents:/, '');
}

export function messagesForSession(sessionId: string, msgs: WorkspaceMessage[]): WorkspaceMessage[] {
  const dmPair = parseDMSession(sessionId);
  return msgs.flatMap((msg) => {
    const belongsToSession = dmPair
      ? msg.sessionId === sessionId ||
        dmPair.includes(msg.sessionId) ||
        dmPair.map(normalizeAgentAddress).includes(normalizeAgentAddress(msg.sessionId))
      : msg.sessionId === sessionId;
    if (!belongsToSession) return [];
    return dmPair ? [{ ...msg, sessionId }] : [msg];
  });
}

export function cacheMessages(sessionId: string, msgs: WorkspaceMessage[]) {
  const scopedMessages = messagesForSession(sessionId, msgs);
  messageCache.set(sessionId, scopedMessages);
  if (scopedMessages.length > 0) {
    cacheLastSeenId.set(sessionId, scopedMessages[scopedMessages.length - 1].messageId);
  } else {
    cacheLastSeenId.delete(sessionId);
  }
  // Evict oldest entries if cache grows too large
  if (messageCache.size > CACHE_MAX_SESSIONS) {
    const oldest = messageCache.keys().next().value;
    if (oldest) {
      messageCache.delete(oldest);
      cacheLastSeenId.delete(oldest);
    }
  }
}

/** Fetch recent messages for a session (cache prefetch). */
export async function fetchSessionMessages(sessionId: string): Promise<WorkspaceMessage[]> {
  try {
    const result = await workspaceApi.loadMessageHistory(sessionId, { limit: 50 });
    // Events come newest-first from sort=desc, reverse for chronological display
    return messagesForSession(sessionId, result.events.map(eventToMessage)).reverse();
  } catch {
    return [];
  }
}

/** Incrementally refresh a cached session — fetch only new messages since last seen. */
export async function refreshCachedSession(sessionId: string): Promise<void> {
  const lastId = cacheLastSeenId.get(sessionId);
  if (!lastId) {
    // No cache yet — do full fetch
    const msgs = await fetchSessionMessages(sessionId);
    cacheMessages(sessionId, msgs);
    return;
  }
  try {
    const result = await workspaceApi.pollMessages(sessionId, lastId);
    const scopedMessages = messagesForSession(sessionId, result.messages);
    if (scopedMessages.length > 0) {
      const existing = messageCache.get(sessionId) || [];
      const existingIds = new Set(existing.map((m) => m.messageId));
      const unique = scopedMessages.filter((m) => !existingIds.has(m.messageId));
      if (unique.length > 0) {
        cacheMessages(sessionId, [...existing, ...unique]);
      }
    }
  } catch {
    // Best-effort
  }
}
