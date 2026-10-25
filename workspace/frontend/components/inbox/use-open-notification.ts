'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useLayout } from '@/components/layout/layout-context';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { inboxDestination, threadFilterFor } from '@/lib/inbox';
import { currentRouteSearch } from '@/lib/route-search';
import type { NotificationItem, WorkspaceSession } from '@/lib/types';

/** How long a thread the list does not have yet may take to turn up. */
const LOOKUP_TIMEOUT_MS = 8000;

/**
 * Open whatever a notification is about — shared by the Inbox view and the
 * bell menu. A thread missing from the loaded list (created since the last
 * poll) is looked up again rather than ignored; only one that never turns up
 * gets a message instead of a dead click.
 */
export function useOpenNotification() {
  const t = useT();
  const router = useRouter();
  const { workspace, sessions, setCurrentSessionId, markNotificationRead, refreshAgents } = useWorkspace();
  const { openView, openMobileDetail, setPendingTaskChannel, threadFilter, setThreadFilter } = useLayout();
  const [waitingFor, setWaitingFor] = useState<string | null>(null);

  const showThread = useCallback((sessionId: string, filter: typeof threadFilter) => {
    setThreadFilter(filter);
    setCurrentSessionId(sessionId);
    openView('threads');
    openMobileDetail();
  }, [setThreadFilter, setCurrentSessionId, openView, openMobileDetail]);

  const openSession = useCallback((session: WorkspaceSession) => {
    showThread(session.sessionId, threadFilterFor(session, threadFilter));
  }, [showThread, threadFilter]);

  useEffect(() => {
    if (!waitingFor) return;
    const session = sessions.find((s) => s.sessionId === waitingFor);
    if (session) {
      setWaitingFor(null);
      openSession(session);
    }
  }, [waitingFor, sessions, openSession]);

  useEffect(() => {
    if (!waitingFor) return;
    const id = setTimeout(() => {
      setWaitingFor(null);
      toast.error(t('inbox.threadUnavailable'));
    }, LOOKUP_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [waitingFor, t]);

  return useCallback((notification: NotificationItem) => {
    if (!notification.isRead) markNotificationRead(notification.id);
    const dest = inboxDestination(notification);
    if (!dest) return;
    switch (dest.kind) {
      case 'credits':
        if (workspace?.slug) router.push(`/${workspace.slug}/settings/api-credits${currentRouteSearch()}`);
        return;
      case 'task':
        // Task threads are hidden from the Threads list — landing there would
        // strand the user with no list context. Open the Tasks board on it.
        setPendingTaskChannel(dest.channel);
        openView('tasks');
        return;
      case 'dm':
        showThread(dest.channel, 'dms');
        return;
      case 'thread': {
        const session = sessions.find((s) => s.sessionId === dest.channel);
        if (session) {
          openSession(session);
          return;
        }
        setWaitingFor(dest.channel);
        void refreshAgents();
      }
    }
  }, [markNotificationRead, workspace?.slug, router, setPendingTaskChannel, openView, showThread, sessions, openSession, refreshAgents]);
}
