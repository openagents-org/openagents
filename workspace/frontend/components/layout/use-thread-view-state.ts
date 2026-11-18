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
const empty: ThreadViewState = {
  selectedArtifact: null, selectedBrowser: null, previewOpen: false,
  browserView: null, browserWatchOnly: false, sidebarOpen: null, conversationWidth: 50,
};
const reference = (value: any): value is ArtifactReference => value &&
  ['file', 'knowledge', 'browser'].includes(value.kind) && typeof value.id === 'string' && value.id.length > 0;

function read(key: string): ThreadViewState | null {
  try {
    const data = JSON.parse(localStorage.getItem(key) || 'null');
    if (!data || data.version !== 1) return null;
    return {
      selectedArtifact: reference(data.selectedArtifact) && data.selectedArtifact.kind !== 'browser' ? data.selectedArtifact : null,
      // Persist references only. Live URLs may contain temporary credentials.
      selectedBrowser: reference(data.selectedBrowser) && data.selectedBrowser.kind === 'browser' && !data.selectedBrowser.id.includes('://') ? data.selectedBrowser : null,
      previewOpen: data.previewOpen === true,
      browserView: ['compact', 'minimized', 'fullscreen', 'closed'].includes(data.browserView) ? data.browserView : null,
      browserWatchOnly: data.browserWatchOnly === true,
      sidebarOpen: typeof data.sidebarOpen === 'boolean' ? data.sidebarOpen : null,
      conversationWidth: typeof data.conversationWidth === 'number' && Number.isFinite(data.conversationWidth) ? Math.max(25, Math.min(75, data.conversationWidth)) : 50,
    };
  } catch { return null; }
}

/** Personal, device-local preferences; never shared with other thread members. */
export function useThreadViewState(workspace: string, viewer: string, thread: string) {
  const key = workspace && viewer && thread ? `oa-thread-view:${JSON.stringify([workspace, viewer, thread])}` : '';
  const cache = useRef(new Map<string, { value: ThreadViewState; saved: boolean }>());
  const [revision, setRevision] = useState(0);
  const entry = useMemo(() => {
    if (!key) return { value: empty, saved: false };
    const cached = cache.current.get(key);
    if (cached) return cached;
    const stored = read(key);
    const next = { value: stored || { ...empty }, saved: !!stored };
    cache.current.set(key, next);
    return next;
  }, [key, revision]);
  const update = useCallback((patch: Partial<ThreadViewState>, persist = true) => {
    if (!key) return;
    const previous = cache.current.get(key) || { value: { ...empty }, saved: false };
    const value = { ...previous.value, ...patch };
    cache.current.set(key, { value, saved: previous.saved || persist });
    if (persist) {
      const selectedBrowser = value.selectedBrowser?.id.includes('://') ? null : value.selectedBrowser;
      try { localStorage.setItem(key, JSON.stringify({ ...value, selectedBrowser, version: 1 })); } catch { /* In-memory preferences still work. */ }
    }
    setRevision(value => value + 1);
  }, [key]);
  const applyDefault = useCallback((artifact: ArtifactReference | null, unavailable = false) => {
    if (cache.current.get(key)?.saved) return;
    update(artifact?.kind === 'browser'
      ? { selectedBrowser: artifact, browserView: 'compact' }
      : { selectedArtifact: artifact, previewOpen: !!artifact || unavailable }, false);
  }, [key, update]);
  return { state: entry.value, hasSavedView: entry.saved, update, applyDefault };
}
