'use client';

import { useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Inbox, CheckCheck, RefreshCw, X, ExternalLink, ArrowRight } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { AgentAvatar } from '@/components/agents/agent-avatar';
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
}: {
  notification: NotificationItem;
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (notification: NotificationItem) => void;
}) {
  const agentName = notification.createdBy.replace(/^(openagents:|system:)/, '');

  return (
    <div
      className={cn(
        'px-3 py-2.5 flex items-start gap-2.5 cursor-pointer transition-colors',
        !notification.isRead
          ? 'bg-blue-50/50 dark:bg-blue-950/20 hover:bg-blue-50 dark:hover:bg-blue-950/30'
          : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
      )}
      onClick={() => onNavigate(notification)}
    >
      <PriorityDot priority={notification.priority} />
      <AgentAvatar name={agentName} size={20} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('text-sm font-medium leading-snug', !notification.isRead && 'font-semibold')}>
            {notification.title}
          </span>
          {notification.priority === 'high' && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-medium shrink-0">
              High
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {notification.message}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground">{agentName}</span>
          <span className="text-[10px] text-muted-foreground">{timeAgo(notification.createdAt)}</span>
          {notification.channelName && (
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
        className="p-1 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 text-muted-foreground transition-colors shrink-0 opacity-0 group-hover:opacity-100"
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
}: {
  title: string;
  items: NotificationItem[];
  onRead: (id: string) => void;
  onDismiss: (id: string) => void;
  onNavigate: (notification: NotificationItem) => void;
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
            />
          </div>
        ))}
      </div>
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
  } = useWorkspace();
  const { isMobile, setViewMode, openMobileDetail } = useLayout();

  useEffect(() => {
    refreshNotifications();
  }, [refreshNotifications]);

  const { unread, read } = useMemo(() => {
    const u = notifications
      .filter((n) => !n.isRead)
      .sort((a, b) => {
        const priorityOrder = { high: 0, normal: 1, low: 2 };
        const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (pDiff !== 0) return pDiff;
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
    const r = notifications
      .filter((n) => n.isRead)
      .sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
    return { unread: u, read: r };
  }, [notifications]);

  const handleNavigate = (notification: NotificationItem) => {
    if (!notification.isRead) {
      markNotificationRead(notification.id);
    }
    if (notification.channelName) {
      setCurrentSessionId(notification.channelName);
      setViewMode('threads');
      if (isMobile) openMobileDetail();
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Inbox className="size-4 text-blue-500" />
          <h2 className="text-sm font-semibold">Inbox</h2>
          {unreadNotificationCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {unreadNotificationCount} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {unreadNotificationCount > 0 && (
            <button
              onClick={markAllNotificationsRead}
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
              title="Mark all as read"
            >
              <CheckCheck className="size-3.5" />
            </button>
          )}
          <button
            onClick={refreshNotifications}
            className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Inbox className="size-8 opacity-30" />
            <p className="text-sm">No notifications yet</p>
            <p className="text-xs opacity-60">Agent notifications will appear here</p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            <NotificationSection
              title="Unread"
              items={unread}
              onRead={markNotificationRead}
              onDismiss={dismissNotification}
              onNavigate={handleNavigate}
            />
            <NotificationSection
              title="Read"
              items={read}
              onRead={markNotificationRead}
              onDismiss={dismissNotification}
              onNavigate={handleNavigate}
            />
          </div>
        )}
      </div>
    </div>
  );
}
