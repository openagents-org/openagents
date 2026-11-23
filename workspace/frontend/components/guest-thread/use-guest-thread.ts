'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GuestThreadError,
  clearGuestSession,
  fetchEarlierGuestMessages,
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
import { optimisticMessage, type PendingSend } from '@/lib/guest-thread';
import { isHidden, useThreadFeed, type ThreadFeedSource } from './use-thread-feed';

export type GuestThreadStatus = 'loading' | 'ready' | 'not_found' | 'expired' | 'error';
export type SendResult = 'sent' | 'needs-name';

export const INFO_REFRESH_MS = 30000;

/**
 * State for one shared thread seen by a guest: the link info, the merged
 * message list (initial page + ~3s polling), the guest identity, and sends
 * with optimistic rows and idempotent retries. Only talks to the public
 * `/v1/guest-links/public/{token}` API.
 */
export function useGuestThread(token: string) {
  const [status, setStatus] = useState<GuestThreadStatus>('loading');
  const [info, setInfo] = useState<GuestThreadInfo | null>(null);
  const [guest, setGuest] = useState<GuestIdentity | null>(null);
  const [nameRequest, setNameRequest] = useState<{ reason: 'first-post' | 'session-expired' } | null>(null);

  const sessionRef = useRef<string | null>(null);
  const guestRef = useRef<GuestIdentity | null>(null);
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

  const source = useMemo<ThreadFeedSource>(() => ({
    fetchMessages: (after) => fetchGuestMessages(token, after),
    fetchEarlier: (before) => fetchEarlierGuestMessages(token, before),
  }), [token]);
  const feed = useThreadFeed(source, status === 'ready', endWith);
  const { reset, deliver: deliverFeed, markFailed } = feed;

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
      const page = await source.fetchMessages(null);
      setIdentity(session ? linkInfo.guest : null, session);
      setInfo(linkInfo);
      reset(page);
      setStatus('ready');
    } catch (error) {
      if (!endWith(error)) setStatus('error');
    }
  }, [token, source, endWith, setIdentity, reset]);

  useEffect(() => { void load(); }, [load]);

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
    const outcome = await deliverFeed(pending, optimisticMessage(pending, currentGuest), (content, key) => postGuestMessage(token, session, content, key));
    if (outcome.ok || outcome.terminal) return;
    const { error } = outcome;
    if (error instanceof GuestThreadError && error.kind === 'unauthorized') {
      // Keep the row (failed, retryable) so cancelling the name prompt
      // doesn't lose the text; re-joining resends it with the same key.
      clearGuestSession(token);
      setIdentity(null, null);
      failedRef.current.set(pending.localId, pending);
      markFailed(optimisticMessage(pending, currentGuest, 'failed', 'session'));
      queuedRef.current = pending;
      setNameRequest({ reason: 'session-expired' });
      return;
    }
    failedRef.current.set(pending.localId, pending);
    const kind = error instanceof GuestThreadError ? error.kind : null;
    const reason = kind === 'rate_limited' || kind === 'forbidden' ? kind : 'failed';
    markFailed(optimisticMessage(pending, currentGuest, 'failed', reason));
  }, [token, setIdentity, deliverFeed, markFailed]);

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

  return {
    status, info, messages: feed.messages, hasOlder: feed.hasOlder, olderState: feed.olderState, loadOlder: feed.loadOlder,
    guest, nameRequest, sendTick: feed.sendTick, reload: load, send, retry, join, cancelName, endWith,
  };
}
