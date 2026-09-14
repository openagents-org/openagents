'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { desktopHost } from '@/lib/desktop-host';
import { useOpenAgentsAuth } from '@/lib/openagents-auth-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout, type ViewMode } from './layout-context';

const VIEWS: ViewMode[] = ['threads', 'files', 'knowledge', 'browser', 'tasks', 'workflows', 'routines', 'inbox', 'connect', 'skills'];

/** Desktop restore state only; web layout, data loading, and UI stay shared. */
export function useDesktopWorkspaceState(): void {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { user } = useOpenAgentsAuth();
  const { loading, sessions, currentSessionId, setCurrentSessionId } = useWorkspace();
  const { viewMode, openView } = useLayout();
  const [restored, setRestored] = useState('');
  const key = user && desktopHost() ? `oa:desktop:view:${user.email}:${workspaceId}` : '';

  useEffect(() => {
    if (!key || loading || restored === key) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved && VIEWS.includes(saved.view)) openView(saved.view);
      if (typeof saved?.thread === 'string' && sessions.some(s => s.sessionId === saved.thread)) {
        setCurrentSessionId(saved.thread, { skipFocus: true });
      }
    } catch { /* A malformed preference cannot prevent opening a workspace. */ }
    setRestored(key);
  }, [key, loading, restored, sessions, openView, setCurrentSessionId]);

  useEffect(() => {
    if (!key || loading || restored !== key) return;
    try { localStorage.setItem(key, JSON.stringify({ view: viewMode, thread: currentSessionId })); }
    catch { /* Optional preference. */ }
  }, [key, loading, restored, viewMode, currentSessionId]);
}
