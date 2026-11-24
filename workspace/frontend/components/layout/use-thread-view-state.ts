'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ArtifactReference } from '@/lib/thread-artifacts';

export type BrowserView = 'compact' | 'minimized' | 'fullscreen' | 'closed';
export interface ThreadViewState {
  selectedArtifact: ArtifactReference | null;
  selectedBrowser: ArtifactReference | null;
  previewOpen: boolean;
  browserView: BrowserView | null;
  browserWatchOnly: boolean;
  sidebarOpen: boolean | null;
  conversationWidth: number;
}
type BrowserState = Pick<ThreadViewState, 'selectedBrowser' | 'browserView' | 'browserWatchOnly'>;
const noBrowser: BrowserState = { selectedBrowser: null, browserView: null, browserWatchOnly: false };
const empty: ThreadViewState = {
  selectedArtifact: null, previewOpen: false, sidebarOpen: null, conversationWidth: 50, ...noBrowser,
};
const reference = (value: any): value is ArtifactReference => value &&
  ['file', 'knowledge', 'browser'].includes(value.kind) && typeof value.id === 'string' && value.id.length > 0;

function read(key: string): ThreadViewState | null {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (!data || data.version !== 1) return null;
    return {
      selectedArtifact: reference(data.selectedArtifact) && data.selectedArtifact.kind !== 'browser' ? data.selectedArtifact : null,
      previewOpen: data.previewOpen === true,
      sidebarOpen: typeof data.sidebarOpen === 'boolean' ? data.sidebarOpen : null,
      conversationWidth: typeof data.conversationWidth === 'number' && Number.isFinite(data.conversationWidth) ? Math.max(25, Math.min(75, data.conversationWidth)) : 50,
      // Browser fields written by older versions are ignored; see below.
      ...noBrowser,
    };
  } catch { return null; }
}

/** Personal, device-local preferences; never shared with other thread members.
 *
 * The browser overlay is deliberately not restored. Agents reuse shared tabs
 * across threads, so a browser remembered in an idle thread would mount
 * another thread's live stream there. It lasts for one visit to the thread;
 * switching away or reloading collapses it. Close is remembered separately
 * (browser-preview-preference). */
export function useThreadViewState(workspace: string, viewer: string, thread: string) {
  const key = workspace && viewer && thread ? `oa-thread-view:${JSON.stringify([workspace, viewer, thread])}` : '';
  const cache = useRef(new Map<string, { value: ThreadViewState; saved: boolean }>());
  const [revision, setRevision] = useState(0);
  const [browser, setBrowser] = useState<{ key: string; value: BrowserState }>({ key: '', value: noBrowser });
  const entry = useMemo(() => {
    if (!key) return { value: empty, saved: false };
    const cached = cache.current.get(key);
    if (cached) return cached;
    const stored = read(key);
    const next = { value: stored || { ...empty }, saved: !!stored };
    cache.current.set(key, next);
    return next;
  }, [key, revision]);
  // Leaving the thread ends the visit, so returning starts collapsed.
  if (browser.key !== key) setBrowser({ key, value: noBrowser });
  const browserState = browser.key === key ? browser.value : noBrowser;
  const state = useMemo(() => ({ ...entry.value, ...browserState }), [entry.value, browserState]);
  const update = useCallback((patch: Partial<ThreadViewState>, persist = true) => {
    if (!key) return;
    const { selectedBrowser, browserView, browserWatchOnly, ...rest } = patch;
    const browserPatch: Partial<BrowserState> = Object.fromEntries(
      Object.entries({ selectedBrowser, browserView, browserWatchOnly }).filter(([, value]) => value !== undefined));
    if (Object.keys(browserPatch).length) {
      // A late update from a thread the viewer already left is discarded.
      setBrowser(previous => previous.key === key ? { key, value: { ...previous.value, ...browserPatch } } : previous);
    }
    if (!Object.keys(rest).length) return;
    const previous = cache.current.get(key) || { value: { ...empty }, saved: false };
    const value = { ...previous.value, ...rest };
    cache.current.set(key, { value, saved: previous.saved || persist });
    if (persist) {
      const { selectedBrowser: _b, browserView: _v, browserWatchOnly: _w, ...stored } = value;
      try { localStorage.setItem(key, JSON.stringify({ ...stored, version: 1 })); } catch { /* In-memory preferences still work. */ }
    }
    setRevision(value => value + 1);
  }, [key]);
  const applyDefault = useCallback((artifact: ArtifactReference | null, unavailable = false) => {
    if (cache.current.get(key)?.saved) return;
    // A pinned browser stays a click away in the thread's artifacts; it never
    // opens the overlay on arrival (the tab may be driven from another thread).
    if (artifact?.kind === 'browser') return;
    update({ selectedArtifact: artifact, previewOpen: !!artifact || unavailable }, false);
  }, [key, update]);
  return { state, hasSavedView: entry.saved, update, applyDefault };
}
