'use client';
/**
 * One shared copy of each thread's roster and of what the viewer may do in it.
 *
 * The thread header reads it in several places at once (people and agent
 * counts, add participants, response mode, privacy). Each used to fetch on
 * mount and draw nothing until its own answer came back, so every switch to a
 * thread filled the header in piece by piece. Now they all read the last known
 * answer straight away, one request refreshes it for every reader, and the
 * most recent threads are fetched before they are opened.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { workspaceApi } from './api';
import { useOpenAgentsAuth } from './openagents-auth-context';
import { THREAD_PARTICIPANTS_CHANGED } from './thread-participants';
import type { ChannelParticipants } from './types';

/** A roster read this recently, for the same viewer, is not read again. */
const FRESH_MS = 10_000;

/** `viewer` is the identity token the answer was read with; undefined when unknown (a prefetch). */
type Entry = {
  channel: string;
  data: ChannelParticipants | null;
  at: number;
  viewer: string | null | undefined;
  inflight: Promise<ChannelParticipants> | null;
};

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
/** Mounted readers per key, so a change re-reads only the threads on screen. */
const readers = new Map<string, number>();
let listening = false;

const keyFor = (channel: string) => `${workspaceApi.currentWorkspaceId()}\n${channel}`;
const emit = () => { for (const listener of listeners) listener(); };

function fetchKey(key: string, channel: string, viewer: string | null | undefined): Promise<ChannelParticipants> {
  const entry = entries.get(key) ?? { channel, data: null, at: 0, viewer, inflight: null };
  if (entry.inflight) return entry.inflight;
  const settle = (request: Promise<ChannelParticipants>, data: ChannelParticipants | null) => {
    if (entries.get(key)?.inflight !== request) return;
    entries.set(key, { channel, data, at: Date.now(), viewer, inflight: null });
    emit();
  };
  const request: Promise<ChannelParticipants> = workspaceApi.getChannelParticipants(channel).then(
    (data) => { settle(request, data); return data; },
    // No answer means no access to show: readers hide their controls, as they
    // did when each one fetched on its own.
    (error: unknown) => { settle(request, null); throw error; },
  );
  entries.set(key, { ...entry, inflight: request });
  return request;
}

/**
 * The roster, fetched at most once at a time. A fresh copy read for the same
 * viewer is reused unless `force`.
 */
export function loadChannelParticipants(
  channel: string,
  { force = false, viewer }: { force?: boolean; viewer?: string | null } = {},
): Promise<ChannelParticipants> {
  const key = keyFor(channel);
  const entry = entries.get(key);
  if (entry?.inflight) return entry.inflight;
  const fresh = entry?.data && Date.now() - entry.at < FRESH_MS && (viewer === undefined || entry.viewer === viewer);
  if (!force && fresh) return Promise.resolve(entry.data!);
  return fetchKey(key, channel, viewer === undefined ? entry?.viewer : viewer);
}

/** Warm the roster of a thread that may be opened next. Never throws. */
export function prefetchChannelParticipants(channel: string) {
  if (!workspaceApi.isConfigured() || entries.has(keyFor(channel))) return;
  fetchKey(keyFor(channel), channel, undefined).catch(() => {});
}

/** A thread's roster changed: re-read it now if it's on screen, else when next shown. */
function invalidate(channel: string) {
  const key = keyFor(channel);
  const entry = entries.get(key);
  if (!entry) return;
  entry.at = 0;
  if (readers.has(key)) fetchKey(key, channel, entry.viewer).catch(() => {});
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener(THREAD_PARTICIPANTS_CHANGED, (event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (typeof detail === 'string') invalidate(detail);
    else for (const entry of [...entries.values()]) invalidate(entry.channel);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * The thread's roster for a component: the last known one at once (null
 * before the first answer), re-read on mount unless just read for this viewer,
 * and whenever THREAD_PARTICIPANTS_CHANGED names this thread. A new viewer
 * (sign-in, renewed token) re-reads it while the old answer stays on screen.
 */
export function useChannelParticipants(channel: string | null | undefined, enabled = true): ChannelParticipants | null {
  const { idToken } = useOpenAgentsAuth();
  const key = channel && enabled && workspaceApi.isConfigured() ? keyFor(channel) : null;
  const data = useSyncExternalStore(
    subscribe,
    () => (key ? entries.get(key)?.data ?? null : null),
    () => null,
  );
  useEffect(() => {
    if (!key || !channel) return;
    listen();
    readers.set(key, (readers.get(key) ?? 0) + 1);
    return () => {
      const left = (readers.get(key) ?? 1) - 1;
      if (left > 0) readers.set(key, left); else readers.delete(key);
    };
  }, [key, channel]);
  useEffect(() => {
    if (key && channel) loadChannelParticipants(channel, { viewer: idToken }).catch(() => {});
  }, [key, channel, idToken]);
  return data;
}

/** Test seam: forget every roster. */
export function resetChannelParticipants() {
  entries.clear();
  readers.clear();
  emit();
}
