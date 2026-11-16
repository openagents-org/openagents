'use client';

import { ArrowUpRight, CalendarDays, Play, Reply } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useFormatters, useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { IssueDetail, IssueStatus } from '@/lib/types';
import { ApprovalCard } from '@/components/chat/approval-card';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IssueAttachments } from './issue-attachments';
import { IssueAvatar, StatusIcon, authorName, statuses, statusKeys } from './issue-ui';

type IssueComment = IssueDetail['comments'][number];

export interface MentionLabels {
  agentNames: string[];
  agentLabels: Record<string, string>;
  humanNames: Record<string, string>;
}

/** Status / due-date / work-started lines between the comments. */
function ActivityEntry({ comment: c, name }: { comment: IssueComment; name: string }) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const status = c.content.split(' → ')[1] as IssueStatus;
  return (
    <article className="relative flex gap-3 text-xs">
      <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-background ring-4 ring-background">
        {c.kind === 'due_date' ? <CalendarDays className="size-3.5 text-muted-foreground" />
          : c.kind === 'status' ? <StatusIcon status={statuses.includes(status) ? status : 'open'} className="size-3.5" />
          : <Play className="size-3 text-muted-foreground" />}
      </span>
      <div className="min-w-0 flex-1 pt-1 leading-5 text-muted-foreground">
        <span className="font-medium text-foreground/75">{name}</span>{' '}
        {c.kind === 'status'
          ? t('issues.statusChanged', { status: t(statusKeys[status] ?? 'issues.open') })
          : c.kind === 'due_date' ? (c.content ? t('issues.dueDateSet', { date: c.content }) : t('issues.dueDateRemoved')) : t('issues.workStarted')}
        <span className="ml-2 text-xs whitespace-nowrap text-muted-foreground/70">{timeAgo(c.created_at)}</span>
        {c.kind === 'activity' && <p className="mt-1 text-xs leading-5 wrap-break-word text-muted-foreground">{c.content}</p>}
      </div>
    </article>
  );
}

interface IssueCommentsProps {
  issue: IssueDetail;
  busy: boolean;
  labels: MentionLabels;
  onApprovalResolved: () => void;
  /** Reply to an agent result: prefill the composer with its author. */
  onReply: (comment: IssueComment, name: string) => void;
}

/** The discussion timeline: comments, agent results and activity lines. */
export function IssueComments({ issue, busy, labels, onApprovalResolved, onReply }: IssueCommentsProps) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const { workspace, setCurrentSessionId } = useWorkspace();
  const { openView } = useLayout();
  const workspaceId = workspace?.slug || workspace?.workspaceId || '';

  return (
    <div className="relative flex flex-col gap-6 before:absolute before:top-3 before:bottom-4 before:left-3.5 before:w-px before:-translate-x-1/2 before:bg-border/60">
      {issue.comments.map((c) => {
        if (c.approval) return <ApprovalCard key={c.id} approval={c.approval} onResolved={onApprovalResolved} />;
        const name = c.author_name || authorName(c.author);
        if (c.kind === 'status' || c.kind === 'activity' || c.kind === 'due_date') return <ActivityEntry key={c.id} comment={c} name={name} />;
        const result = c.kind === 'result';
        const thread = c.reply_channel_name || c.channel_name;
        return (
          <article key={c.id} className="relative flex gap-3">
            <span className="z-10 h-fit rounded-full bg-background ring-4 ring-background">
              <IssueAvatar name={name} source={c.author} />
            </span>
            <div className={cn('min-w-0 flex-1', result && 'rounded-lg border border-border/60 bg-muted/20 px-4 py-3')}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{name}</span>
                {result && <Badge variant="outline">{t('issues.agentResult')}</Badge>}
                <time dateTime={c.created_at} className="text-xs text-muted-foreground">{timeAgo(c.created_at)}</time>
                {result && thread && (
                  <Button variant="ghost" size="xs" className="ml-auto shrink-0 text-muted-foreground"
                    onClick={() => { setCurrentSessionId(thread); openView('threads'); }}>
                    {t('issues.openInThread')}<ArrowUpRight data-icon="inline-end" />
                  </Button>
                )}
              </div>
              <div className="text-sm leading-6 text-foreground/85 [&_.markdown-content_p]:whitespace-pre-line">
                {c.content && <MarkdownContent content={c.content} {...labels} />}
              </div>
              {!!c.attachments?.length && <div className="mt-2">
                <IssueAttachments files={c.attachments} workspaceId={workspaceId} />
              </div>}
              {result && c.source_event_id && c.reply_channel_name && (
                <Button type="button" variant="ghost" size="xs" className="mt-2 text-muted-foreground"
                  disabled={busy || issue.status === 'closed'}
                  onClick={() => onReply(c, name)}>
                  <Reply data-icon="inline-start" />{t('issues.reply')}
                </Button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
