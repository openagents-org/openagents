'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCheck, Inbox, RefreshCw } from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { useMe } from '@/hooks/use-me';
import { workspaceApi } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { groupInboxRows, inboxActionKind } from '@/lib/inbox';
import type { ApprovalRequest, NotificationItem } from '@/lib/types';
import { useWorkspace } from '@/lib/workspace-context';
import { NotificationSection, type ActionState } from './notification-section';
import { useOpenNotification } from './use-open-notification';

// The notifications menu renders inbox rows too.
export { NotificationCard } from './notification-card';

export function InboxView() {
  const t = useT();
  const {
    workspace,
    notifications,
    unreadNotificationCount,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    pendingApprovals,
    refreshApprovals,
  } = useWorkspace();
  const me = useMe(workspace?.slug || workspace?.workspaceId);

  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [actionState, setActionState] = useState<ActionState>({ cards: {}, loading: {}, failed: {} });
  // Until the pending list has loaded once we cannot tell "decided" from
  // "not fetched yet" — keep every actionable row under Needs you meanwhile.
  const [approvalsLoaded, setApprovalsLoaded] = useState(false);

  useEffect(() => {
    refreshNotifications();
    refreshApprovals().finally(() => setApprovalsLoaded(true));
  }, [refreshNotifications, refreshApprovals]);

  // Action refs known to be decided: a fetched record that is no longer
  // pending, or (once loaded) anything the pending list does not carry.
  const resolvedRefs = useMemo(() => {
    const out = new Set<string>();
    for (const a of Object.values(actionState.cards)) {
      if (a.status !== 'pending') out.add(a.id);
    }
    if (approvalsLoaded) {
      const pending = new Set(pendingApprovals.map((a) => a.id));
      for (const n of notifications) {
        if (!n.actionRef || inboxActionKind(n) === null) continue;
        if (pending.has(n.actionRef)) continue;
        if (actionState.cards[n.actionRef]?.status === 'pending') continue;
        out.add(n.actionRef);
      }
    }
    return out;
  }, [actionState.cards, approvalsLoaded, pendingApprovals, notifications]);

  const { needsYou, updates } = useMemo(
    () => groupInboxRows(notifications, me?.email ?? null, resolvedRefs),
    [notifications, me?.email, resolvedRefs],
  );

  const loadCard = useCallback((ref: string) => {
    setActionState((s) => {
      if (s.cards[ref] || s.loading[ref]) return s;
      return { ...s, loading: { ...s.loading, [ref]: true }, failed: { ...s.failed, [ref]: false } };
    });
    workspaceApi.getApproval(ref)
      .then((a) => setActionState((s) => ({
        ...s,
        cards: { ...s.cards, [ref]: a },
        loading: { ...s.loading, [ref]: false },
      })))
      .catch(() => setActionState((s) => ({
        ...s,
        loading: { ...s.loading, [ref]: false },
        failed: { ...s.failed, [ref]: true },
      })));
  }, []);

  const handleToggle = useCallback((n: NotificationItem) => {
    if (!n.actionRef) return;
    const opening = !expandedIds[n.id];
    setExpandedIds((e) => ({ ...e, [n.id]: opening }));
    if (opening && !actionState.cards[n.actionRef]) loadCard(n.actionRef);
  }, [expandedIds, actionState.cards, loadCard]);

  const handleResolved = useCallback((n: NotificationItem, a: ApprovalRequest) => {
    setActionState((s) => ({ ...s, cards: { ...s.cards, [a.id]: a } }));
    if (!n.isRead) markNotificationRead(n.id).catch(() => {});
    refreshNotifications();
  }, [markNotificationRead, refreshNotifications]);

  const handleNavigate = useOpenNotification();

  const sectionProps = {
    onRead: markNotificationRead,
    onDismiss: dismissNotification,
    onNavigate: handleNavigate,
    expandedIds,
    onToggle: handleToggle,
    actionState,
    resolvedRefs,
    onResolved: handleResolved,
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header — title in the app header, actions in its toolbar */}
      <DetailHeader
        title={<>
          <Inbox className="size-4 text-foreground" />
          <h2 className="text-sm font-semibold">{t('inbox.title')}</h2>
        </>}
      >
        <div className="flex items-center gap-0.5 text-muted-foreground">
          {unreadNotificationCount > 0 && (
            <>
              <span className="me-1 text-xs">
                {t('notifications.unreadCount', { count: unreadNotificationCount })}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={markAllNotificationsRead}
                title={t('inbox.markAllRead')}
                aria-label={t('inbox.markAllRead')}
              >
                <CheckCheck />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={refreshNotifications}
            title={t('common.refresh')}
            aria-label={t('common.refresh')}
          >
            <RefreshCw />
          </Button>
        </div>
      </DetailHeader>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>{t('inbox.emptyTitle')}</EmptyTitle>
              <EmptyDescription>{t('inbox.emptyBody')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            <NotificationSection title={t('inbox.needsYou')} items={needsYou} {...sectionProps} />
            <NotificationSection title={t('inbox.updates')} items={updates} {...sectionProps} />
          </div>
        )}
      </div>
    </div>
  );
}
