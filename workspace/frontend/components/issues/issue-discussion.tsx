'use client';

import { IssueWork } from './issue-work';
import { IssueAgentProgress } from './issue-agent-progress';
import { IssueAttachments } from './issue-attachments';
import { resourcePath } from '@/lib/resource-link';
import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, MessageSquare } from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { useWorkspace } from '@/lib/workspace-context';
import { useT } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { cn } from '@/lib/utils';
import { IssueEditor } from './issue-editor';
import { useIssueMentions } from './use-issue-mentions';
import { sidebarAgents } from '@/lib/sidebar-agents';
import { IssueComments } from './issue-comments';
import { IssueCommentForm, type CommentDraft } from './issue-comment-form';
import { IssueDetailHeader } from './issue-detail-header';
import { useIssueDetail } from './use-issue-detail';
import { ErrorNotice, IssueSkeleton } from './issue-ui';

function EmbeddedHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode; titleInHeader?: boolean }) {
  return <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-5">
    <div className="min-w-0">{title}</div>
    {children}
  </div>;
}

export function IssueDiscussion({
  id,
  onBack,
  onChanged,
  embedded = false,
}: {
  embedded?: boolean;
  id: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const Header = embedded ? EmbeddedHeader : DetailHeader;
  const t = useT();
  const { currentUser, refreshAgents, workspace, agents } = useWorkspace();
  const { issue, error, setError, loadError, busy, busyRef, refresh, mutate, removeIssue } = useIssueDetail(id, { onBack, onChanged });
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<{ eventId: string; name: string } | null>(null);
  const [commentFiles, setCommentFiles] = useState<string[]>([]);
  const [commentUploading, setCommentUploading] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  useEffect(() => { setReplyTo(null); setComment(''); setCommentFiles([]); setPickerKey(k => k + 1); }, [id]);
  const [edit, setEdit] = useState(false);
  const source = `human:${currentUser.id}`;
  const identity = { source, source_name: currentUser.name };
  const workspaceId = workspace?.slug || workspace?.workspaceId || '';

  const workingIn = (channel: string) => agents.filter(agent => agent.status === 'online' && agent.busyChannels?.includes(channel));
  const people = new Map((issue?.participants || []).map((p) => [p.source, p.name]));
  // Agents the viewer may ask for work; mentioning one not yet on the issue
  // adds it before the comment is posted.
  const usableAgents = new Set(sidebarAgents(agents ?? [], currentUser.id).filter(a => !a.builtin).map(a => `openagents:${a.agentName}`));
  const mentions = useIssueMentions(issue);
  const participantNames = new Map(mentions.map(person => [person.source.toLowerCase(), person.name]));
  const labels = {
    agentNames: mentions.filter((m) => m.kind === 'agent').map((m) => m.token),
    agentLabels: Object.fromEntries(mentions.filter((m) => m.kind === 'agent').map((m) => [m.token, m.name])),
    humanNames: Object.fromEntries(mentions.filter((m) => m.kind === 'human').map((m) => [m.token, m.name])),
  };
  const draft: CommentDraft = {
    comment, setComment, replyTo, setReplyTo,
    files: commentFiles, setFiles: setCommentFiles,
    uploading: commentUploading, setUploading: setCommentUploading,
    pickerKey, resetPicker: () => setPickerKey(k => k + 1),
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <Header
        titleInHeader
        title={
          <Breadcrumb>
            <BreadcrumbList className="flex-nowrap text-xs">
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <button type="button" onClick={onBack} className="flex items-center gap-1.5 font-medium">
                    <ArrowLeft className="size-3.5" />
                    {t('views.issues')}
                  </button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate font-normal text-muted-foreground">{t('issues.discussion')}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(error || loadError) && (
          <div className="mx-auto max-w-6xl px-5 pt-5 sm:px-8">
            <ErrorNotice
              message={error || loadError}
              retry={() => {
                setError('');
                void refresh();
              }}
            />
          </div>
        )}
        {!issue ? (
          !loadError && (
            <div className="mx-auto max-w-5xl px-8">
              <span className="sr-only">{t('common.loading')}</span>
              <IssueSkeleton detail />
            </div>
          )
        ) : (
          <div className="mx-auto min-h-full max-w-5xl">
            <main className={cn('min-w-0 px-5 pt-7 pb-12', !embedded && 'sm:px-9 sm:pt-9 lg:px-10')}>
              <IssueDetailHeader
                id={id}
                issue={issue}
                busy={busy}
                mutate={mutate}
                identity={identity}
                people={people}
                participantNames={participantNames}
                onParticipantsAdded={() => { void refresh(); onChanged(); }}
                onEdit={() => setEdit(true)}
                onDelete={() => void removeIssue()}
                onError={setError}
              />
              {/* Issue text is typed in a plain textarea, where Enter means a new
                  line; Markdown would fold a single newline into a space. Only
                  paragraphs keep them, so lists and code blocks are untouched. */}
              <article className="mb-10 min-w-0 text-sm leading-7 wrap-anywhere text-foreground/85 [&_.markdown-content_p]:whitespace-pre-line [&_.markdown-content>*:first-child]:mt-0 [&_.markdown-content>p]:leading-7 [&_.markdown-content>ul]:leading-7">
                {issue.description
                  ? <MarkdownContent content={issue.description} {...labels} />
                  : <p className="text-muted-foreground">{t('issues.noDescription')}</p>}
              </article>
              {((issue.attachments?.length ?? 0) > 0 || (issue.knowledge?.length ?? 0) > 0) && (
                <div className="mb-8 flex flex-wrap gap-2">
                  <IssueAttachments files={issue.attachments || []} workspaceId={workspaceId} />
                  {issue.knowledge?.map(entry => (
                    <Button key={entry.id} asChild variant="outline" size="sm" className="max-w-full">
                      <a href={resourcePath(workspaceId, 'knowledge', entry.id)}>
                        <BookOpen data-icon="inline-start" />
                        <span className="truncate">{entry.title}</span>
                      </a>
                    </Button>
                  ))}
                </div>
              )}
              <IssueWork key={id} issueId={id} closed={issue.status === 'closed'} onPosted={warning => { setError(warning || ''); void refresh(); void refreshAgents(); onChanged(); }} />
              <section aria-label={t('issues.discussion')}>
                <div className="mb-6 flex items-center gap-2 border-b border-border/70 pb-3">
                  <MessageSquare className="size-3.5 text-muted-foreground" />
                  <h2 className="text-xs font-semibold">{t('issues.discussion')}</h2>
                  <Badge variant="secondary" className="tabular-nums">{issue.comments.filter((c) => c.kind !== 'status').length}</Badge>
                </div>
                {issue.comments.length === 0 && (
                  <p className="mb-7 text-sm leading-6 text-muted-foreground">{t('issues.noComments')}</p>
                )}
                <IssueComments
                  issue={issue}
                  busy={busy}
                  labels={labels}
                  onApprovalResolved={() => void refresh()}
                  onReply={(c, name) => {
                    setReplyTo({ eventId: c.source_event_id!, name });
                    const mention = `@${c.author.replace(/^openagents:/, '')}`;
                    setComment(value => value.startsWith(`${mention} `) || value === mention ? value : `${mention} ${value}`);
                    requestAnimationFrame(() => {
                      const input = document.getElementById(`issue-comment-${id}`);
                      input?.focus();
                      input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    });
                  }}
                />
                {issue.threads.map(thread => {
                  const working = workingIn(thread.channel_name);
                  return working.length ? <IssueAgentProgress key={thread.channel_name} thread={thread} agents={working} /> : null;
                })}
                <IssueCommentForm
                  id={id}
                  busy={busy}
                  busyRef={busyRef}
                  mutate={mutate}
                  identity={identity}
                  userName={currentUser.name}
                  people={people}
                  usableAgents={usableAgents}
                  mentions={mentions}
                  draft={draft}
                  onDispatchError={setError}
                />
              </section>
            </main>
          </div>
        )}
      </div>
      {issue && (
        <IssueEditor
          open={edit}
          onOpenChange={setEdit}
          issue={issue}
          onSaved={() => {
            setEdit(false);
            void refresh();
            onChanged();
          }}
        />
      )}
    </div>
  );
}
