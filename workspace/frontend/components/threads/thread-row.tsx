'use client';

import { Bot, CheckCircle2, Hash, Lock, MessageSquare, Pin, Star, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { DmUnreadBadge } from '@/components/layout/dm-unread-badge';
import { Kbd } from '@/components/ui/kbd';
import type { WorkspaceAgent, WorkspaceSession } from '@/lib/types';
import { MENTION_ACCENT, ROW_BASE, ROW_IDLE, ROW_SELECTED, UNREAD_ACCENT } from './thread-list-utils';

function AvatarStack({ agents, session, max = 3 }: { agents: WorkspaceAgent[]; session: WorkspaceSession; max?: number }) {
  const t = useT();
  if (session.icon) return <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-lg" aria-label={t('threadSettings.icon')}>{session.icon}</span>;
  if ((session.humanCount || 0) > 1 || ((session.humanCount || 0) > 0 && agents.length > 0)) {
    return <span className="relative flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" title={t(agents.length ? 'threadSettings.peopleAndAgents' : 'threadSettings.groupThread')}>
      <Users className="size-4" />{agents.length > 0 && <Bot className="absolute -right-1 -bottom-1 size-3.5 rounded bg-background p-0.5 ring-1 ring-border" />}
    </span>;
  }
  const shown = agents.slice(0, max);
  const extra = agents.length - max;

  if (shown.length === 0) {
    return (
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
        <MessageSquare className="size-3.5 text-muted-foreground" />
      </div>
    );
  }

  if (shown.length === 1) {
    return <AgentAvatar name={shown[0].agentName} size={28} />;
  }

  return (
    <div className="flex shrink-0 *:not-first:-ml-1.5">
      {shown.map((agent) => (
        <div key={agent.agentName} className="rounded-full ring-2 ring-background">
          <AgentAvatar name={agent.agentName} size={18} />
        </div>
      ))}
      {extra > 0 && (
        <div className="flex size-4.5 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background">
          +{extra}
        </div>
      )}
    </div>
  );
}

// ── Unread markers ──

/** Slack's "@" badge: unread mentions of the viewer, in red like the nav counts. */
function MentionPill({ count }: { count: number }) {
  const t = useT();
  return (
    <span
      className={cn('inline-flex h-4 shrink-0 items-center gap-px rounded-full px-1.5 text-xs leading-none font-semibold tabular-nums', MENTION_ACCENT)}
      aria-label={t('slackSignals.mentionCount', { count })}
      title={t('slackSignals.mentionCount', { count })}
    >
      @{count > 1 ? <span>{count > 99 ? '99+' : count}</span> : null}
    </span>
  );
}

/** Unread DM-signal count on a DM row (the dot covers the timestamp rule). */
export function DmUnreadMarker({ count }: { count: number }) {
  const t = useT();
  return (
    <span
      className={cn('inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-1 text-xs leading-none font-semibold tabular-nums', UNREAD_ACCENT)}
      aria-label={t('slackSignals.dmUnreadCount', { count })}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** The left gutter dot for unread rows; a running thread pulses it. */
export function UnreadDot({ show, pulse }: { show: boolean; pulse?: boolean }) {
  const t = useT();
  return (
    <div className="flex w-2 shrink-0 justify-center pt-3">
      {show && <span className={cn('size-1.5 shrink-0 rounded-full bg-primary', pulse && 'animate-pulse')} aria-label={t('threads.unread')} />}
    </div>
  );
}

export function rowTimeClass(isUnread: boolean) {
  return cn('text-xs whitespace-nowrap tabular-nums', isUnread ? 'font-medium text-foreground/70' : 'text-muted-foreground/70');
}

// ── Thread row ──

interface ThreadRowProps {
  session: WorkspaceSession;
  agents: WorkspaceAgent[];
  isSelected: boolean;
  isUnread: boolean;
  unreadCount?: number;
  /** Unread @mentions of the viewer in this thread (Slack's "@" pill). */
  mentionCount?: number;
  isRunning: boolean;
  isCompleted: boolean;
  preview: React.ReactNode;
  previewIsStatus: boolean;
  displayTime: string;
  shortcutKey: number | null;
  title: React.ReactNode;
  muted?: boolean;
  onSelect: () => void;
  actions: React.ReactNode;
}

export function ThreadRow({
  session, agents, isSelected, isUnread, unreadCount = 0, mentionCount = 0, isRunning, isCompleted, preview, previewIsStatus,
  displayTime, shortcutKey, title, muted, onSelect, actions,
}: ThreadRowProps) {
  const t = useT();
  const participants = agents.filter((a) => session.participants.includes(a.agentName));

  return (
    <div
      role="listitem"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        ROW_BASE,
        isSelected ? ROW_SELECTED : ROW_IDLE,
        isRunning && 'thread-wip',
        // Completed thread — a light success glow. Selection styling wins
        // while the row is open.
        isCompleted && !isSelected &&
          'animate-[glow_2s_ease-in-out_infinite] rounded-md border-transparent bg-success/10 ring-1 ring-success/30 ring-inset',
        muted && 'opacity-60',
      )}
    >
      <UnreadDot show={isUnread} pulse={isRunning} />

      <div className="mt-0.5 shrink-0">
        <AvatarStack agents={participants} session={session} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Title row */}
        <div className="mb-0.5 flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {session.isChannel && <Hash className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('threads.channel')} />}
            {session.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label={t('threads.pinned')} />}
            {session.starred && <Star className="size-3 shrink-0 fill-warning text-warning" />}
            {/* v1.1 M1: private thread — only invited people see it */}
            {session.visibility === 'private' && (
              <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t('collab.lockTooltip')} />
            )}
            <span
              className={cn(
                'truncate text-sm leading-tight',
                isUnread ? 'font-semibold text-foreground' : isSelected ? 'font-medium text-foreground' : 'font-medium text-foreground/75',
              )}
            >
              {title}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {/* Sits beside the timestamp rather than replacing it — the time is
                what the user scans the list by. */}
            <DmUnreadBadge count={unreadCount} />
            {mentionCount > 0 && <MentionPill count={mentionCount} />}
            {isCompleted && !isSelected && (
              <CheckCircle2 className="size-3 shrink-0 text-success" aria-label={t('threads.finished')} />
            )}
            <span className={rowTimeClass(isUnread)}>{displayTime}</span>
            {shortcutKey && <Kbd>{shortcutKey}</Kbd>}
          </div>
        </div>

        {/* Preview */}
        <div className="grid">
          <p className={cn('truncate text-xs leading-snug text-muted-foreground', previewIsStatus && 'italic')}>
            {preview}
          </p>
        </div>
      </div>

      {/* Row actions. Always shown: a menu that appears only on hover was
          never found, and DM rows put theirs in this same slot. */}
      <div className="shrink-0 self-center">
        {actions}
      </div>
    </div>
  );
}
