'use client';
import { useEffect, useRef } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { ARTIFACT_OPEN_EVENT, artifactFromLink, type ArtifactReference } from '@/lib/thread-artifacts';

/** Opening a thread restores its owner's default, not the previous thread's preview. */
export function useThreadArtifactPreview() {
  const { workspace, currentSessionId, currentUser, loading, files, browserTabs } = useWorkspace();
  const { viewMode, openArtifact, setSelectedArtifact, setShowBrowserPreview, setSplitBrowser } = useLayout();
  const manual = useRef(0);
  useEffect(() => {
    if (loading || viewMode !== 'threads') return;
    let active = true;
    const revision = ++manual.current;
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

  // Agent browser activity is shown by the thread's compact live preview.
  // The large artifact panel opens only for pinned or explicitly selected items.
  useEffect(() => {
    const show = (event: Event) => {
      const artifact = (event as CustomEvent<ArtifactReference>).detail;
      if (!artifact || !['file','knowledge','browser'].includes(artifact.kind) || !artifact.id) return;
      ++manual.current; openArtifact(artifact);
    };
    const click = (event: MouseEvent) => {
      if (viewMode !== 'threads' || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || !anchor.closest('[data-thread-conversation], [data-artifact-preview]')) return;
      const artifact = artifactFromLink(anchor.getAttribute('href') || '', files, browserTabs, workspace?.slug || workspace?.workspaceId || '');
      if (!artifact) return;
      event.preventDefault(); event.stopPropagation(); ++manual.current; openArtifact(artifact);
    };
    window.addEventListener(ARTIFACT_OPEN_EVENT, show);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener(ARTIFACT_OPEN_EVENT, show); document.removeEventListener('click', click, true); };
  }, [viewMode, files, browserTabs, workspace?.slug, workspace?.workspaceId, openArtifact]);
}
