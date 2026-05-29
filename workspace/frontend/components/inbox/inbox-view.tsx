'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { Inbox, CheckCheck, RefreshCw, X, ExternalLink, ArrowRight } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { InboxFilters } from './inbox-filters';
import {
  MOCK_INBOX_ITEMS,
  CATEGORY_ICONS,
  filterBySource,
  filterByPriority,
  getActionRequiredCount,
  type InboxItem,
  type InboxSourceFilter,
  type InboxPriorityFilter,
} from '@/lib/api-inbox';
import type { NotificationItem } from '@/lib/types';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function PriorityDot({ priority }: { priority: NotificationItem['priority'] }) {
  return (
    <span
      className={cn(
        'size-2 rounded-full shrink-0 mt-1.5',
        priority === 'high' && 'bg-red-500',
        priority === 'normal' && 'bg-blue-500',
        priority === 'low' && 'bg-zinc-400',
      )}
    />
  );
}

function NotificationCard({
  notification,
  onRead,
  onDismiss,
  onNavigate,
  inboxItem,
}: {
  notification: NotificationItem;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (notification: NotificationItem) => void;
  inboxItem?: InboxItem;
}) {
  const agentName = notification.createdBy.replace(/^(openagents:|system:)/, '');
  const categoryIcon = inboxItem ? CATEGORY_ICONS[inboxItem.category] : null;

  return (
    <div
      className={cn(
        'px-3 py-2.5 flex items-start gap-2.5 cursor-pointer transition-colors',
        !notification.isRead
          ? 'bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30'
          : 'hover:bg-muted/50',
      )}
      onClick={() => onNavigate(notification)}
    >
      <PriorityDot priority={notification.priority} />
      <AgentAvatar name={agentName} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {categoryIcon && <span className="text-xs">{categoryIcon}</span>}
          <span className={cn('text-sm font-medium leading-snug', !notification.isRead && 'font-semibold')}>
            {notification.title}
          </span>
          {notification.priority === 'high' && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium shrink-0">
              High
            </span>
          )}
          {inboxItem && (
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
              inboxItem.sourceType === 'task' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
              inboxItem.sourceType === 'routine' && 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
              inboxItem.sourceType === 'agent' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
              inboxItem.sourceType === 'system' && 'bg-muted text-muted-foreground',
            )}>
              {inboxItem.sourceType}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {notification.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground">{agentName}</span>
          <span className="text-[10px] text-muted-foreground">{timeAgo(notification.createdAt)}</span>
          {inboxItem?.sourceType === 'task' && inboxItem.sourceId && (
            <span className="text-[10px] text-primary flex items-center gap-0.5 font-medium">
              <ArrowRight className="size-2.5" />
              View Task
            </span>
          )}
          {inboxItem?.sourceType === 'routine' && inboxItem.sourceId && (
            <span className="text-[10px] text-primary flex items-center gap-0.5 font-medium">
              <ArrowRight className="size-2.5" />
              View Routine
            </span>
          )}
          {!inboxItem && notification.channelName && (
            <span className="text-[10px] text-blue-500 flex items-center gap-0.5">
              <ArrowRight className="size-2.5" />
              Go to thread
            </span>
          )}
          {notification.linkUrl && (
            <a
              href={notification.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-500 flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-2.5" />
              Link
            </a>
          )}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification.id);
        }}
        className="p-1 rounded-md hover:bg-muted text-muted-foreground transition-colors shrink-0 opacity-0 group-hover:opacity-100"
        title="Dismiss"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

