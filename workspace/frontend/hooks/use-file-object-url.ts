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
/** Thumbnails are full-size originals (there is no resizing endpoint). */
const MAX_CACHED_BYTES = 150 * 1024 * 1024;
const MAX_CONCURRENT = 6;
/** A download that never answers must not hold one of the few slots forever. */
const FETCH_TIMEOUT_MS = 30_000;

interface Entry {
  url?: string;
  bytes: number;
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

let cachedBytes = 0;

function forget(key: string, entry: Entry) {
  if (entry.url) URL.revokeObjectURL(entry.url);
  cachedBytes -= entry.bytes;
  cache.delete(key);
}

function evict() {
  if (cache.size <= MAX_CACHED && cachedBytes <= MAX_CACHED_BYTES) return;
  const idle = [...cache.entries()].filter(([, e]) => e.refs === 0 && !e.promise).sort((a, b) => a[1].used - b[1].used);
  for (const [key, entry] of idle) {
    if (cache.size <= MAX_CACHED && cachedBytes <= MAX_CACHED_BYTES) break;
    forget(key, entry);
  }
}

function load(key: string, fileId: string, entry: Entry) {
  entry.promise = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await acquireSlot();
    try {
      // Everyone who wanted it scrolled away while it queued: don't fetch.
      if (entry.refs === 0) { cache.delete(key); return; }
      const abort = new AbortController();
      timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS);
      const response = await workspaceApi.fetchFile(fileId, abort.signal);
      const blob = await response.blob();
      entry.url = URL.createObjectURL(blob);
      entry.bytes = blob.size || 0;
      cachedBytes += entry.bytes;
    } catch {
      entry.failed = true;
    } finally {
      if (timer) clearTimeout(timer);
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
function forgetOtherViewers(current: string) {
  if (current === viewer) return;
  viewer = current;
  for (const [key, entry] of cache) {
    if (key.endsWith(`:${current}`) || entry.refs > 0) continue;
    forget(key, entry);
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
  const { user, idToken } = useOpenAgentsAuth();
  // Keyed by who is looking, not by their sign-in token: that token is
  // refreshed every hour, and keying on it emptied the cache (every
  // thumbnail flickered and downloaded again) each time.
  const viewerKey = user?.email || idToken || 'anonymous';
  const key = `${fileId}:${viewerKey}`;
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>(() => snapshot(key));
  useEffect(() => {
    if (!fileId) return;
    forgetOtherViewers(viewerKey);
    let entry = cache.get(key);
    if (!entry && !enabled) return;
    if (!entry) {
      entry = { refs: 0, bytes: 0, used: Date.now(), listeners: new Set() };
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
      if (current.refs === 0 && current.failed) forget(key, current);
      evict();
    };
  }, [fileId, key, enabled, viewerKey]);
  return state.key === key ? state : snapshot(key);
}

/** Revoke and forget every cached URL. For tests, which reuse file ids. */
export function resetFileObjectUrlCache() {
  for (const entry of cache.values()) if (entry.url) URL.revokeObjectURL(entry.url);
  cache.clear();
  cachedBytes = 0;
  viewer = undefined;
}
