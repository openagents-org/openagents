'use client';

import { useEffect, useMemo, useState } from 'react';
import { PENDING_QUEUE_MS, type PendingQueueEntry } from './use-queued-messages';

export type SessionPendingEntry = PendingQueueEntry & { sessionId: string };

/**
 * Messages sent while an agent here is busy count as queued until its queue
 * report arrives, so they never flash into the chat log first. Each guess
 * expires after PENDING_QUEUE_MS.
 */
export function usePendingQueue(currentSessionId: string | null) {
  const [pendingQueue, setPendingQueue] = useState<SessionPendingEntry[]>([]);
  const sessionPendingQueue = useMemo(
    () => pendingQueue.filter((p) => p.sessionId === currentSessionId),
    [pendingQueue, currentSessionId],
  );
  useEffect(() => {
    if (!pendingQueue.length) return;
    const next = Math.min(...pendingQueue.map((p) => p.sentAt + PENDING_QUEUE_MS));
    const timer = setTimeout(() => setPendingQueue((prev) => prev.filter((p) => p.sentAt + PENDING_QUEUE_MS > Date.now())), Math.max(0, next - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [pendingQueue]);
  return { sessionPendingQueue, setPendingQueue };
}
