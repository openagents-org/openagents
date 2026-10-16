'use client';

import { useEffect, useRef } from 'react';
import { workspaceApi } from '@/lib/api';
import { desktopHost } from '@/lib/desktop-host';
import { requestMessageTarget } from '@/lib/message-target';
import { shareOrigin } from '@/lib/share-origin';
import { isOpaqueThreadId, workspaceThreadLink } from '@/lib/thread-link';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from './layout-context';

/**
 * In the desktop app, a web link to a thread of this workspace opens that
 * thread here instead of in the browser. A thread this app cannot open — no
 * access, deleted, unknown — still goes to the browser, where the web app
 * explains why. The web app keeps its own new-tab behaviour.
 */
export function useDesktopThreadLinks(): void {
  const { workspace, sessions, setCurrentSessionId } = useWorkspace();
  const { openView } = useLayout();
  // The listener is installed once; it reads the latest state through here.
  const latest = useRef({ workspace, sessions, setCurrentSessionId, openView });
  latest.current = { workspace, sessions, setCurrentSessionId, openView };

  useEffect(() => {
    if (!desktopHost()) return;
    const open = async (href: string, thread: string, message: string | null) => {
      const known = (id: string) => latest.current.sessions.some((s) => s.sessionId === id);
      let sessionId = known(thread) ? thread : null;
      if (!sessionId && isOpaqueThreadId(thread)) {
        // The server only resolves a link the viewer may open.
        try { sessionId = (await workspaceApi.resolveThreadLink(thread)).session_id; }
        catch { /* Not available here: let the browser show why. */ }
      }
      if (!sessionId) {
        window.open(href, '_blank');
        return;
      }
      latest.current.openView('threads');
      latest.current.setCurrentSessionId(sessionId);
      if (message) requestMessageTarget(sessionId, message);
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const { workspace: current } = latest.current;
      if (!current) return;
      const href = anchor.href;
      const link = workspaceThreadLink(href, [shareOrigin()], [current.slug, current.workspaceId].filter(Boolean) as string[]);
      if (!link) return;
      event.preventDefault();
      event.stopPropagation();
      void open(href, link.thread, link.message);
    };
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);
}
