'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GuestThreadError } from '@/lib/guest-thread-api';
import { nextPollDelay, optimisticOwnerMessage, type PendingSend } from '@/lib/guest-thread';
import type { ShareRequestStatus } from '@/lib/share-requests';
import {
  decideRoomRequest,
  fetchEarlierRoomMessages,
  fetchRoomRequests,
  fetchRoom,
  fetchRoomMessages,
  movedToOf,
  postRoomMessage,
  type MovedTo,
  type RoomCredentials,
  type ShareRequest,
  type ShareRoom,
} from '@/lib/share-room-api';
import type { DecideOutcome } from './share-request-status';
import { isHidden, useThreadFeed, type ThreadFeedSource } from './use-thread-feed';
import { INFO_REFRESH_MS, type SendResult } from './use-guest-thread';

export type OwnerRoomStatus = 'loading' | 'ready' | 'not_found' | 'moved' | 'error';

/**
 * The owner's light room (`/share/own/<slug>?token=…`): the same single
 * thread a guest sees, read and posted to with the owner link's workspace
 * token. No name prompt — the owner posts as themselves.
 */
export function useOwnerRoom(slug: string, token: string) {
  const [status, setStatus] = useState<OwnerRoomStatus>(token ? 'loading' : 'not_found');
  const [room, setRoom] = useState<ShareRoom | null>(null);
  const [movedTo, setMovedTo] = useState<MovedTo | null>(null);
  const failedRef = useRef(new Map<string, PendingSend>());
  const ownerNameRef = useRef('');

  const creds = useMemo<RoomCredentials>(() => ({ slug, token }), [slug, token]);

  const endWith = useCallback((error: unknown): boolean => {
    if (!(error instanceof GuestThreadError)) return false;
    if (error.status === 404 || error.status === 401) { setStatus('not_found'); return true; }
    if (error.status === 410) { setMovedTo(movedToOf(error.data)); setStatus('moved'); return true; }
    return false;
  }, []);

  const source = useMemo<ThreadFeedSource>(() => ({
    fetchMessages: (after) => fetchRoomMessages(creds, after),
    fetchEarlier: (before) => fetchEarlierRoomMessages(creds, before),
  }), [creds]);
  const feed = useThreadFeed(source, status === 'ready', endWith);
  const { reset, deliver: deliverFeed, markFailed } = feed;

  const load = useCallback(async () => {
    if (!creds.token) { setStatus('not_found'); return; }
    setStatus('loading');
    try {
      const next = await fetchRoom(creds);
      const moved = movedToOf(next.share);
      if (moved) { setMovedTo(moved); setStatus('moved'); return; }
      const page = await source.fetchMessages(null);
      ownerNameRef.current = next.owner?.name || '';
      setRoom(next);
      reset(page);
      setStatus('ready');
    } catch (error) {
      if (!endWith(error)) setStatus('error');
    }
  }, [creds, source, reset, endWith]);

  useEffect(() => { void load(); }, [load]);

  /** Re-read the room now (agents, link, kept state); also every 30s. */
  const refresh = useCallback(async () => {
    try {
      const next = await fetchRoom(creds);
      ownerNameRef.current = next.owner?.name || '';
      setRoom(next);
    } catch (error) {
      endWith(error);
    }
  }, [creds, endWith]);

  useEffect(() => {
    if (status !== 'ready') return;
    const timer = setInterval(() => { if (!isHidden()) void refresh(); }, INFO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [status, refresh]);

  const deliver = useCallback(async (pending: PendingSend) => {
    failedRef.current.delete(pending.localId);
    const name = ownerNameRef.current;
    const outcome = await deliverFeed(pending, optimisticOwnerMessage(pending, name), (content, key) => postRoomMessage(creds, content, key));
    if (outcome.ok || outcome.terminal) return;
    failedRef.current.set(pending.localId, pending);
    const kind = outcome.error instanceof GuestThreadError ? outcome.error.kind : null;
    const reason = kind === 'rate_limited' || kind === 'forbidden' ? kind : 'failed';
    markFailed(optimisticOwnerMessage(pending, name, 'failed', reason));
  }, [creds, deliverFeed, markFailed]);

  // Guests' requests waiting for the owner, polled alongside the messages.
  const [requests, setRequests] = useState<ShareRequest[]>([]);
  /** Decisions made here, shown before the thread's notice arrives. */
  const [decisions, setDecisions] = useState<Record<string, ShareRequestStatus>>({});

  const loadRequests = useCallback(async () => {
    const list = await fetchRoomRequests(creds);
    setRequests(list.filter((r) => r.status === 'pending'));
  }, [creds]);

  useEffect(() => {
    if (status !== 'ready') return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        await loadRequests();
        failures = 0;
      } catch (error) {
        if (endWith(error)) { cancelled = true; return; }
        failures += 1;
      }
      if (!cancelled) timer = setTimeout(tick, nextPollDelay(isHidden(), failures));
    };
    void tick();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [status, loadRequests, endWith]);

  const decide = useCallback(async (id: string, decision: 'approve' | 'decline'): Promise<DecideOutcome> => {
    try {
      const request = await decideRoomRequest(creds, id, decision);
      setDecisions((prev) => ({ ...prev, [id]: request.status }));
      setRequests((prev) => prev.filter((r) => r.id !== id));
      return 'ok';
    } catch (error) {
      if (endWith(error)) return 'failed';
      if (error instanceof GuestThreadError && error.status === 409) {
        // Decided elsewhere: the list (and soon the thread's notice) catches up.
        setRequests((prev) => prev.filter((r) => r.id !== id));
        void loadRequests().catch(() => {});
        return 'conflict';
      }
      return 'failed';
    }
  }, [creds, endWith, loadRequests]);

  const send = useCallback((pending: PendingSend): SendResult => {
    void deliver(pending);
    return 'sent';
  }, [deliver]);

  const retry = useCallback((localId: string) => {
    const pending = failedRef.current.get(localId);
    if (pending) void deliver(pending);
  }, [deliver]);

  return {
    status, room, movedTo, creds,
    messages: feed.messages, hasOlder: feed.hasOlder, olderState: feed.olderState, loadOlder: feed.loadOlder, sendTick: feed.sendTick,
    reload: load, refresh, send, retry,
    requests: requests.filter((r) => !decisions[r.id]), decisions, decide,
  };
}
