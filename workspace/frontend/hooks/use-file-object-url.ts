'use client';
import { useEffect, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';

/**
 * Object URLs for workspace files, shared across every component that shows
 * the same file.
 *
 * Media elements can't send Authorization headers, so each image is fetched
 * with the viewer's identity and shown as a local blob. That used to happen
 * per mounted <img>: leaving Files and coming back (the view is unmounted
 * while hidden) revoked every URL and downloaded every thumbnail again, all at
 * once. Now a URL outlives the component that asked for it, the same file is
 * fetched once, at most a handful of fetches run together, and the least
 * recently used URLs no one is showing are revoked once there are many.
 */

const MAX_CACHED = 200;
const MAX_CONCURRENT = 6;

interface Entry {
  url?: string;
  failed?: boolean;
  promise?: Promise<void>;
  refs: number;
  used: number;
  listeners: Set<() => void>;
}

const cache = new Map<string, Entry>();
let running = 0;
const waiting: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (running < MAX_CONCURRENT) { running += 1; return Promise.resolve(); }
  return new Promise(resolve => waiting.push(() => { running += 1; resolve(); }));
}

function releaseSlot() {
  running -= 1;
  waiting.shift()?.();
}

function evict() {
  if (cache.size <= MAX_CACHED) return;
  const idle = [...cache.entries()].filter(([, e]) => e.refs === 0 && !e.promise).sort((a, b) => a[1].used - b[1].used);
  for (const [key, entry] of idle) {
    if (cache.size <= MAX_CACHED) break;
    if (entry.url) URL.revokeObjectURL(entry.url);
    cache.delete(key);
  }
}

function load(key: string, fileId: string, entry: Entry) {
  entry.promise = (async () => {
    await acquireSlot();
    try {
      // Everyone who wanted it scrolled away while it queued: don't fetch.
      if (entry.refs === 0) { cache.delete(key); return; }
      const response = await workspaceApi.fetchFile(fileId);
      entry.url = URL.createObjectURL(await response.blob());
    } catch {
      entry.failed = true;
    } finally {
      releaseSlot();
      entry.promise = undefined;
      entry.listeners.forEach(listener => listener());
      evict();
    }
  })();
}

/** Blobs fetched as someone else (the viewer signed out or switched) must
 *  never be shown to the next one. */
let viewer: string | null | undefined;
function forgetOtherViewers(idToken: string | null | undefined) {
  if (idToken === viewer) return;
  viewer = idToken;
  for (const [key, entry] of cache) {
    if (key.endsWith(`:${idToken}`) || entry.refs > 0) continue;
    if (entry.url) URL.revokeObjectURL(entry.url);
    cache.delete(key);
  }
}

function snapshot(key: string) {
  const entry = cache.get(key);
  return { key, url: entry?.url, failed: entry?.failed };
}

/**
 * `enabled: false` defers the download (a tile not yet scrolled into view)
 * but still returns a URL that's already cached.
 */
export function useFileObjectUrl(fileId?: string, { enabled = true }: { enabled?: boolean } = {}) {
  const { idToken } = useOpenAgentsAuth();
  const key = `${fileId}:${idToken}`;
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>(() => snapshot(key));
  useEffect(() => {
    if (!fileId) return;
    forgetOtherViewers(idToken);
    let entry = cache.get(key);
    if (!entry && !enabled) return;
    if (!entry) {
      entry = { refs: 0, used: Date.now(), listeners: new Set() };
      cache.set(key, entry);
    }
    const current = entry;
    current.refs += 1;
    current.used = Date.now();
    const update = () => setState(snapshot(key));
    current.listeners.add(update);
    if (current.url || current.failed) update();
    else if (!current.promise && enabled) load(key, fileId, current);
    return () => {
      current.refs -= 1;
      current.used = Date.now();
      current.listeners.delete(update);
      // A failure isn't remembered past its last viewer; the next one retries.
      if (current.refs === 0 && current.failed) cache.delete(key);
      evict();
    };
  }, [fileId, key, enabled, idToken]);
  return state.key === key ? state : snapshot(key);
}

/** Revoke and forget every cached URL. For tests, which reuse file ids. */
export function resetFileObjectUrlCache() {
  for (const entry of cache.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  cache.clear();
  viewer = undefined;
}
