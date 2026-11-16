'use client';

import { useEffect, useRef } from 'react';
import type { WorkspaceSession } from '@/lib/types';
import { sessionActivityTime } from '@/lib/conversation-list';
import { cacheMessages, fetchSessionMessages, messageCache, refreshCachedSession } from './chat-message-cache';

const PREFETCH_COUNT = 6;
const CACHE_REFRESH_INTERVAL = 5_000; // refresh caches every 5s

/**
 * Continuously refresh message caches for top recent sessions in the background.
 * This ensures clicking any recent thread shows messages instantly and up-to-date.
 */
export function useSessionPrefetch(sessions: WorkspaceSession[], currentSessionId: string | null) {
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  useEffect(() => {
    if (sessions.length === 0) return;

    const getTopSessions = () =>
      [...sessions]
        .filter((s) => s.status === 'active')
        .sort((a, b) => sessionActivityTime(b) - sessionActivityTime(a))
        .slice(0, PREFETCH_COUNT);

    // Initial fetch — staggered
    const initial = getTopSessions();
    initial.forEach((s, i) => {
      if (!messageCache.has(s.sessionId)) {
        setTimeout(() => fetchSessionMessages(s.sessionId).then((msgs) => {
          if (msgs.length > 0) cacheMessages(s.sessionId, msgs);
        }), i * 300);
      }
    });

    // Periodic incremental refresh — skip the session the user is currently viewing
    // (useMessagePolling handles that one)
    const interval = setInterval(async () => {
      const top = getTopSessions();
      for (const s of top) {
        if (s.sessionId === currentSessionIdRef.current) continue;
        await refreshCachedSession(s.sessionId);
      }
    }, CACHE_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [sessions]);

  return currentSessionIdRef;
}
