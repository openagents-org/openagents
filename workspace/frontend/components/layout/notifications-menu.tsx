'use client';

import { useMemo, useState } from 'react';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NotificationCard } from '@/components/inbox/inbox-view';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import type { NotificationItem } from '@/lib/types';
import { useLayout } from './layout-context';

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 } as const;

interface NotificationsMenuProps {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export function NotificationsMenu({ side, align = 'end' }: NotificationsMenuProps = {}) {
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
  const { openView } = useLayout();
  const [open, setOpen] = useState(false);

  // Unread first (by priority, then recency), then the most recent read ones.
  const items = useMemo(() => {
    const byTime = (a: NotificationItem, b: NotificationItem) =>
      (b.createdAt ? new Date(b.createdAt).getTime() : 0) -
      (a.createdAt ? new Date(a.createdAt).getTime() : 0);

    const unread = notifications
      .filter((n) => !n.isRead)
      .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || byTime(a, b));
    const read = notifications.filter((n) => n.isRead).sort(byTime);

    return [...unread, ...read].slice(0, 12);
  }, [notifications]);

  const handleNavigate = (notification: NotificationItem) => {
    if (!notification.isRead) markNotificationRead(notification.id);
    if (notification.channelName && sessions.some((s) => s.sessionId === notification.channelName)) {
      setCurrentSessionId(notification.channelName);
      openView('threads');
    }
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) refreshNotifications();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Notifications"
          className="relative flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Bell className="size-4" />
          {unreadNotificationCount > 0 && (
            <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-destructive-foreground tabular-nums">
              {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent side={side} align={align} sideOffset={8} className="w-[380px] p-0">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unreadNotificationCount > 0 && (
              <span className="text-xs text-muted-foreground">{unreadNotificationCount} unread</span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {unreadNotificationCount > 0 && (
              <button
                onClick={markAllNotificationsRead}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                title="Mark all as read"
              >
                <CheckCheck className="size-3.5" />
              </button>
            )}
            <button
              onClick={refreshNotifications}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
              title="Refresh"
            >
              <RefreshCw className="size-3.5" />
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up</div>
        ) : (
          <ScrollArea className="max-h-[420px]">
            <div className="divide-y divide-border">
              {items.map((n) => (
                <div key={n.id} className={cn('group', !n.isRead && 'bg-accent/50 dark:bg-accent/20')}>
                  <NotificationCard
                    notification={n}
                    onRead={markNotificationRead}
                    onDismiss={dismissNotification}
                    onNavigate={handleNavigate}
                  />
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        <button
          onClick={() => {
            openView('inbox');
            setOpen(false);
          }}
          className="w-full shrink-0 border-t border-border px-3 py-2 text-center text-xs font-medium text-primary transition-colors hover:bg-muted"
        >
          View all in Inbox
        </button>
      </PopoverContent>
    </Popover>
  );
}
