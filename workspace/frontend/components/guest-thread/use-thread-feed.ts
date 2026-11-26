'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ONMEvent, WorkspaceMessage } from '@/lib/types';
import type { GuestMessagesPage } from '@/lib/guest-thread-api';
import {
  isDelivered,
  markSendFailed,
  mergeEvents,
  nextCursor,
  nextPollDelay,
  olderCursor,
  reconcileSent,
  sendPending,
  upsertMessage,
  type PendingSend,
} from '@/lib/guest-thread';

/** Pages fetched back-to-back in one poll when the server says there's more. */
const MAX_CATCH_UP_PAGES = 10;

export function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/** Where a shared thread's messages come from: the guest link or the owner page. */
export interface ThreadFeedSource {
  fetchMessages(after: string | null): Promise<GuestMessagesPage>;
  fetchEarlier(before: string): Promise<GuestMessagesPage>;
}

export type DeliverOutcome = { ok: true } | { ok: false; error: unknown; terminal: boolean };

/**
 * The message list of one shared thread, independent of who is looking:
 * initial page, ~3s polling (`after` cursor), earlier pages (`before`
 * cursor), and optimistic sends with idempotent retries. The caller owns
 * the info, identity, and what a failed send means.
 *
 * `source` must be stable (memoized) — a new object restarts polling.
 * `endWith(error)` returns true when the error ends the thread (link gone).
 */
export function useThreadFeed(source: ThreadFeedSource, active: boolean, endWith: (error: unknown) => boolean) {
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'error'>('idle');
  /** Bumped on every own send so the list scrolls to the bottom. */
  const [sendTick, setSendTick] = useState(0);
  const cursorRef = useRef<string | null>(null);
  /** Oldest loaded server id — the `before` cursor for earlier pages. */
  const oldestRef = useRef<string | null>(null);
  const loadingOlderRef = useRef(false);

  /** Start over from a first page (after the initial load). */
  const reset = useCallback((page: GuestMessagesPage) => {
    cursorRef.current = nextCursor(null, page.messages);
    oldestRef.current = olderCursor(null, page.messages);
    setMessages(mergeEvents([], page.messages));
    setHasOlder(page.hasMore && !!oldestRef.current);
    setOlderState('idle');
  }, []);

  const loadOlder = useCallback(async () => {
    const before = oldestRef.current;
    if (!before || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setOlderState('loading');
    try {
      const page = await source.fetchEarlier(before);
      oldestRef.current = olderCursor(before, page.messages);
      if (page.messages.length) setMessages((prev) => mergeEvents(prev, page.messages));
      setHasOlder(page.hasMore && page.messages.length > 0);
      setOlderState('idle');
    } catch (error) {
      if (!endWith(error)) setOlderState('error');
    } finally {
      loadingOlderRef.current = false;
    }
  }, [source, endWith]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = () => {
      if (cancelled) return;
      clearTimeout(timer);
      timer = setTimeout(tick, nextPollDelay(isHidden(), failures));
    };
    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        for (let i = 0; i < MAX_CATCH_UP_PAGES; i++) {
          const page = await source.fetchMessages(cursorRef.current);
          if (cancelled) return;
          cursorRef.current = nextCursor(cursorRef.current, page.messages);
          if (page.messages.length) setMessages((prev) => mergeEvents(prev, page.messages));
          if (!page.hasMore || page.messages.length === 0) break;
        }
        failures = 0;
      } catch (error) {
        if (endWith(error)) { cancelled = true; return; }
        failures += 1;
      } finally {
        inFlight = false;
      }
      schedule();
    };
    const onVisibility = () => { if (!isHidden()) { clearTimeout(timer); void tick(); } };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, source, endWith]);

  /**
   * Post a pending send with an optimistic row. On failure the caller decides
   * how to mark the row (see `markFailed`); a terminal error is already handled.
   */
  const deliver = useCallback(async (
    pending: PendingSend,
    optimistic: WorkspaceMessage,
    post: (content: string, idempotencyKey: string) => Promise<ONMEvent>,
  ): Promise<DeliverOutcome> => {
    // A retry of a send a poll already brought back adds no second copy.
    setMessages((prev) => (isDelivered(prev, pending.idempotencyKey) ? prev : upsertMessage(prev, optimistic)));
    setSendTick((n) => n + 1);
    try {
      const event = await sendPending(pending, post);
      setMessages((prev) => reconcileSent(prev, pending.localId, event));
      return { ok: true };
    } catch (error) {
      return { ok: false, error, terminal: endWith(error) };
    }
  }, [endWith]);

  const markFailed = useCallback((failed: WorkspaceMessage) => {
    setMessages((prev) => markSendFailed(prev, failed));
  }, []);

  return { messages, hasOlder, olderState, loadOlder, sendTick, reset, deliver, markFailed };
}
