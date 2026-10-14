'use client';

import { IssueWork } from './issue-work';
import { resourcePath } from '@/lib/resource-link';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Link2,
  MessageSquare,
  X,
  Play,
  Pencil,
  PanelRight,
  Send,
  ChevronDown,
} from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { useT, useFormatters } from '@/lib/i18n';
import type { IssueDetail, IssueReply, IssueStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/responsive-dialog';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { TaskChatPopup } from '@/components/tasks/task-chat-popup';
import { cn } from '@/lib/utils';
import { AddIssueParticipants } from './add-issue-participants';
import { IssueProperties } from './issue-properties';
import { ApprovalCard } from '@/components/chat/approval-card';
import { IssueEditor } from './issue-editor';
import { IssueMentionInput } from './issue-mention-input';
import { useIssueMentions } from './use-issue-mentions';
import {
  ErrorNotice,
  StatusBadge,
  StatusIcon,
  IssueAvatar,
  IssueSkeleton,
  errorMessage,
  authorName,
  statuses,
  statusKeys,
  selectClass,
} from './issue-ui';

export function IssueDiscussion({
  id,
  onBack,
  onChanged,
}: {
  id: string;
  onBack: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
  const { currentUser, sessions, refreshAgents } = useWorkspace();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [thread, setThread] = useState('');
  const [chat, setChat] = useState<{ channel: string; title: string } | null>(
    null,
  );
  const version = useRef(0);
  const mounted = useRef(true);
  const busyRef = useRef(false);
  const source = `human:${currentUser.id}`;
  const identity = { source, source_name: currentUser.name };
  const refresh = useCallback(async () => {
    const request = ++version.current;
    try {
      const result = await workspaceApi.getIssue(id);
      if (mounted.current && request === version.current) {
        setIssue(result);
        setLoadError('');
      }
    } catch (e) {
      if (mounted.current && request === version.current)
        setLoadError(errorMessage(e));
    }
  }, [id]);
  useEffect(() => {
    mounted.current = true;
    const load = () => {
      if (!busyRef.current) void refresh();
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      mounted.current = false;
      ++version.current;
      clearInterval(interval);
    };
  }, [refresh]);

  async function mutate(work: () => Promise<unknown>, onSuccess?: () => void) {
    if (busyRef.current) return;
    busyRef.current = true;
    ++version.current;
    setBusy(true);
    setError('');
    try {
      await work();
      if (mounted.current) {
        onSuccess?.();
        onChanged();
      }
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      // Also refresh after a partial failure, so a created thread stays visible.
      if (mounted.current) await refresh();
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function submitAction(e: React.FormEvent) {
    e.preventDefault();
    await mutate(
      async () => {
        await workspaceApi.linkIssueThread(id, thread);
      },
      () => {
        setActionOpen(false);
        setThread('');
      },
    );
  }

  const people = new Map((issue?.participants || []).map((p) => [p.source, p.name]));
  const mentions = useIssueMentions(issue);
  const agentNames = mentions
    .filter((m) => m.kind === 'agent')
    .map((m) => m.token);
  const agentLabels = Object.fromEntries(
    mentions.filter((m) => m.kind === 'agent').map((m) => [m.token, m.name]),
  );
  const humanNames = Object.fromEntries(
    mentions.filter((m) => m.kind === 'human').map((m) => [m.token, m.name]),
  );
  const share = (reply: IssueReply | null | undefined) => {
    if (!reply) return null;
    const shared = issue?.comments.some((c) => c.source_event_id === reply.id);
    return (
      <details className="group/reply mt-2 pl-6">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3 transition-transform group-open/reply:rotate-90" />
          {t('issues.latestReply')}
          {shared && <Check className="ml-auto size-3" />}
        </summary>
        <p className="mt-2 line-clamp-4 text-xs leading-5 text-muted-foreground">
          {reply.content}
        </p>
        <Button
          className="mt-2 h-auto px-0 py-1 text-[11px]"
          size="sm"
          variant="ghost"
          disabled={busy || shared}
          onClick={() =>
            mutate(() =>
              workspaceApi.commentOnIssue(id, {
                ...identity,
                source_event_id: reply.id,
              }),
            )
          }
        >
          {shared ? (
            <Check className="size-3" />
          ) : (
            <ArrowUpRight className="size-3" />
          )}
          {t(shared ? 'issues.shared' : 'issues.shareResult')}
        </Button>
      </details>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DetailHeader
        titleInHeader
        title={
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 font-medium text-foreground/80 hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              {t('views.issues')}
            </button>
            <ChevronRight className="size-3 text-muted-foreground/50" />
            <span className="truncate text-muted-foreground">
              {t('issues.discussion')}
            </span>
          </div>
        }
      >
        <Button
          className="lg:hidden"
          variant="ghost"
          size="sm"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen((v) => !v)}
        >
          <PanelRight />
          {t('issues.details')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t(copied ? 'common.copied' : 'issues.copyLink')}
          title={t(copied ? 'common.copied' : 'issues.copyLink')}
          onClick={async () => {
            try {
              const url = new URL(
                window.location.pathname,
                window.location.origin,
              );
              url.pathname = resourcePath(decodeURIComponent(url.pathname.split('/')[1]), 'issues', id);
              await navigator.clipboard.writeText(url.toString());
              setCopied(true);
            } catch (e) {
              setError(errorMessage(e));
            }
          }}
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Link2 className="size-3.5" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!issue}
          onClick={() => setEdit(true)}
        >
          <Pencil className="size-3.5" />
          {t('common.edit')}
        </Button>
      </DetailHeader>
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
          <div className="mx-auto grid min-h-full max-w-[1200px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_264px]">
            <main className="min-w-0 px-5 pb-12 pt-7 sm:px-9 sm:pt-9 lg:px-10">
              <header className="mb-8">
                <div className="mb-3 flex items-center gap-2">
                  <StatusBadge status={issue.status} />
                  <span className="text-[11px] text-muted-foreground">
                    {t('issues.workspaceIssue')}
                  </span>
                </div>
                <h1 className="max-w-[32ch] break-words text-[24px] font-semibold leading-[1.35] tracking-[-0.025em] sm:text-[27px]">
                  {issue.title}
                </h1>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <IssueAvatar
                    name={issue.created_by_name || authorName(issue.created_by)}
                    source={issue.created_by}
                    size={22}
                  />
                  <span className="font-medium text-foreground/75">
                    {issue.created_by_name || authorName(issue.created_by)}
                  </span>
                  <span>{t('issues.openedIssue')}</span>
                  <span aria-hidden className="text-muted-foreground/40">
                    ·
                  </span>
                  <time dateTime={issue.created_at}>
                    {timeAgo(issue.created_at)}
                  </time>
                </div>
              </header>
              <article className="mb-10 text-[13px] leading-7 text-foreground/85 [&_.markdown-content>p]:leading-7 [&_.markdown-content>ul]:leading-7 [&_.markdown-content>*:first-child]:mt-0">
                {issue.description ? (
                  <MarkdownContent
                    content={issue.description}
                    agentNames={agentNames}
                    agentLabels={agentLabels}
                    humanNames={humanNames}
                  />
                ) : (
                  <p className="text-muted-foreground">
                    {t('issues.noDescription')}
                  </p>
                )}
              </article>
              <IssueWork issueId={id} title={issue.title} />
              <section aria-label={t('issues.discussion')}>
                <div className="mb-6 flex items-center gap-2 border-b border-border/70 pb-3">
                  <MessageSquare className="size-3.5 text-muted-foreground" />
                  <h2 className="text-xs font-semibold">
                    {t('issues.discussion')}
                  </h2>
                  <span className="ml-1 text-[11px] tabular-nums text-muted-foreground">
                    {issue.comments.filter((c) => c.kind !== 'status').length}
                  </span>
                </div>
                {issue.comments.length === 0 && (
                  <p className="mb-7 text-[13px] leading-6 text-muted-foreground">
                    {t('issues.noComments')}
                  </p>
                )}
                <div className="relative space-y-6 before:absolute before:bottom-4 before:left-[13px] before:top-3 before:w-px before:bg-border/60">
                  {issue.comments.map((c) => {
                    if (c.approval) return <ApprovalCard key={c.id} approval={c.approval} onResolved={() => void refresh()} />;
                    const name = c.author_name || authorName(c.author);
                    const activity =
                      c.kind === 'status' || c.kind === 'activity';
                    const status = c.content.split(' → ')[1] as IssueStatus;
                    if (activity)
                      return (
                        <article
                          key={c.id}
                          className="relative flex gap-3 text-xs"
                        >
                          <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-background ring-4 ring-background">
                            {c.kind === 'status' ? (
                              <StatusIcon
                                status={
                                  statuses.includes(status) ? status : 'open'
                                }
                                className="size-3.5"
                              />
                            ) : (
                              <Play className="size-3 text-muted-foreground" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1 pt-1 leading-5 text-muted-foreground">
                            <span className="font-medium text-foreground/75">
                              {name}
                            </span>{' '}
                            {c.kind === 'status'
                              ? t('issues.statusChanged', {
                                  status: t(
                                    statusKeys[status] ?? 'issues.open',
                                  ),
                                })
                              : t('issues.workStarted')}
                            <span className="ml-2 whitespace-nowrap text-[11px] text-muted-foreground/70">
                              {timeAgo(c.created_at)}
                            </span>
                            {c.kind === 'activity' && (
                              <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                                {c.content}
                              </p>
                            )}
                          </div>
                        </article>
                      );
                    return (
                      <article key={c.id} className="relative flex gap-3">
                        <span className="z-10 h-fit rounded-full bg-background ring-4 ring-background">
                          <IssueAvatar name={name} source={c.author} />
                        </span>
                        <div
                          className={cn(
                            'min-w-0 flex-1',
                            c.kind === 'result' &&
                              'rounded-lg border border-border/60 bg-muted/20 px-4 py-3',
                          )}
                        >
                          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-medium">{name}</span>
                            {c.kind === 'result' && (
                              <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {t('issues.agentResult')}
                              </span>
                            )}
                            <time
                              dateTime={c.created_at}
                              className="text-[11px] text-muted-foreground"
                            >
                              {timeAgo(c.created_at)}
                            </time>
                          </div>
                          <div className="text-[13px] leading-6 text-foreground/85">
                            <MarkdownContent
                              content={c.content}
                              agentNames={agentNames}
                              agentLabels={agentLabels}
                              humanNames={humanNames}
                            />
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <form
                  className="relative mt-8 flex gap-3"
                  onKeyDownCapture={(e) => {
                    if (e.target instanceof HTMLTextAreaElement && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!busyRef.current && comment.trim()) e.currentTarget.requestSubmit();
                    }
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (busyRef.current || !comment.trim()) return;
                    void mutate(
                      () =>
                        workspaceApi.commentOnIssue(id, {
                          content: comment,
                          ...identity,
                        }).then((result) => { if (result.dispatch_error) setError(result.dispatch_error); }),
                      () => setComment(''),
                    );
                  }}
                >
                  <span className="mt-1 hidden sm:block">
                    <IssueAvatar name={currentUser.name} source={source} />
                  </span>
                  <div className="min-w-0 flex-1 rounded-lg border border-border bg-background shadow-xs transition-shadow focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/10">
                    <label
                      className="block px-4 pt-3 text-xs font-medium"
                      htmlFor={`issue-comment-${id}`}
                    >
                      {t('issues.addComment')}
                    </label>
                    <IssueMentionInput
                      mentions={mentions.filter((m) => m.kind === 'human' || people.has(m.source))}
                      readOnly={busy}
                      id={`issue-comment-${id}`}
                      className="min-h-24 resize-y rounded-none border-0 px-4 py-3 text-[13px] shadow-none focus-visible:ring-0"
                      value={comment}
                      maxLength={50000}
                      onValueChange={setComment}
                      placeholder={t('issues.commentPlaceholder')}
                    />
                    <div className="flex items-center justify-between gap-3 px-3 pb-3">
                      <p className="max-w-[52ch] flex-1 pl-1 text-[11px] leading-4 text-muted-foreground">
                        {t('issues.commentHint')}
                      </p>
                      <Button
                        size="sm"
                        variant="mono"
                        type="submit"
                        className="shrink-0"
                        title={t('issues.commentShortcut')}
                        aria-keyshortcuts="Meta+Enter Control+Enter"
                        disabled={busy || !comment.trim()}
                      >
                        {t('issues.postComment')}
                        <Send className="size-3" />
                      </Button>
                    </div>
                  </div>
                </form>
              </section>
            </main>
            <aside
              className={cn(
                'order-first border-b border-border/60 bg-muted/10 px-5 py-7 sm:px-8 lg:order-last lg:block lg:border-b-0 lg:border-l lg:px-6 lg:py-9',
                !detailsOpen && 'hidden',
              )}
              aria-label={t('issues.details')}
            >
              <div className="space-y-7 lg:sticky lg:top-8">
                <section>
                  <label
                    className="mb-2.5 block text-[11px] font-medium text-muted-foreground"
                    htmlFor={`issue-status-${id}`}
                  >
                    {t('issues.status')}
                  </label>
                  <div className="relative flex items-center">
                    <StatusIcon
                      status={issue.status}
                      className="pointer-events-none absolute left-2.5 size-3.5"
                    />
                    <select
                      id={`issue-status-${id}`}
                      className="h-8 w-full appearance-none rounded-md border border-border/70 bg-background pl-8 pr-7 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={busy}
                      value={issue.status}
                      onChange={(e) => {
                        const status = e.target.value as IssueStatus;
                        void mutate(() =>
                          workspaceApi.updateIssue(id, { status, ...identity }),
                        );
                      }}
                    >
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {t(statusKeys[s])}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
                  </div>
                </section>
                <IssueProperties issue={issue} busy={busy} update={values => void mutate(() => workspaceApi.updateIssue(id, { ...values, ...identity }))} />
                <section>
                  <h2 className="mb-3 text-[11px] font-medium text-muted-foreground">
                    {t('issues.participants')}
                  </h2>
                  <div className="max-h-64 space-y-2.5 overflow-y-auto">
                    {Array.from(people, ([person, name]) => (
                      <div key={person} className="flex items-center gap-2.5" title={name}>
                        <IssueAvatar source={person} name={name} size={26} />
                        <span className="min-w-0 flex-1 text-xs font-medium">
                          <span className="block truncate">{name}</span>
                          {person.startsWith('openagents:') && (() => {
                            const participant = issue.participants.find(item => item.source === person);
                            if (!participant?.request_access) return null;
                            const mine = participant.owner_email?.toLowerCase() === currentUser.id.toLowerCase();
                            const label = mine ? t('messageAgentAccess.yours') : participant.request_access === 'yes' ? t('messageAgentAccess.shared') : participant.request_access === 'approval' ? t('messageAgentAccess.approval') : t('messageAgentAccess.notShared');
                            return <span className="mt-1 block space-y-0.5 text-[10px] font-normal text-muted-foreground">
                              {participant.owner_email && <span className="block truncate" title={participant.owner_name || participant.owner_email}>{t('messageAgentAccess.owner', { name: participant.owner_name || participant.owner_email })}</span>}
                              <span className="inline-block rounded bg-muted px-1.5 py-0.5">{label}</span>
                            </span>;
                          })()}
                        </span>
                        {person.startsWith('openagents:') && <>
                          <button type="button" disabled={busy} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={t('issues.removeAgent', { name })} title={t('issues.removeAgent', { name })}
                            onClick={() => void mutate(() => workspaceApi.removeIssueAgent(id, person.slice('openagents:'.length)))}><X className="size-3.5" /></button>
                        </>}
                      </div>
                    ))}
                  </div>
                  <AddIssueParticipants issueId={id} existing={Array.from(people.keys())} onAdded={() => { void refresh(); onChanged(); }} />
                </section>
                <label className="flex flex-col gap-2 text-xs text-muted-foreground">
                  {t('threadSettings.shareMyAgents')}
                  <select className={selectClass} aria-label={t('threadSettings.shareMyAgents')}
                    value={issue.agent_sharing_mode || 'no'} disabled={busy}
                    onChange={event => void mutate(async () => { await workspaceApi.setIssueAgentSharing(id, event.target.value as 'no' | 'yes' | 'approval'); await refreshAgents(); })}>
                    <option value="no">{t('threadSettings.sharingNo')}</option>
                    <option value="yes">{t('threadSettings.sharingYes')}</option>
                    <option value="approval">{t('threadSettings.sharingApproval')}</option>
                  </select>
                </label>
                <section className="border-t border-border/60 pt-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-[11px] font-medium text-muted-foreground">
                      {t('issueWork.threads')}
                      <span className="ml-2 tabular-nums">
                        {issue.threads.length || ''}
                      </span>
                    </h2>
                    <button
                      aria-label={t('issues.linkThread')}
                      title={t('issues.linkThread')}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={busy}
                      onClick={() => setActionOpen(true)}
                    >
                      <Link2 className="size-3.5" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    {issue.threads.map((th) => (
                      <div key={th.channel_name}>
                        <button
                          className="group flex w-full items-start gap-2 text-left text-xs leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() =>
                            setChat({
                              channel: th.channel_name,
                              title: th.title,
                            })
                          }
                        >
                          <MessageSquare className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 font-medium group-hover:underline">
                              {th.title}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {th.agents.join(', ')}
                            </span>
                          </span>
                          <ArrowUpRight className="mt-1 size-3 shrink-0 text-muted-foreground/50" />
                        </button>
                        {share(th.latest_reply)}
                      </div>
                    ))}
                  </div>
                  {issue.threads.length === 0 && (
                    <p className="mb-3 text-xs leading-5 text-muted-foreground">
                      {t('issues.noAgentWork')}
                    </p>
                  )}

                </section>

              </div>
            </aside>
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
      {chat && (
        <TaskChatPopup
          open
          onOpenChange={(open) => {
            if (!open) setChat(null);
          }}
          sessionId={chat.channel}
          taskTitle={chat.title}
          assignee={null}
        />
      )}
      <Dialog
        open={actionOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setActionOpen(false);
        }}
      >
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">
              {t('issues.linkThread')}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={submitAction}
          >
            <DialogBody className="space-y-5 pb-2">
              <label className="block space-y-2 text-sm">
                <span>{t('issues.sourceThread')}</span>
                <select
                  required
                  className={cn(selectClass, 'w-full')}
                  value={thread}
                  onChange={(e) => setThread(e.target.value)}
                >
                  <option value="">{t('issues.selectThread')}</option>
                  {sessions
                    .filter(
                      (s) =>
                        s.status !== 'deleted' &&
                        !issue?.threads.some(
                          (th) => th.channel_name === s.sessionId,
                        ),
                    )
                    .map((s) => (
                      <option key={s.sessionId} value={s.sessionId}>
                        {s.title || s.sessionId}
                      </option>
                    ))}
                </select>
              </label>
              {error && <ErrorNotice message={error} />}
            </DialogBody>
            <DialogFooter className="border-t border-border/60 bg-muted/15 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setActionOpen(false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={busy || !thread}
              >
                {t(busy ? 'common.saving' : 'issues.linkThread')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
