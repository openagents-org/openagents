'use client';

import { ArrowRight, ChevronDown, ChevronUp, ExternalLink, User, X } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useHumanNames } from '@/hooks/use-team-roster';
import { agentLabel } from '@/lib/helpers';
import { humanColor } from '@/lib/human-color';
import { useFormatters, useT } from '@/lib/i18n';
import { inboxActionKind } from '@/lib/inbox';
import type { NotificationItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';

/** Unread marker: red for high priority, the primary ink otherwise. Once read it is
 *  hidden but keeps its slot, so the avatar column does not shift. */
function UnreadDot({ unread, priority }: { unread: boolean; priority: NotificationItem['priority'] }) {
  return (
    <span
      aria-hidden
      data-testid="inbox-unread-dot"
      className={cn(
        'mt-1.5 size-2 shrink-0 rounded-full',
        !unread ? 'invisible' : priority === 'high' ? 'bg-destructive' : 'bg-primary',
      )}
    />
  );
}

/** What the row is asking of the reader — or that it is done. */
function KindChip({ resolved }: { resolved: boolean }) {
  const t = useT();
  if (resolved) {
    return <Badge variant="secondary" className="shrink-0">{t('inbox.chipDone')}</Badge>;
  }
  return <Badge variant="warning" className="shrink-0">{t('inbox.chipApproval')}</Badge>;
}

/** Who sent the row: a person's colour chip, or the agent's avatar. */
function SenderMark({ fromPerson, name }: { fromPerson: boolean; name: string }) {
  if (!fromPerson) return <AgentAvatar name={name} size={20} />;
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: humanColor(name) }}
    >
      <User className="size-3 text-foreground" />
    </span>
  );
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
  const { agents, sessions } = useWorkspace();
  const sourceThread = sessions.find(session => session.sessionId === notification.channelName);
  const humanNames = useHumanNames();
  const fromPerson = notification.createdBy.startsWith('human:');
  const agentName = notification.createdBy.replace(/^(openagents:|system:|human:)/, '');
  const senderAgent = agents.find((a) => a.agentName === agentName);
  const senderLabel = senderAgent
    ? agentLabel(senderAgent)
    : (fromPerson ? (humanNames[agentName.toLowerCase()] ?? agentName) : agentName);
  resolved = resolved || Boolean(notification.approvalStatus && notification.approvalStatus !== 'pending');
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
        'flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors',
        !notification.isRead ? 'bg-accent/50 hover:bg-accent' : 'hover:bg-muted/50',
      )}
      onClick={handleClick}
      data-testid="inbox-row"
      data-action-kind={actionKind ?? undefined}
    >
      <UnreadDot unread={!notification.isRead} priority={notification.priority} />
      <SenderMark fromPerson={fromPerson} name={agentName} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={cn('text-sm leading-snug font-medium', !notification.isRead && 'font-semibold')}>
            {notification.title}
          </span>
          {actionKind && <KindChip resolved={resolved} />}
          {notification.priority === 'high' && !actionKind && (
            <Badge variant="destructive" className="shrink-0">High</Badge>
          )}
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {resolved && notification.approvalStatus ? t('notifications.resolvedRequest') : notification.message}
        </p>
        {sourceThread && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={sourceThread.title}>
            {t('inbox.sourceThread', { title: sourceThread.title })}
          </p>
        )}
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{senderLabel}</span>
          <span>{timeAgo(notification.createdAt)}</span>
          {notification.channelName && (actionable ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="h-auto gap-0.5 px-0 text-foreground/70 hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onNavigate(notification); }}
            >
              <ArrowRight data-icon="inline-start" />
              {t('inbox.goToThread')}
            </Button>
          ) : (
            <span className="flex items-center gap-0.5 text-foreground/70">
              <ArrowRight className="size-3" />
              {t('inbox.goToThread')}
            </span>
          ))}
          {notification.linkUrl && (
            <a
              href={notification.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 text-foreground/70 hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3" />
              Link
            </a>
          )}
        </div>
      </div>
      {actionable && (
        <span className="shrink-0 p-1 text-muted-foreground" title={expanded ? t('inbox.collapse') : t('inbox.expand')}>
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(notification.id);
        }}
        className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        title={t('inbox.dismiss')}
        aria-label={t('inbox.dismiss')}
      >
        <X />
      </Button>
    </div>
  );
}
