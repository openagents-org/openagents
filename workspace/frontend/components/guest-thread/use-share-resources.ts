'use client';

import { useEffect, useRef, useState } from 'react';
import { EMPTY_RESOURCES, type ShareResourceSource, type ShareResources } from '@/lib/share-resources';
import { isHidden } from './use-thread-feed';

/** How often a share page re-reads the thread's artifacts and routines. */
export const RESOURCES_POLL_MS = 15000;

/**
 * The thread's artifacts and routines: read on open, every 15s while the page
 * is visible, when it becomes visible again, and whenever `bump` changes
 * (e.g. a new agent message, which may have made a file).
 */
export function useShareResources(source: ShareResourceSource | null, bump: number | string = 0) {
  const [resources, setResources] = useState<ShareResources>(EMPTY_RESOURCES);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const key = source?.key ?? null;
  const loadRef = useRef<() => void>(() => {});

  useEffect(() => {
    setResources(EMPTY_RESOURCES);
    if (!key) return;
    let cancelled = false;
    let busy = false;
    const load = async () => {
      const current = sourceRef.current;
      if (!current || busy || cancelled) return;
      busy = true;
      try {
        const next = await current.fetchResources();
        if (!cancelled) setResources(next);
      } catch {
        // Keep what's shown; the next poll tries again.
      } finally {
        busy = false;
      }
    };
    loadRef.current = () => { void load(); };
    void load();
    const timer = setInterval(() => { if (!isHidden()) void load(); }, RESOURCES_POLL_MS);
    const onVisible = () => { if (!isHidden()) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      loadRef.current = () => {};
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);

  // Something new in the thread: look again (skipping the first render, which loaded above).
  const firstBump = useRef(true);
  useEffect(() => {
    if (firstBump.current) { firstBump.current = false; return; }
    loadRef.current();
  }, [bump]);

  return resources;
}

/**
 * A blob URL for one of the thread's files (images in tiles and messages),
 * revoked when it's no longer shown. `null` while loading; `failed` after an error.
 */
export function useShareFileUrl(source: ShareResourceSource | null, fileId: string | null, enabled = true) {
  const [state, setState] = useState<{ key: string; url?: string; failed?: boolean }>({ key: '' });
  const key = source && fileId && enabled ? `${source.key}:${fileId}` : '';
  const sourceRef = useRef(source);
  sourceRef.current = source;
  useEffect(() => {
    if (!key || !fileId) return;
    const abort = new AbortController();
    let url: string | undefined;
    sourceRef.current!.fetchFile(fileId, abort.signal)
      .then((res) => res.blob())
      .then((blob) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ key, url });
      })
      .catch(() => { if (!abort.signal.aborted) setState({ key, failed: true }); });
    return () => { abort.abort(); if (url) URL.revokeObjectURL(url); };
  }, [key, fileId]);
  const current = state.key === key ? state : { key, url: undefined, failed: false };
  return { url: current.url ?? null, failed: !!current.failed };
}
