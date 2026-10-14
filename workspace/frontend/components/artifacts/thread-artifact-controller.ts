'use client';
import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { threadBrowserTabs } from '@/lib/thread-browser';
import { ARTIFACT_OPEN_EVENT, artifactFromLink, type ArtifactReference } from '@/lib/thread-artifacts';

/** Opening a thread restores its owner's default, not the previous thread's preview. */
export function useThreadArtifactPreview() {
  const { workspace, currentSessionId, currentUser, loading, files, browserTabs } = useWorkspace();
  const { viewMode, openArtifact, setSelectedArtifact, setShowBrowserPreview, setSplitBrowser, selectedArtifact, showBrowserPreview, isMobile } = useLayout();
  const manual = useRef(0);
  const browserFollow = useRef({ seen: new Set<string>(), opened: null as string | null, paused: false });
  useEffect(() => {
    if (loading || viewMode !== 'threads') return;
    let active = true;
    const revision = ++manual.current;
    browserFollow.current = { seen: new Set(), opened: null, paused: false };
    setSelectedArtifact(null); setShowBrowserPreview(false);
    if (currentSessionId && !currentSessionId.startsWith('dm:')) {
      void workspaceApi.getThreadArtifact(currentSessionId).then(setting => {
        if (!active || manual.current !== revision) return;
        if (setting.artifact) openArtifact(setting.artifact);
        else if (setting.unavailable) { setSplitBrowser(true); setShowBrowserPreview(true); }
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [loading, workspace?.workspaceId, currentSessionId, currentUser.id, viewMode]); // setters are stable; manual selection must not reload defaults

  // Live tabs are associated by the browser API, not guessed from the agent's
  // membership (one agent may be working in several conversations).
  useEffect(() => {
    if (loading || viewMode !== 'threads' || !currentSessionId || isMobile) return;
    const follow = browserFollow.current;
    if (follow.opened && (!showBrowserPreview || selectedArtifact?.kind !== 'browser' || selectedArtifact.id !== follow.opened)) {
      follow.paused = true;
    }
    if (follow.paused) return;
    const tabs = threadBrowserTabs(browserTabs, currentSessionId);
    const next = tabs.find(tab => !follow.seen.has(tab.id));
    tabs.forEach(tab => follow.seen.add(tab.id));
    if (!next) return;
    ++manual.current; // A late pinned-artifact response must not replace the live view.
    follow.opened = next.id;
    openArtifact({ kind: 'browser', id: next.id });
  }, [loading, viewMode, currentSessionId, browserTabs, selectedArtifact, showBrowserPreview, isMobile, openArtifact]);

  useEffect(() => {
    const show = (event: Event) => {
      const artifact = (event as CustomEvent<ArtifactReference>).detail;
      if (!artifact || !['file','knowledge','browser'].includes(artifact.kind) || !artifact.id) return;
      browserFollow.current.paused = true;
      ++manual.current; openArtifact(artifact);
    };
    const click = (event: MouseEvent) => {
      if (viewMode !== 'threads' || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || !anchor.closest('[data-thread-conversation], [data-artifact-preview]')) return;
      const artifact = artifactFromLink(anchor.getAttribute('href') || '', files, browserTabs, workspace?.slug || workspace?.workspaceId || '');
      if (!artifact) return;
      event.preventDefault(); event.stopPropagation(); browserFollow.current.paused = true; ++manual.current; openArtifact(artifact);
    };
    window.addEventListener(ARTIFACT_OPEN_EVENT, show);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener(ARTIFACT_OPEN_EVENT, show); document.removeEventListener('click', click, true); };
  }, [viewMode, files, browserTabs, workspace?.slug, workspace?.workspaceId, openArtifact]);
}
