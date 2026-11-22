'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceMessage } from '@/lib/types';
import {
  GuestThreadError,
  clearGuestSession,
  fetchGuestMessages,
  fetchThreadLink,
  isTerminalLinkError,
  joinAsGuest,
  loadGuestSession,
  postGuestMessage,
  saveGuestSession,
  type GuestIdentity,
  type GuestThreadInfo,
} from '@/lib/guest-thread-api';
import {
  mergeEvents,
  nextCursor,
  nextPollDelay,
  optimisticMessage,
  reconcileSent,
  sendPending,
  upsertMessage,
  type PendingSend,
} from '@/lib/guest-thread';

export type GuestThreadStatus = 'loading' | 'ready' | 'not_found' | 'expired' | 'error';
export type SendResult = 'sent' | 'needs-name';

const INFO_REFRESH_MS = 30000;
/** Pages fetched back-to-back in one poll when the server says there's more. */
const MAX_CATCH_UP_PAGES = 10;

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

/**
 * State for one shared thread seen by a guest: the link info, the merged
 * message list (initial page + ~3s polling), the guest identity, and sends
 * with optimistic rows and idempotent retries. Only talks to the public
 * `/v1/thread-links/public/{token}` API.
 */
export function useGuestThread(token: string) {
  const [status, setStatus] = useState<GuestThreadStatus>('loading');
  const [info, setInfo] = useState<GuestThreadInfo | null>(null);
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [guest, setGuest] = useState<GuestIdentity | null>(null);
  const [nameRequest, setNameRequest] = useState<{ reason: 'first-post' | 'session-expired' } | null>(null);
  /** Bumped on every own send so the list scrolls to the bottom. */
  const [sendTick, setSendTick] = useState(0);

  const sessionRef = useRef<string | null>(null);
  const guestRef = useRef<GuestIdentity | null>(null);
  const cursorRef = useRef<string | null>(null);
  const queuedRef = useRef<PendingSend | null>(null);
  const failedRef = useRef(new Map<string, PendingSend>());

  const setIdentity = useCallback((nextGuest: GuestIdentity | null, session: string | null) => {
    guestRef.current = nextGuest;
    sessionRef.current = session;
    setGuest(nextGuest);
  }, []);

  const endWith = useCallback((error: unknown): boolean => {
    if (!isTerminalLinkError(error)) return false;
    setStatus(error.kind === 'expired' ? 'expired' : 'not_found');
    return true;
  }, []);

  // ── Initial load ──
  const load = useCallback(async () => {
    setStatus('loading');
    try {
      let session = loadGuestSession(token);
      let linkInfo: GuestThreadInfo;
      try {
        linkInfo = await fetchThreadLink(token, session);
      } catch (error) {
        // A stale session must not lock the guest out of reading.
        if (!(session && error instanceof GuestThreadError && error.kind === 'unauthorized')) throw error;
        clearGuestSession(token);
        session = null;
        linkInfo = await fetchThreadLink(token, null);
      }
      if (session && !linkInfo.guest) {
        clearGuestSession(token);
        session = null;
      }
      const page = await fetchGuestMessages(token, null);
      cursorRef.current = nextCursor(null, page.messages);
      setIdentity(session ? linkInfo.guest : null, session);
      setInfo(linkInfo);
      setMessages(mergeEvents([], page.messages));
      setHasOlder(page.hasMore);
      setStatus('ready');
    } catch (error) {
      if (!endWith(error)) setStatus('error');
    }
  }, [token, endWith, setIdentity]);

  useEffect(() => { void load(); }, [load]);

  // ── Polling ──
  useEffect(() => {
    if (status !== 'ready') return;
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
          const page = await fetchGuestMessages(token, cursorRef.current);
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
  }, [status, token, endWith]);

  // Agent presence / canPost / revocation change slowly — refresh rarely.
  useEffect(() => {
    if (status !== 'ready') return;
    const timer = setInterval(async () => {
      if (isHidden()) return;
      try {
        const next = await fetchThreadLink(token, sessionRef.current);
        setInfo(next);
      } catch (error) {
        endWith(error);
      }
    }, INFO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [status, token, endWith]);

  // ── Sending ──
  const deliver = useCallback(async (pending: PendingSend) => {
    const currentGuest = guestRef.current;
    const session = sessionRef.current;
    if (!currentGuest || !session) {
      queuedRef.current = pending;
      setNameRequest({ reason: 'first-post' });
      return;
    }
    failedRef.current.delete(pending.localId);
    setMessages((prev) => upsertMessage(prev, optimisticMessage(pending, currentGuest)));
    setSendTick((n) => n + 1);
    try {
      const event = await sendPending(pending, (content, key) => postGuestMessage(token, session, content, key));
      setMessages((prev) => reconcileSent(prev, pending.localId, event));
    } catch (error) {
      if (endWith(error)) return;
      if (error instanceof GuestThreadError && error.kind === 'unauthorized') {
        // Keep the row (failed, retryable) so cancelling the name prompt
        // doesn't lose the text; re-joining resends it with the same key.
        clearGuestSession(token);
        setIdentity(null, null);
        failedRef.current.set(pending.localId, pending);
        setMessages((prev) => upsertMessage(prev, optimisticMessage(pending, currentGuest, 'failed', 'session')));
        queuedRef.current = pending;
        setNameRequest({ reason: 'session-expired' });
        return;
      }
      failedRef.current.set(pending.localId, pending);
      const kind = error instanceof GuestThreadError ? error.kind : null;
      const reason = kind === 'rate_limited' || kind === 'forbidden' ? kind : 'failed';
      setMessages((prev) => upsertMessage(prev, optimisticMessage(pending, currentGuest, 'failed', reason)));
    }
  }, [token, endWith, setIdentity]);

  /** Queue a send; asks for a name first when the guest hasn't picked one. */
  const send = useCallback((pending: PendingSend): SendResult => {
    if (!guestRef.current || !sessionRef.current) {
      queuedRef.current = pending;
      setNameRequest({ reason: 'first-post' });
      return 'needs-name';
    }
    void deliver(pending);
    return 'sent';
  }, [deliver]);

  /** Resend a failed message with its original idempotency key. */
  const retry = useCallback((localId: string) => {
    const pending = failedRef.current.get(localId);
    if (pending) void deliver(pending);
  }, [deliver]);

  /** Pick a display name; then deliver whatever was waiting on it. */
  const join = useCallback(async (name: string) => {
    const result = await joinAsGuest(token, name);
    saveGuestSession(token, result.session);
    setIdentity(result.guest, result.session);
    setInfo((prev) => (prev ? { ...prev, guest: result.guest } : prev));
    setNameRequest(null);
    const queued = queuedRef.current;
    queuedRef.current = null;
    if (queued) await deliver(queued);
    return queued;
  }, [token, deliver, setIdentity]);

  const cancelName = useCallback(() => {
    queuedRef.current = null;
    setNameRequest(null);
  }, []);

  return { status, info, messages, hasOlder, guest, nameRequest, sendTick, reload: load, send, retry, join, cancelName, endWith };
}
