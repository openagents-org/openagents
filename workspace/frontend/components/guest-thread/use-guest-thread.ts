'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GuestThreadError,
  clearGuestSession,
  fetchEarlierGuestMessages,
  fetchGuestMessages,
  fetchThreadLink,
  inviteGate,
  isTerminalLinkError,
  setGuestBearer,
  joinAsGuest,
  loadGuestSession,
  postGuestMessage,
  bringGuestAgent,
  removeGuestAgent,
  saveGuestSession,
  type GuestIdentity,
  type GuestThreadInfo,
} from '@/lib/guest-thread-api';
import { optimisticMessage, type PendingSend } from '@/lib/guest-thread';
import { isHidden, useThreadFeed, type ThreadFeedSource } from './use-thread-feed';

export type GuestThreadStatus = 'loading' | 'ready' | 'not_found' | 'expired' | 'error' | 'invite_signin' | 'invite_denied';
export type SendResult = 'sent' | 'needs-name';

export const INFO_REFRESH_MS = 30000;

/**
 * State for one shared thread seen by a guest: the link info, the merged
 * message list (initial page + ~3s polling), the guest identity, and sends
 * with optimistic rows and idempotent retries. Only talks to the public
 * `/v1/guest-links/public/{token}` API.
 */
export interface GuestAuth {
  /** The signed-in account's bearer, read at request time. */
  idToken: () => string | null;
  signedIn: boolean;
  /** Sign-in state is known. */
  ready: boolean;
  /** Shown on your own messages before the server names you. */
  displayName?: string | null;
}

