'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Inbox, CheckCheck, RefreshCw, X, ExternalLink, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useMe } from '@/hooks/use-me';
import { useFormatters, useT } from '@/lib/i18n';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { ApprovalCard } from '@/components/chat/approval-card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { workspaceApi } from '@/lib/api';
import { agentLabel } from '@/lib/helpers';
import { groupInboxRows, inboxActionKind, inboxSessionTarget, type InboxActionKind } from '@/lib/inbox';
import { useHumanNames } from '@/hooks/use-team-roster';
import { humanColor } from '@/lib/human-color';
import { User } from 'lucide-react';
import type { ApprovalRequest, NotificationItem } from '@/lib/types';

function PriorityDot({ priority }: { priority: NotificationItem['priority'] }) {
  return (
    <span
      className={cn(
        'size-2 rounded-full shrink-0 mt-1.5',
        priority === 'high' && 'bg-red-500',
        priority === 'normal' && 'bg-foreground/70',
        priority === 'low' && 'bg-zinc-400',
      )}
    />
  );
}

/** What the row is asking of the reader — or that it is done. */
function KindChip({ kind, resolved }: { kind: InboxActionKind; resolved: boolean }) {
  const t = useT();
  if (resolved) {
    return <Badge variant="secondary" appearance="light" size="xs" className="shrink-0">{t('inbox.chipDone')}</Badge>;
  }
  if (kind === 'help') {
    return <Badge variant="warning" appearance="light" size="xs" className="shrink-0">{t('inbox.chipHelp')}</Badge>;
  }
  if (kind === 'proposal') {
    return <Badge variant="info" appearance="light" size="xs" className="shrink-0">{t('inbox.chipProposal')}</Badge>;
  }
  return <Badge variant="warning" appearance="light" size="xs" className="shrink-0">{t('inbox.chipApproval')}</Badge>;
}

/** Per-id cache of the live approval records behind actionable rows. */
interface ActionState {
  cards: Record<string, ApprovalRequest>;
  loading: Record<string, boolean>;
  failed: Record<string, boolean>;
}

