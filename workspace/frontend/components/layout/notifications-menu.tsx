'use client';

import { useMemo, useState } from 'react';
import { Bell, CheckCheck, RefreshCw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UnreadBadge } from '@/components/ui/unread-badge';
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty';
import { Button } from '@/components/ui/button';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { NotificationCard } from '@/components/inbox/inbox-view';
import { useOpenNotification } from '@/components/inbox/use-open-notification';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import type { NotificationItem } from '@/lib/types';
import { useT } from '@/lib/i18n';
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
  } = useWorkspace();
  const { openView } = useLayout();
  const t = useT();
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

  const openNotification = useOpenNotification();
  const handleNavigate = (notification: NotificationItem) => {
    openNotification(notification);
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
      <WithTooltip label={t('notifications.title')}><PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('notifications.title')}
              className="relative text-muted-foreground"
            >
              <Bell />
              {unreadNotificationCount > 0 && (
                <UnreadBadge count={unreadNotificationCount} size="corner" className="absolute -end-1 -top-1" />
              )}
            </Button>
          </PopoverTrigger></WithTooltip>

      <PopoverContent side={side} align={align} sideOffset={8} className="w-95 p-0">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t('notifications.title')}</span>
            {unreadNotificationCount > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('notifications.unreadCount', { count: unreadNotificationCount })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {unreadNotificationCount > 0 && (
              <WithTooltip label={t('notifications.markAllRead')}><Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    onClick={markAllNotificationsRead}
                    aria-label={t('notifications.markAllRead')}
                  >
                    <CheckCheck />
                  </Button></WithTooltip>
            )}
            <WithTooltip label={t('common.refresh')}><Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  onClick={refreshNotifications}
                  aria-label={t('common.refresh')}
                >
                  <RefreshCw />
                </Button></WithTooltip>
          </div>
        </div>

        {items.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyDescription>{t('notifications.allCaughtUp')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ScrollArea className="max-h-105">
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

        <div className="shrink-0 border-t border-border p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              openView('inbox');
              setOpen(false);
            }}
          >
            {t('notifications.viewAllInInbox')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