function NotificationSection({
  title,
  items,
  onRead,
  onDismiss,
  onNavigate,
  inboxItemMap,
}: {
  title: string;
  items: NotificationItem[];
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (notification: NotificationItem) => void;
  inboxItemMap: Map<string, InboxItem>;
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
        {title} ({items.length})
      </h3>
      <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
        {items.map((n) => (
          <div key={n.id} className="group">
            <NotificationCard
              notification={n}
              onRead={onRead}
              onDismiss={onDismiss}
              onNavigate={onNavigate}
              inboxItem={inboxItemMap.get(n.title)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function MockInboxCard({ item }: { item: InboxItem }) {
  const categoryIcon = CATEGORY_ICONS[item.category];
  const agentName = item.agentName || 'system';

  return (
    <div
      className={cn(
        'px-3 py-2.5 flex items-start gap-2.5 transition-colors',
        !item.isRead
          ? 'bg-blue-50/50 dark:bg-blue-950/20'
          : 'hover:bg-muted/50',
      )}
    >
      <span
        className={cn(
          'size-2 rounded-full shrink-0 mt-1.5',
          item.priority === 'high' && 'bg-red-500',
          item.priority === 'normal' && 'bg-blue-500',
          item.priority === 'low' && 'bg-muted-foreground/40',
        )}
      />
      <AgentAvatar name={agentName} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{categoryIcon}</span>
          <span className={cn('text-sm font-medium leading-snug', !item.isRead && 'font-semibold')}>
            {item.title}
          </span>
          {item.priority === 'high' && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium shrink-0">
              High
            </span>
          )}
          <span className={cn(
            'text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
            item.sourceType === 'task' && 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
            item.sourceType === 'routine' && 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
            item.sourceType === 'agent' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
            item.sourceType === 'system' && 'bg-muted text-muted-foreground',
          )}>
            {item.sourceType}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {item.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground">{agentName}</span>
          <span className="text-[10px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
          {item.sourceType === 'task' && item.sourceId && (
            <span className="text-[10px] text-primary flex items-center gap-0.5 font-medium">
              <ArrowRight className="size-2.5" />
              View Task
            </span>
          )}
          {item.sourceType === 'routine' && item.sourceId && (
            <span className="text-[10px] text-primary flex items-center gap-0.5 font-medium">
              <ArrowRight className="size-2.5" />
              View Routine
            </span>
          )}
          {item.actionUrl && (
            <a
              href={item.actionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-500 flex items-center gap-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-2.5" />
              {item.actionLabel || 'Link'}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function MockInboxSection({
  sourceFilter,
  priorityFilter,
  onSourceFilterChange,
  onPriorityFilterChange,
}: {
  sourceFilter: InboxSourceFilter;
  priorityFilter: InboxPriorityFilter;
  onSourceFilterChange: (f: InboxSourceFilter) => void;
  onPriorityFilterChange: (f: InboxPriorityFilter) => void;
}) {
  const filtered = useMemo(() => {
    let items = MOCK_INBOX_ITEMS;
    items = filterBySource(items, sourceFilter);
    items = filterByPriority(items, priorityFilter);
    return items;
  }, [sourceFilter, priorityFilter]);

  const unread = useMemo(() => filtered.filter((i) => !i.isRead), [filtered]);
  const read = useMemo(() => filtered.filter((i) => i.isRead), [filtered]);

  return (
    <div className="p-4 space-y-4">
      <InboxFilters
        sourceFilter={sourceFilter}
        priorityFilter={priorityFilter}
        onSourceFilterChange={onSourceFilterChange}
        onPriorityFilterChange={onPriorityFilterChange}
      />

      {unread.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
            Unread ({unread.length})
          </h3>
          <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
            {unread.map((item) => (
              <div key={item.id} className="group">
                <MockInboxCard item={item} />
              </div>
            ))}
          </div>
        </div>
      )}

      {read.length > 0 && (
        <div>
          <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 px-1">
            Read ({read.length})
          </h3>
          <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
            {read.map((item) => (
              <div key={item.id} className="group">
                <MockInboxCard item={item} />
              </div>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <Inbox className="size-6 opacity-30" />
          <p className="text-xs">No items match current filters</p>
        </div>
      )}
    </div>
  );
}

export function InboxView() {
  const {
    notifications,
    unreadNotificationCount,
    refreshNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification,
    setCurrentSessionId,
    sessions,
  } = useWorkspace();
  const { setViewMode } = useLayout();
  const [sourceFilter, setSourceFilter] = useState<InboxSourceFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<InboxPriorityFilter>('all');

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  // Build inbox item lookup by title for matching with notifications
  const inboxItemMap = useMemo(() => {
    const map = new Map<string, InboxItem>();
    for (const item of MOCK_INBOX_ITEMS) {
      map.set(item.title, item);
    }
    return map;
  }, []);

  // Calculate action required count
  const actionRequiredCount = useMemo(() => getActionRequiredCount(MOCK_INBOX_ITEMS), []);

  const { unread, read } = useMemo(() => {
    // Apply filters to notifications based on matched inbox items
    let filteredNotifications = notifications;

    if (sourceFilter !== 'all') {
      filteredNotifications = filteredNotifications.filter((n) => {
        const inboxItem = inboxItemMap.get(n.title);
        return inboxItem?.sourceType === sourceFilter;
      });
    }

    if (priorityFilter !== 'all') {
      filteredNotifications = filteredNotifications.filter((n) => n.priority === priorityFilter);
    }

    const u = filteredNotifications
      .filter((n) => !n.isRead)
      .sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
    const r = filteredNotifications
      .filter((n) => n.isRead)
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
    return { unread: u, read: r };
  }, [notifications, sourceFilter, priorityFilter, inboxItemMap]);

  const handleNavigate = (notification: NotificationItem) => {
    if (!notification.isRead) {
      markNotificationRead(notification.id);
    }
    if (notification.channelName) {
      const session = sessions.find((s) => s.sessionId === notification.channelName);
      if (session) {
        setCurrentSessionId(notification.channelName);
        setViewMode('threads');
      }
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="size-4 text-blue-500" />
          <h2 className="text-sm font-semibold">Inbox</h2>
          {(unreadNotificationCount > 0 || actionRequiredCount > 0) && (
            <span className="text-xs text-muted-foreground">
              {unreadNotificationCount > 0 && `${unreadNotificationCount} unread`}
              {unreadNotificationCount > 0 && actionRequiredCount > 0 && ' · '}
              {actionRequiredCount > 0 && `${actionRequiredCount} action required`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {unreadNotificationCount > 0 && (
            <button
              onClick={markAllNotificationsRead}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
              title="Mark all as read"
            >
              <CheckCheck className="size-3.5" />
            </button>
          )}
          <button
            onClick={refreshNotifications}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          /* Show mock inbox items when no real notifications exist */
          <MockInboxSection
            sourceFilter={sourceFilter}
            priorityFilter={priorityFilter}
            onSourceFilterChange={setSourceFilter}
            onPriorityFilterChange={setPriorityFilter}
          />
        ) : (
          <div className="p-4 space-y-4">
            {/* Filters */}
            <InboxFilters
              sourceFilter={sourceFilter}
              priorityFilter={priorityFilter}
              onSourceFilterChange={setSourceFilter}
              onPriorityFilterChange={setPriorityFilter}
            />

            <NotificationSection
              title="Unread"
              items={unread}
              onRead={markNotificationRead}
              onDismiss={dismissNotification}
              onNavigate={handleNavigate}
              inboxItemMap={inboxItemMap}
            />
            <NotificationSection
              title="Read"
              items={read}
              onRead={markNotificationRead}
              onDismiss={dismissNotification}
              onNavigate={handleNavigate}
              inboxItemMap={inboxItemMap}
            />
          </div>
        )}
      </div>
    </div>
  );
}
