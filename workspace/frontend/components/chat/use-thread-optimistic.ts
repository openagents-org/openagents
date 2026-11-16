'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceMessage } from '@/lib/types';
import { nextOptimisticExpiry, pendingMessagesForDisplay, pendingOptimisticMessages } from '@/lib/optimistic-messages';
import { messagesForSession, readOptimistic, writeOptimistic } from './chat-message-cache';

export type SetOptimisticMessages = (update: (prev: WorkspaceMessage[]) => WorkspaceMessage[]) => void;

/**
 * Optimistic message state for instant feedback. Holds the pending messages
 * of every thread (each carries its sessionId), not just the open one —
 * wiping it on a thread switch dropped the "…" waiting bubble, so a thread
 * the agent had not acknowledged yet looked idle on the way back.
 * Seeded from and written through to the module store so it survives an unmount.
 */
export function useThreadOptimistic(workspaceKey: string, currentSessionId: string | null, sessionMessages: WorkspaceMessage[]) {
  const workspaceKeyRef = useRef(workspaceKey);
  workspaceKeyRef.current = workspaceKey;
  const [optimisticMessages, setOptimisticState] = useState<WorkspaceMessage[]>(() => readOptimistic(workspaceKey));
  // The store is the source of truth, so updates still land after an unmount
  // (e.g. a failed send whose request settles once the user has left).
  const setOptimisticMessages = useCallback<SetOptimisticMessages>((update) => {
    const key = workspaceKeyRef.current;
    const prev = readOptimistic(key);
    const next = update(prev);
    if (next === prev) return;
    writeOptimistic(key, next);
    setOptimisticState(next);
  }, []);
  useEffect(() => {
    setOptimisticState(readOptimistic(workspaceKey));
  }, [workspaceKey]);
  // The thread whose optimistic messages may be shown. Trails currentSessionId
  // by one render (set by the caller's switch effect), in step with the polling
  // hook swapping in that thread's messages. On the render in between the
  // list is empty and must stay empty: that is what remounts ChatMessages and
  // lands the thread at the bottom. A lone bubble would keep it mounted, and
  // the real messages arriving above it would read as older history being
  // prepended — which never scrolls.
  // Starts at null so a remount takes the same one-render delay as a switch.
  const [optimisticSessionId, setOptimisticSessionId] = useState<string | null>(null);

  // Optimistic messages the server has not confirmed yet, for the current session only:
  // 1. the optimistic user msg, until the real user message arrives from the server
  // 2. the optimistic loading msg, until any real agent message arrives after the user msg
  const optimisticShown = !!currentSessionId && optimisticSessionId === currentSessionId;
  // Bumped when a shown optimistic entry expires (see the timer below).
  const [expiryTick, setExpiryTick] = useState(0);
  const sessionOptimisticMessages = useMemo(
    () => optimisticShown && currentSessionId
      ? pendingOptimisticMessages(messagesForSession(currentSessionId, optimisticMessages), sessionMessages)
      : [],
    [optimisticShown, currentSessionId, optimisticMessages, sessionMessages, expiryTick] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Drop the confirmed ones from state so they cannot reappear later
  useEffect(() => {
    if (!optimisticShown) return;
    const pendingIds = new Set(sessionOptimisticMessages.map((m) => m.messageId));
    setOptimisticMessages((prev) => {
      const next = prev.filter((m) => m.sessionId !== currentSessionId || pendingIds.has(m.messageId));
      return next.length === prev.length ? prev : next;
    });
  }, [optimisticShown, currentSessionId, sessionOptimisticMessages, setOptimisticMessages]);

  // Re-check when the oldest shown entry expires, so a bubble whose reply
  // never arrives goes away even if nothing else re-renders the thread.
  useEffect(() => {
    const at = nextOptimisticExpiry(sessionOptimisticMessages);
    if (at === null) return;
    const timer = setTimeout(() => setExpiryTick((t) => t + 1), Math.max(0, at - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [sessionOptimisticMessages]);

  // Merge real messages with optimistic messages for display
  const displayMessages = useMemo(
    () => [...sessionMessages, ...pendingMessagesForDisplay(sessionMessages, sessionOptimisticMessages)],
    [sessionMessages, sessionOptimisticMessages]
  );

  return { displayMessages, setOptimisticMessages, setOptimisticSessionId };
}
