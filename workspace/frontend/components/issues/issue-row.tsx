'use client';

import { Check, Link2, MessageSquare, Trash2 } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { agentLabel } from '@/lib/helpers';
import { cn } from '@/lib/utils';
import type { WorkspaceIssue } from '@/lib/types';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IssueLabel } from './issue-label';
import { IssueAvatar, StatusIcon, authorName, statusKeys, useIssueTime } from './issue-ui';

const preview = (description: string) =>
  description
    .split(/\n\s*\n/)[0]
    .replace(/[#*_`>]/g, '')
    .trim();

interface IssueRowProps {
  issue: WorkspaceIssue;
  /** Board column card instead of a list row. */
  asCard?: boolean;
  /** The issue open beside the list (split view). */
  isSelected: boolean;
  unread: number;
  copied: boolean;
  deleting: boolean;
  onSelect: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}

export function IssueRow({ issue, asCard = false, isSelected, unread, copied, deleting, onSelect, onCopyLink, onDelete }: IssueRowProps) {
  const { tasks = [], agents = [], activeSessionIds, completedSessionIds } = useWorkspace();
  const t = useT();
  const issueTime = useIssueTime();
  const workingAgents = agents.filter(agent => agent.status === 'online' && agent.busyChannels?.some(id => issue.linked_channels?.includes(id)));
  const working = workingAgents.length > 0 || issue.linked_channels?.some(id => activeSessionIds?.has(id));
  const finished = !working && issue.linked_channels?.some(id => completedSessionIds?.has(id));
  const needsInput = tasks.some(task => task.issueId === issue.id && task.status === 'need_input');
  const author = issue.created_by_name || authorName(issue.created_by);
  const time = (
    <time
      dateTime={issue.updated_at}
      title={t('issues.timestamps', { opened: issueTime.exact(issue.created_at), updated: issueTime.exact(issue.updated_at) })}
    >
      {issueTime.label(issue.updated_at)}
    </time>
  );

  // Row actions sit beside the issue button: buttons cannot nest.
  return <div className="relative">
    <button
      aria-label={`${issue.title} · ${t(statusKeys[issue.status])}`}
      aria-current={isSelected ? true : undefined}
      onClick={onSelect}
      className={cn(
        'group w-full text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
        asCard
          ? 'rounded-lg border border-border/70 bg-background p-4 shadow-xs hover:border-foreground/20'
          : 'flex items-start gap-3 px-5 py-4 hover:bg-muted/40 sm:px-8',
        isSelected && 'bg-accent ring-1 ring-foreground/20 ring-inset hover:bg-accent',
        working && !isSelected && 'thread-wip',
        finished && !isSelected && 'bg-success/10 ring-1 ring-success/30 ring-inset motion-safe:animate-[glow_2s_ease-in-out_infinite]',
      )}
    >
      <StatusIcon status={issue.status} className={cn('mt-0.5', asCard && 'hidden')} />
      <div className="min-w-0 flex-1">
        <div className={cn('flex gap-4', asCard ? 'items-start' : 'items-center')}>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1.5">
            {issue.number != null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{issue.number}</span>}
            <span className={cn('min-w-0 text-sm leading-5 font-medium text-foreground', asCard ? 'line-clamp-3' : 'truncate')}>
              {issue.title}
            </span>
            {!!unread && (
              <span
                aria-label={t('issues.unreadUpdates', { count: unread })}
                title={t('issues.unreadUpdates', { count: unread })}
                className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-xs font-medium text-destructive-foreground tabular-nums"
              >
                {unread > 99 ? '99+' : unread}
              </span>
            )}
            {!!issue.labels?.length && <span className="flex max-w-full flex-wrap gap-1.5">{issue.labels.map(label => <IssueLabel key={label} label={label} />)}</span>}
          </div>
          {!asCard && <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">{time}</span>}
        </div>
        {needsInput && <Badge variant="destructive" className="mt-1">{t('tasks.needsInput')}</Badge>}
        {(working || finished) && <span role="status" className="mt-1 flex w-fit items-center gap-1.5 text-xs text-muted-foreground">
          {working
            ? <span aria-hidden="true" className="inline-flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="typing-dot size-1 rounded-full bg-current" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
            : <Check aria-hidden="true" className="size-3 text-success" />}
          {workingAgents.length > 0 && <span className="inline-flex items-center *:not-first:-ml-1" aria-hidden="true">{workingAgents.map(agent => <AgentAvatar key={agent.agentName} name={agent.agentName} size={16} />)}</span>}
          {workingAgents.length ? t('issueWork.working', { agents: workingAgents.map(agentLabel).join(', ') }) : t(working ? 'chat.agentWorking' : 'issueWork.finished')}
        </span>}
        {issue.description && (
          <p className={cn('mt-1 text-xs leading-5 text-muted-foreground', asCard ? 'line-clamp-2' : 'truncate')}>
            {preview(issue.description)}
          </p>
        )}
        <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1.5 pr-14 text-xs text-muted-foreground', asCard ? 'mt-4' : 'mt-2')}>
          <IssueAvatar name={author} source={issue.created_by} size={18} />
          <span className="truncate">{author}</span>
          {issue.assignee && <span className="ml-2 inline-flex min-w-0 items-center gap-1.5" title={t('issues.assignee')}>
            <IssueAvatar name={issue.assignee_name || authorName(issue.assignee)} source={issue.assignee} size={18} />
            <span className="truncate">{t('issues.assignee')}: {issue.assignee_name || authorName(issue.assignee)}</span>
          </span>}
          {asCard && <span className="ml-auto shrink-0">{time}</span>}
          {!!issue.comment_count && (
            <span className={cn('inline-flex shrink-0 items-center gap-1', !asCard && 'ml-2')}>
              <MessageSquare className="size-3" />
              {issue.comment_count}
            </span>
          )}
        </div>
      </div>
    </button>
    <div className={cn('absolute bottom-3 flex items-center gap-1', asCard ? 'right-3' : 'right-4 sm:right-7')}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('issues.copyIssueLink', { title: issue.title })}
        title={t('issues.copyLink')}
        onClick={onCopyLink}
        className="text-muted-foreground"
      >
        {copied ? <Check /> : <Link2 />}
      </Button>
      {issue.can_delete && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('issues.deleteIssue', { title: issue.title })}
          title={t('common.delete')}
          disabled={deleting}
          onClick={onDelete}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 />
        </Button>
      )}
    </div>
  </div>;
}