export function NotificationCard({
  notification,
  onRead,
  onDismiss,
  onNavigate,
  expanded = false,
  onToggle,
  resolved = false,
}: {
  notification: NotificationItem;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (notification: NotificationItem) => void;
  /** Actionable rows only: the card below is open. */
  expanded?: boolean;
  /** Actionable rows only: click toggles the card instead of navigating. */
  onToggle?: (notification: NotificationItem) => void;
  /** The request behind this row is already decided. */
  resolved?: boolean;
}) {
  const t = useT();
  const { timeAgoShort: timeAgo } = useFormatters();
  const { agents } = useWorkspace();
  const humanNames = useHumanNames();
  const fromPerson = notification.createdBy.startsWith('human:');
  const agentName = notification.createdBy.replace(/^(openagents:|system:|human:)/, '');
  const senderAgent = agents.find((a) => a.agentName === agentName);
  const senderLabel = senderAgent
    ? agentLabel(senderAgent)
    : (fromPerson ? (humanNames[agentName.toLowerCase()] ?? agentName) : agentName);
  const actionKind = inboxActionKind(notification);
  const actionable = actionKind !== null && Boolean(onToggle);

  const handleClick = () => {
    if (actionable) {
      if (!notification.isRead) onRead(notification.id);
      onToggle?.(notification);
      return;
    }
    onNavigate(notification);
  };

  return (
    <div
      className={cn(
        'px-3 py-2.5 flex items-start gap-2.5 cursor-pointer transition-colors',
        !notification.isRead
          ? 'bg-accent/60 dark:bg-accent/25 hover:bg-accent dark:hover:bg-accent/40'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
      )}
      onClick={handleClick}
      data-testid="inbox-row"
      data-action-kind={actionKind ?? undefined}
    >
      <PriorityDot priority={notification.priority} />
      {fromPerson ? (
        <span
          className="flex size-5 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: humanColor(agentName) }}
        >
          <User className="size-3 text-zinc-700" />
        </span>
      ) : (
        <AgentAvatar name={agentName} size={20} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={cn('text-sm font-medium leading-snug', !notification.isRead && 'font-semibold')}>
            {notification.title}
          </span>
          {actionKind && <KindChip kind={actionKind} resolved={resolved} />}
          {notification.priority === 'high' && !actionKind && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium shrink-0">
              High
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {notification.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground">{senderLabel}</span>
          <span className="text-[10px] text-muted-foreground">{timeAgo(notification.createdAt)}</span>
          {notification.channelName && (actionable ? (
            <button
              type="button"
              className="text-[10px] text-foreground/70 flex items-center gap-0.5 hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onNavigate(notification); }}
            >
              <ArrowRight className="size-2.5" />
              {t('inbox.goToThread')}
            </button>
          ) : (
            <span className="text-[10px] text-foreground/70 flex items-center gap-0.5">
              <ArrowRight className="size-2.5" />
              {t('inbox.goToThread')}
            </span>
          ))}
          {notification.linkUrl && (
            <a
              href={notification.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-foreground/70 flex items-center gap-0.5 hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-2.5" />
              Link
            </a>
          )}
        </div>
      </div>
      {actionable && (
        <span className="p-1 text-muted-foreground shrink-0" title={expanded ? t('inbox.collapse') : t('inbox.expand')}>
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification.id);
        }}
        className="p-1 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground transition-colors shrink-0 opacity-0 group-hover:opacity-100"
        title={t('inbox.dismiss')}
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function ExpandedCard({
  notification,
  state,
  onResolved,
}: {
  notification: NotificationItem;
  state: ActionState;
  onResolved: (notification: NotificationItem, approval: ApprovalRequest) => void;
}) {
  const t = useT();
  const ref = notification.actionRef!;
  const card = state.cards[ref];
  if (card) {
    return (
      <div className="px-3 pb-3 pl-[52px]" onClick={(e) => e.stopPropagation()}>
        <ApprovalCard approval={card} onResolved={(a) => onResolved(notification, a)} />
      </div>
    );
  }
  if (state.failed[ref]) {
    return <p className="px-3 pb-3 pl-[52px] text-xs text-muted-foreground">{t('inbox.loadFailed')}</p>;
  }
  return (
    <div className="px-3 pb-3 pl-[52px] space-y-2" data-testid="inbox-card-skeleton">
      <Skeleton className="h-7 w-full max-w-xl rounded-md" />
      <Skeleton className="h-14 w-full max-w-xl rounded-md" />
    </div>
  );
}

function NotificationSection({
  title,
  items,
  onRead,
  onDismiss,
  onNavigate,
  expandedIds,
  onToggle,
  actionState,
  resolvedRefs,
  onResolved,
}: {
  title: string;
  items: NotificationItem[];
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (notification: NotificationItem) => void;
  expandedIds: Record<string, boolean>;
  onToggle: (notification: NotificationItem) => void;
  actionState: ActionState;
  resolvedRefs: ReadonlySet<string>;
  onResolved: (notification: NotificationItem, approval: ApprovalRequest) => void;
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
        {title} ({items.length})
      </h3>
      <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
        {items.map((n) => {
          const actionable = inboxActionKind(n) !== null;
          const expanded = actionable && Boolean(expandedIds[n.id]);
          return (
            <div key={n.id} className="group">
              <NotificationCard
                notification={n}
                onRead={onRead}
                onDismiss={onDismiss}
                onNavigate={onNavigate}
                expanded={expanded}
                onToggle={actionable ? onToggle : undefined}
                resolved={Boolean(n.actionRef && resolvedRefs.has(n.actionRef))}
              />
              {expanded && <ExpandedCard notification={n} state={actionState} onResolved={onResolved} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
    setCurrentSessionId,
    sessions,
    pendingApprovals,
    refreshApprovals,
  } = useWorkspace();
  const { setViewMode, setPendingTaskChannel } = useLayout();
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

  const handleNavigate = (notification: NotificationItem) => {
    if (!notification.isRead) {
      markNotificationRead(notification.id);
    }
    if (notification.channelName) {
      // Task threads are hidden from the Threads sidebar — landing there would
      // strand the user in a thread with no list context. Route to the Tasks
      // board instead and pop open that task's chat.
      if (notification.channelName.startsWith('task:')) {
        setPendingTaskChannel(notification.channelName);
        setViewMode('tasks');
        return;
      }
      const target = inboxSessionTarget(notification, (id) => sessions.some((s) => s.sessionId === id));
      if (target) {
        setCurrentSessionId(target);
        setViewMode('threads');
      }
    }
  };

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
    <div className="h-full flex flex-col">
      {/* Header — title in the app header, actions in its toolbar */}
      <DetailHeader
        title={<>
          <Inbox className="size-4 text-foreground" />
          <h2 className="text-sm font-semibold">{t('inbox.title')}</h2>
        </>}
      >
        <div className="flex items-center gap-0.5">
          {unreadNotificationCount > 0 && (
            <span className="mr-1 text-xs text-muted-foreground">
              {unreadNotificationCount} unread
            </span>
          )}
          {unreadNotificationCount > 0 && (
            <button
              onClick={markAllNotificationsRead}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
              title={t('inbox.markAllRead')}
            >
              <CheckCheck className="size-3.5" />
            </button>
          )}
          <button
            onClick={refreshNotifications}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title={t('common.refresh')}
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </DetailHeader>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Inbox className="size-8 opacity-30" />
            <p className="text-sm">{t('inbox.emptyTitle')}</p>
            <p className="text-xs opacity-60">{t('inbox.emptyBody')}</p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            <NotificationSection title={t('inbox.needsYou')} items={needsYou} {...sectionProps} />
            <NotificationSection title={t('inbox.updates')} items={updates} {...sectionProps} />
          </div>
        )}
      </div>
    </div>
  );
}