export function useGuestThread(token: string, options: { preview?: boolean; auth?: GuestAuth } = {}) {
  // The owner's preview reads as a stranger would: no stored guest session, no joining, no sign-in.
  const preview = !!options.preview;
  const auth = options.auth;
  const signedIn = !preview && !!auth?.signedIn;
  const authReady = preview || !auth || auth.ready;
  const authRef = useRef(auth);
  authRef.current = auth;
  // Invite-only jams: every guest call carries the signed-in bearer. Open links never
  // learn who is signed in: the bearer goes out only once the jam says it's invite-only.
  const inviteOnlyRef = useRef(false);
  setGuestBearer(token, signedIn ? () => (inviteOnlyRef.current ? authRef.current?.idToken() ?? null : null) : null);
  const [status, setStatus] = useState<GuestThreadStatus>('loading');
  /** Invite-only, signed in but not invited: the account it checked. */
  const [deniedEmail, setDeniedEmail] = useState<string | null>(null);
  const [info, setInfo] = useState<GuestThreadInfo | null>(null);
  const [guest, setGuest] = useState<GuestIdentity | null>(null);
  const [nameRequest, setNameRequest] = useState<{ reason: 'first-post' | 'session-expired' } | null>(null);
  /** The owner removed this guest: reading still works, posting doesn't. Remembered per link in this browser. */
  const [removed, setRemoved] = useState(() => loadRemoved(token));

  const sessionRef = useRef<string | null>(null);
  const guestRef = useRef<GuestIdentity | null>(null);
  const queuedRef = useRef<PendingSend | null>(null);
  const failedRef = useRef(new Map<string, PendingSend>());

  const setIdentity = useCallback((nextGuest: GuestIdentity | null, session: string | null) => {
    guestRef.current = nextGuest;
    sessionRef.current = session;
    setGuest(nextGuest);
  }, []);

  /** An invite-only jam turned this viewer away: sign in, or a different account. */
  const gateWith = useCallback((error: unknown): boolean => {
    const gate = inviteGate(error);
    if (!gate) return false;
    if (gate.kind === 'denied') { setDeniedEmail(gate.email); setStatus('invite_denied'); }
    else setStatus('invite_signin');
    return true;
  }, []);

  const endWith = useCallback((error: unknown): boolean => {
    if (gateWith(error)) return true;
    if (!isTerminalLinkError(error)) return false;
    setStatus(error.kind === 'expired' ? 'expired' : 'not_found');
    return true;
  }, [gateWith]);

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
      let session = preview ? null : loadGuestSession(token);
      let linkInfo: GuestThreadInfo;
      try {
        try {
          linkInfo = await fetchThreadLink(token, session);
        } catch (error) {
          // Invite-only and signed in: ask again, this time as the account.
          if (inviteGate(error)?.kind !== 'signin' || inviteOnlyRef.current || !authRef.current?.signedIn || preview) throw error;
          inviteOnlyRef.current = true;
          linkInfo = await fetchThreadLink(token, session);
        }
      } catch (error) {
        // A stale session must not lock the guest out of reading.
        if (!(session && error instanceof GuestThreadError && error.kind === 'unauthorized')) throw error;
        clearGuestSession(token);
        session = null;
        linkInfo = await fetchThreadLink(token, null);
      }
      inviteOnlyRef.current = linkInfo.access === 'invited';
      if (session && !linkInfo.guest) {
        clearGuestSession(token);
        session = null;
      }
      const page = await source.fetchMessages(null);
      // An invite-only jam knows a signed-in invitee by their account, session or not.
      const byAccount = linkInfo.access === 'invited' && !!authRef.current?.signedIn && !preview;
      setIdentity(session || byAccount ? linkInfo.guest : null, session);
      setInfo(linkInfo);
      reset(page);
      setStatus('ready');
    } catch (error) {
      // Invite-only and sign-in still settling: wait for it rather than showing "sign in".
      if (inviteGate(error)?.kind === 'signin' && !readyRef.current) return;
      if (!endWith(error)) setStatus('error');
    }
  }, [token, source, endWith, setIdentity, reset, preview]);

  const readyRef = useRef(authReady);
  readyRef.current = authReady;
  useEffect(() => { void load(); }, [load]);
  // Signed in (or out) since: an invite-only jam may open now — or close.
  const firstAuth = useRef(true);
  useEffect(() => {
    if (firstAuth.current) { firstAuth.current = false; return; }
    void load();
  }, [signedIn, authReady]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** Invite-only and signed in: the account is the identity — no name prompt, no session needed. */
  const infoRef = useRef(info);
  infoRef.current = info;
  const byAccount = () => !preview && !!authRef.current?.signedIn && infoRef.current?.access === 'invited';

  const deliver = useCallback(async (pending: PendingSend) => {
    const accountMode = byAccount();
    const currentGuest = guestRef.current ?? (accountMode ? { id: 'self', name: authRef.current?.displayName || 'You' } : null);
    const session = sessionRef.current;
    if (!currentGuest || (!session && !accountMode)) {
      queuedRef.current = pending;
      setNameRequest({ reason: 'first-post' });
      return;
    }
    failedRef.current.delete(pending.localId);
    const outcome = await deliverFeed(pending, optimisticMessage(pending, currentGuest), (content, key) => postGuestMessage(token, session, content, key).then((event) => {
      // The server names the invitee on their first post: that's who "You" is from now on.
      const named = (event.metadata as { guest?: GuestIdentity } | undefined)?.guest;
      if (!guestRef.current && named?.id) setIdentity(named, sessionRef.current);
      return event;
    }));
    if (outcome.ok || outcome.terminal) return;
    const { error } = outcome;
    if (error instanceof GuestThreadError && error.kind === 'unauthorized' && !accountMode) {
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
    if (isRemovedError(error)) {
      saveRemoved(token);
      setRemoved(true);
      markFailed(optimisticMessage(pending, currentGuest, 'failed', 'removed'));
      return;
    }
    failedRef.current.set(pending.localId, pending);
    const kind = error instanceof GuestThreadError ? error.kind : null;
    const reason = kind === 'rate_limited' || kind === 'forbidden' ? kind : 'failed';
    markFailed(optimisticMessage(pending, currentGuest, 'failed', reason));
  }, [token, setIdentity, deliverFeed, markFailed]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Queue a send; asks for a name first when the guest hasn't picked one. */
  const send = useCallback((pending: PendingSend): SendResult => {
    if (preview) return 'sent';
    if ((!guestRef.current || !sessionRef.current) && !byAccount()) {
      queuedRef.current = pending;
      setNameRequest({ reason: 'first-post' });
      return 'needs-name';
    }
    void deliver(pending);
    return 'sent';
  }, [deliver, preview]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Resend a failed message with its original idempotency key. */
  const retry = useCallback((localId: string) => {
    const pending = failedRef.current.get(localId);
    if (pending) void deliver(pending);
  }, [deliver]);

  // ── Agents the guest brings ──
  /** Run after the name prompt (e.g. "Add agent" asked for a name first). */
  const afterJoinRef = useRef<(() => void) | null>(null);
  const needsName = useCallback(() => !preview && !byAccount() && (!guestRef.current || !sessionRef.current), [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  const requestName = useCallback((then?: () => void) => {
    afterJoinRef.current = then ?? null;
    setNameRequest({ reason: 'first-post' });
  }, []);
  const refreshInfo = useCallback(async () => {
    try { setInfo(await fetchThreadLink(token, sessionRef.current)); } catch (error) { endWith(error); }
  }, [token, endWith]);
  const bringAgent = useCallback(async (agent: { name: string; type: string }) => {
    const result = await bringGuestAgent(token, sessionRef.current, agent);
    void refreshInfo();
    return result;
  }, [token, refreshInfo]);
  const removeAgent = useCallback(async (name: string) => {
    await removeGuestAgent(token, sessionRef.current, name);
    void refreshInfo();
  }, [token, refreshInfo]);

  /** Pick a display name; then deliver whatever was waiting on it. */
  const join = useCallback(async (name: string) => {
    const result = await joinAsGuest(token, name);
    saveGuestSession(token, result.session);
    setIdentity(result.guest, result.session);
    setInfo((prev) => (prev ? { ...prev, guest: result.guest } : prev));
    setNameRequest(null);
    const after = afterJoinRef.current;
    afterJoinRef.current = null;
    after?.();
    const queued = queuedRef.current;
    queuedRef.current = null;
    if (queued) await deliver(queued);
    return queued;
  }, [token, deliver, setIdentity]);

  const cancelName = useCallback(() => {
    queuedRef.current = null;
    afterJoinRef.current = null;
    setNameRequest(null);
  }, []);

  return {
    status, info, messages: feed.messages, hasOlder: feed.hasOlder, olderState: feed.olderState, loadOlder: feed.loadOlder,
    needsName, requestName, bringAgent, removeAgent,
    deniedEmail, guest, nameRequest, sendTick: feed.sendTick, reload: load, send, retry, join, cancelName, endWith, removed,
  };
}

const REMOVED_PREFIX = 'oa-guest-removed:';

/** A 403 saying the owner removed this guest (as opposed to other refusals). */
export function isRemovedError(error: unknown): boolean {
  return error instanceof GuestThreadError && error.status === 403 && /removed you/i.test(error.message);
}

function loadRemoved(token: string): boolean {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(REMOVED_PREFIX + token) === '1'; } catch { return false; }
}

function saveRemoved(token: string): void {
  try { window.localStorage.setItem(REMOVED_PREFIX + token, '1'); } catch { /* memory only */ }
}
