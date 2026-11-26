'use client';

import { ArrowRight, ChevronDown, ChevronUp, Clock, ExternalLink, User, X } from 'lucide-react';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Item, ItemActions, ItemContent, ItemMedia } from '@/components/ui/item';
import { WithTooltip } from '@/components/ui/with-tooltip';
import { useHumanNames } from '@/hooks/use-team-roster';
import { agentLabel } from '@/lib/helpers';
import { humanColor } from '@/lib/human-color';
import { isGuestAddress } from '@/lib/guest-sender';
import { useFormatters, useT } from '@/lib/i18n';
import { inboxActionKind } from '@/lib/inbox';
import type { NotificationItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';

/** Unread marker in the app-wide unread red (high priority is flagged by its
 *  own badge). Once read it is hidden but keeps its slot, so the avatar column
 *  does not shift. */
function UnreadDot({ unread }: { unread: boolean }) {
  return (
    <span
      aria-hidden
      data-testid="inbox-unread-dot"
      className={cn('mt-1.5 size-2 shrink-0 rounded-full bg-destructive', !unread && 'invisible')}
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

/** A guest's request in a shared thread, waiting for the owner (OpenAgents Share). */
function ShareRequestMark() {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-warning/15 text-warning" data-share-request-mark="">
      <Clock className="size-3" />
    </span>
  );
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
    // A shared-thread guest's address is an internal handle, not a name.
    : isGuestAddress(agentName) ? t('chat.guestBadge')
    : (fromPerson ? (humanNames[agentName.toLowerCase()] ?? agentName) : agentName);
  resolved = resolved || Boolean(notification.approvalStatus && notification.approvalStatus !== 'pending');
  const actionKind = inboxActionKind(notification);
  // OpenAgents Share: a guest waits for the owner's approval; the row opens the thread.
  const shareRequest = notification.kind === 'share_request';
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
    <Item
      className={cn(
        'relative flex-nowrap items-start rounded-none',
        !notification.isRead ? 'bg-accent/50 hover:bg-accent' : 'hover:bg-muted/50',
      )}
      data-testid="inbox-row"
      data-action-kind={actionKind ?? undefined}
    >
      <UnreadDot unread={!notification.isRead} />
      <ItemMedia>
        {shareRequest ? <ShareRequestMark /> : <SenderMark fromPerson={fromPerson} name={agentName} />}
      </ItemMedia>
      <ItemContent className="min-w-0 gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* The row's one click target: its ::after covers the whole row, and
              the links and buttons below sit above it (relative z-10), so no
              interactive element is nested inside another. */}
          <button
            type="button"
            onClick={handleClick}
            aria-expanded={actionable ? expanded : undefined}
            className={cn(
              'cursor-pointer text-left text-sm leading-snug font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset',
              !notification.isRead && 'font-semibold',
            )}
          >
            {notification.title}
          </button>
          {actionKind && <KindChip resolved={resolved} />}
          {shareRequest && !actionKind && <Badge variant="warning" className="shrink-0">{t('inbox.chipGuestRequest')}</Badge>}
          {notification.priority === 'high' && !actionKind && (
            <Badge variant="destructive" className="shrink-0">{t('inbox.priorityHigh')}</Badge>
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
          <span>{shareRequest ? t('inbox.guestRequestSource') : senderLabel}</span>
          <span>{timeAgo(notification.createdAt)}</span>
          {notification.channelName && (actionable ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              className="relative z-10 h-auto gap-0.5 px-0 text-foreground/70 hover:text-foreground"
              onClick={() => onNavigate(notification)}
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
            <Button
              variant="link"
              size="xs"
              asChild
              className="relative z-10 h-auto gap-0.5 px-0 text-foreground/70 hover:text-foreground"
            >
              <a href={notification.linkUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink data-icon="inline-start" />
                {t('inbox.link')}
              </a>
            </Button>
          )}
        </div>
      </ItemContent>
      <ItemActions className="gap-1">
        {actionable && (
          <span aria-hidden className="shrink-0 p-1 text-muted-foreground">
            {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
        )}
        <WithTooltip label={t('inbox.dismiss')}>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onDismiss(notification.id)}
            className="relative z-10 shrink-0 text-muted-foreground opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            aria-label={t('inbox.dismiss')}
          >
            <X />
          </Button>
        </WithTooltip>
      </ItemActions>
    </Item>
  );
}
