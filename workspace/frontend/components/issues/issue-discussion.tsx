'use client';

import { IssueWork } from './issue-work';
import { IssueAgentProgress } from './issue-agent-progress';
import { IssueAttachments } from './issue-attachments';
import { resourcePath } from '@/lib/resource-link';
import { shareOrigin } from '@/lib/share-origin';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  BookOpen,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Link2,
  MessageSquare,
  X,
  Play,
  Pencil,
  Send,
  Reply,
  ChevronDown,
  Trash2,
} from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { issueSignalChannel } from '@/lib/signals';
import { useT, useFormatters } from '@/lib/i18n';
import type { IssueDetail, IssueStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { MarkdownContent } from '@/components/chat/markdown-content';
import { useLayout } from '@/components/layout/layout-context';
import { cn } from '@/lib/utils';
import { AddIssueParticipants } from './add-issue-participants';
import { IssueProperties } from './issue-properties';
import { ApprovalCard } from '@/components/chat/approval-card';
import { IssueEditor } from './issue-editor';
import { IssueMentionInput } from './issue-mention-input';
import { useIssueMentions } from './use-issue-mentions';
import { mentionsAgent } from './issue-mentions';
import { AttachmentPicker } from '@/components/tasks/attachment-picker';
import { sidebarAgents } from '@/lib/sidebar-agents';
import {
  ErrorNotice,
  StatusIcon,
  IssueAvatar,
  IssueSkeleton,
  errorMessage,
  authorName,
  statuses,
  statusKeys,
  selectClass,
  useConfirmIssueDelete,
  useIssueTime,
} from './issue-ui';

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
  const confirmDelete = useConfirmIssueDelete();
  const { timeAgo } = useFormatters();
  const issueTime = useIssueTime();
  const { currentUser, refreshAgents, workspace, agents, unreadSignals, markChannelSignalsRead, setCurrentSessionId } = useWorkspace();
  const { openView } = useLayout();
  const signalChannel = issueSignalChannel(id);
  const hasUnreadMention = !!unreadSignals?.[signalChannel];
  // Signals arriving while the tab is hidden or unfocused stay unread until the
  // person comes back to the issue.
  useEffect(() => {
    if (!hasUnreadMention) return;
    const attentive = () => document.visibilityState === 'visible' && document.hasFocus();
    if (attentive()) {
      markChannelSignalsRead(signalChannel);
      return;
    }
    const onReturn = () => { if (attentive()) markChannelSignalsRead(signalChannel); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [hasUnreadMention, signalChannel, markChannelSignalsRead]);
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [comment, setComment] = useState('');
  const [replyTo, setReplyTo] = useState<{ eventId: string; name: string } | null>(null);
  const [commentFiles, setCommentFiles] = useState<string[]>([]);
  const [commentUploading, setCommentUploading] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  useEffect(() => { setReplyTo(null); setComment(''); setCommentFiles([]); setPickerKey(k => k + 1); }, [id]);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [copied, setCopied] = useState(false);
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

  async function removeIssue() {
    if (busyRef.current || !issue) return;
    const ok = await confirmDelete(issue.title);
    if (!ok || busyRef.current) return;
    busyRef.current = true;
    // Drop any refresh in flight: it would report the issue as missing.
    ++version.current;
    setBusy(true);
    setError('');
    try {
      await workspaceApi.deleteIssue(id);
      busyRef.current = false;
      if (mounted.current) onBack();
    } catch (e) {
      busyRef.current = false;
      if (mounted.current) {
        setError(errorMessage(e));
        setBusy(false);
      }
    }
  }

  const workingIn = (channel: string) => agents.filter(agent => agent.status === 'online' && agent.busyChannels?.includes(channel));
  const people = new Map((issue?.participants || []).map((p) => [p.source, p.name]));
  // Agents the viewer may ask for work; mentioning one not yet on the issue
  // adds it before the comment is posted.
  const usableAgents = new Set(sidebarAgents(agents ?? [], currentUser.id).filter(a => !a.builtin).map(a => `openagents:${a.agentName}`));
  const mentions = useIssueMentions(issue);
  const participantNames = new Map(mentions.map(person => [person.source.toLowerCase(), person.name]));
  const canPost = !commentUploading && (!!comment.trim() || commentFiles.length > 0);
  const agentNames = mentions
    .filter((m) => m.kind === 'agent')
    .map((m) => m.token);
  const agentLabels = Object.fromEntries(
    mentions.filter((m) => m.kind === 'agent').map((m) => [m.token, m.name]),
  );
  const humanNames = Object.fromEntries(
    mentions.filter((m) => m.kind === 'human').map((m) => [m.token, m.name]),
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <Header
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
          <div className="mx-auto min-h-full max-w-[1000px]">
            <main className={cn('min-w-0 px-5 pb-12 pt-7', !embedded && 'sm:px-9 sm:pt-9 lg:px-10')}>
              <header className="mb-8">
                <div className="mb-3 flex items-center gap-2">
                  <div className="relative inline-flex items-center">
                    <StatusIcon status={issue.status} className="pointer-events-none absolute left-2 size-3.5" />
                    <select id={`issue-status-${id}`} aria-label={t('issues.status')} disabled={busy} value={issue.status}
                      className="h-7 appearance-none rounded-md border border-border/70 bg-background pl-7 pr-7 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onChange={event => void mutate(() => workspaceApi.updateIssue(id, { status: event.target.value as IssueStatus, ...identity }))}>
                      {statuses.map(status => <option key={status} value={status}>{t(statusKeys[status])}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 size-3 text-muted-foreground" />
                  </div>
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
                  <time dateTime={issue.created_at} title={issueTime.exact(issue.created_at)}>
                    {issueTime.label(issue.created_at)}
                  </time>
                </div>
                <div className="mt-3 space-y-2 border-y border-border/60 py-2">
                  <div className="grid grid-cols-1 items-center gap-x-5 gap-y-1 sm:grid-cols-2">
                    <IssueProperties issue={issue} busy={busy} update={values => void mutate(() => workspaceApi.updateIssue(id, { ...values, ...identity }))} />
                    <label className="flex min-w-0 items-center gap-2 text-[11px] font-medium text-muted-foreground">
                      <span className="shrink-0">{t('threadSettings.shareMyAgents')}</span>
                      <select className={cn(selectClass, 'h-8 min-w-0 flex-1 border-transparent bg-transparent px-1.5 text-xs font-normal hover:border-border')} aria-label={t('threadSettings.shareMyAgents')}
                        value={issue.agent_sharing_mode || 'no'} disabled={busy}
                        onChange={event => void mutate(async () => { await workspaceApi.setIssueAgentSharing(id, event.target.value as 'no' | 'yes' | 'approval'); await refreshAgents(); })}>
                        <option value="no">{t('threadSettings.sharingNo')}</option>
                        <option value="yes">{t('threadSettings.sharingYes')}</option>
                        <option value="approval">{t('threadSettings.sharingApproval')}</option>
                      </select>
                    </label>
                  </div>
                  <section aria-label={t('issues.participants')} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <div className="flex items-center gap-2">
                      <h2 className="text-xs text-muted-foreground">{t('issues.participants')} <span className="ml-1 tabular-nums">{people.size}</span></h2>
                      <AddIssueParticipants issueId={id} existing={Array.from(people.keys())} onAdded={() => { void refresh(); onChanged(); }} />
                    </div>
                    {people.size > 0 && <div className="flex flex-wrap gap-1.5">
                      {Array.from(people, ([person, savedName]) => {
                        const name = participantNames.get(person.toLowerCase()) || savedName;
                        const participant = issue.participants.find(item => item.source === person);
                        const owner = participant?.owner_name || participant?.owner_email;
                        const access = participant?.request_access;
                        const accessLabel = access ? t(participant?.owner_email?.toLowerCase() === currentUser.id.toLowerCase() ? 'messageAgentAccess.yours' : access === 'yes' ? 'messageAgentAccess.shared' : access === 'approval' ? 'messageAgentAccess.approval' : 'messageAgentAccess.notShared') : '';
                        const hint = [name, owner && t('messageAgentAccess.owner', { name: owner }), accessLabel].filter(Boolean).join('\n');
                        return <span key={person} title={hint} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-muted/20 py-1 pl-1 pr-2.5 text-xs">
                          <IssueAvatar source={person} name={name} size={20} />
                          <span className="max-w-36 truncate">{name}</span>
                          {person.startsWith('openagents:') && <button type="button" disabled={busy}
                            className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                            aria-label={t('issues.removeAgent', { name })} title={t('issues.removeAgent', { name })}
                            onClick={() => void mutate(() => workspaceApi.removeIssueAgent(id, person.slice('openagents:'.length)))}><X className="size-3" /></button>}
                        </span>;
                      })}
                    </div>}
                  </section>
                </div>
                {/* Under the title, where the eye already is — tucked in the
                    detail header's right corner they were easy to miss. */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={async () => {
                      try {
                        const url = new URL(
                          resourcePath(workspace?.slug || workspace?.workspaceId || '', 'issues', id),
                          shareOrigin(),
                        );
                        await navigator.clipboard.writeText(url.toString());
                        setCopied(true);
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  >
                    {copied ? (
                      <Check className="size-4" />
                    ) : (
                      <Link2 className="size-4" />
                    )}
                    {t(copied ? 'common.copied' : 'issues.copyLink')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => setEdit(true)}
                  >
                    <Pencil className="size-4" />
                    {t('common.edit')}
                  </Button>
                  {issue.can_delete && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={removeIssue}
                    >
                      <Trash2 className="size-4" />
                      {t('common.delete')}
                    </Button>
                  )}
                </div>
              </header>
              {/* Issue text is typed in a plain textarea, where Enter means a new
                  line; Markdown would fold a single newline into a space. Only
                  paragraphs keep them, so lists and code blocks are untouched. */}
              <article className="mb-10 min-w-0 [overflow-wrap:anywhere] text-[13px] leading-7 text-foreground/85 [&_.markdown-content_p]:whitespace-pre-line [&_.markdown-content>p]:leading-7 [&_.markdown-content>ul]:leading-7 [&_.markdown-content>*:first-child]:mt-0">
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
              {((issue.attachments?.length ?? 0) > 0 || (issue.knowledge?.length ?? 0) > 0) && (
                <div className="mb-8 flex flex-wrap gap-2">
                  <IssueAttachments files={issue.attachments || []} workspaceId={workspace?.slug || workspace?.workspaceId || ''} />
                  {issue.knowledge?.map(entry => <a key={entry.id} href={resourcePath(workspace?.slug || workspace?.workspaceId || '', 'knowledge', entry.id)} className="inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-muted"><BookOpen className="size-3.5 shrink-0" /><span className="truncate">{entry.title}</span></a>)}
                </div>
              )}
              <IssueWork key={id} issueId={id} closed={issue.status === 'closed'} onPosted={warning => { setError(warning || ''); void refresh(); void refreshAgents(); onChanged(); }} />
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
                      c.kind === 'status' || c.kind === 'activity' || c.kind === 'due_date';
                    const status = c.content.split(' → ')[1] as IssueStatus;
                    if (activity)
                      return (
                        <article
                          key={c.id}
                          className="relative flex gap-3 text-xs"
                        >
                          <span className="z-10 flex size-7 shrink-0 items-center justify-center rounded-full bg-background ring-4 ring-background">
                            {c.kind === 'due_date' ? <CalendarDays className="size-3.5 text-muted-foreground" /> : c.kind === 'status' ? (
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
                              : c.kind === 'due_date' ? (c.content ? t('issues.dueDateSet', { date: c.content }) : t('issues.dueDateRemoved')) : t('issues.workStarted')}
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
                            {c.kind === 'result' && (c.reply_channel_name || c.channel_name) && <button type="button"
                              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => { setCurrentSessionId(c.reply_channel_name || c.channel_name!); openView('threads'); }}>
                              {t('issues.openInThread')}<ArrowUpRight className="size-3" />
                            </button>}
                          </div>
                          <div className="text-[13px] leading-6 text-foreground/85 [&_.markdown-content_p]:whitespace-pre-line">
                            {c.content && <MarkdownContent
                              content={c.content}
                              agentNames={agentNames}
                              agentLabels={agentLabels}
                              humanNames={humanNames}
                            />}
                          </div>
                          {!!c.attachments?.length && <div className="mt-2">
                            <IssueAttachments files={c.attachments} workspaceId={workspace?.slug || workspace?.workspaceId || ''} />
                          </div>}
                          {c.kind === 'result' && c.source_event_id && c.reply_channel_name && (
                            <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                              disabled={busy || issue.status === 'closed'}
                              onClick={() => {
                                setReplyTo({ eventId: c.source_event_id!, name });
                                const mention = `@${c.author.replace(/^openagents:/, '')}`;
                                setComment(value => value.startsWith(`${mention} `) || value === mention ? value : `${mention} ${value}`);
                                requestAnimationFrame(() => {
                                  const input = document.getElementById(`issue-comment-${id}`);
                                  input?.focus();
                                  input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                                });
                              }}>
                              <Reply className="size-3.5" />{t('issues.reply')}
                            </Button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {issue.threads.map(thread => {
                  const working = workingIn(thread.channel_name);
                  return working.length ? <IssueAgentProgress key={thread.channel_name} thread={thread} agents={working} /> : null;
                })}
                <form
                  className="relative mt-8 flex gap-3"
                  onKeyDownCapture={(e) => {
                    if (e.target instanceof HTMLTextAreaElement && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!busyRef.current && canPost) e.currentTarget.requestSubmit();
                    }
                  }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (busyRef.current || !canPost) return;
                    const invite = [...usableAgents].filter(source => !people.has(source))
                      .map(source => source.slice('openagents:'.length))
                      .filter(name => mentionsAgent(comment, name));
                    void mutate(
                      async () => {
                        // Adding participants is idempotent, so a failed post can be retried.
                        if (invite.length) await workspaceApi.addIssueParticipants(id, invite.map(name => ({ kind: 'agent' as const, id: name })));
                        const result = await workspaceApi.commentOnIssue(id, {
                          content: comment,
                          ...(commentFiles.length ? { file_ids: commentFiles } : {}),
                          ...(replyTo ? { reply_to_event_id: replyTo.eventId } : {}),
                          ...identity,
                        });
                        if (result.dispatch_error) setError(result.dispatch_error);
                      },
                      () => { setComment(''); setReplyTo(null); setCommentFiles([]); setPickerKey(k => k + 1); },
                    );
                  }}
                >
                  <span className="mt-1 hidden sm:block">
                    <IssueAvatar name={currentUser.name} source={source} />
                  </span>
                  <div className="min-w-0 flex-1 rounded-lg border border-border bg-background shadow-xs transition-shadow focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/10">
                    {replyTo && <div className="flex items-center justify-between gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
                      <span>{t('issues.replyingTo', { name: replyTo.name })}</span>
                      <button type="button" disabled={busy} onClick={() => setReplyTo(null)} aria-label={t('issues.cancelReply')} className="rounded p-1 hover:bg-muted"><X className="size-3.5" /></button>
                    </div>}
                    <label
                      className="block px-4 pt-3 text-xs font-medium"
                      htmlFor={`issue-comment-${id}`}
                    >
                      {t('issues.addComment')}
                    </label>
                    <IssueMentionInput
                      mentions={mentions.filter((m) => m.kind === 'human' || people.has(m.source) || usableAgents.has(m.source))}
                      readOnly={busy}
                      id={`issue-comment-${id}`}
                      className="min-h-24 resize-y rounded-none border-0 px-4 py-3 text-[13px] shadow-none focus-visible:ring-0"
                      value={comment}
                      maxLength={50000}
                      onValueChange={setComment}
                      placeholder={t('issues.commentPlaceholder')}
                    />
                    <div className="px-3 pb-2">
                      <AttachmentPicker key={pickerKey} compact value={commentFiles} onChange={setCommentFiles}
                        disabled={busy} onUploadingChange={setCommentUploading} />
                    </div>
                    <div className="flex items-center justify-end gap-3 px-3 pb-3">
                      <Button
                        size="sm"
                        variant="mono"
                        type="submit"
                        className="shrink-0"
                        title={t('issues.commentShortcut')}
                        aria-keyshortcuts="Meta+Enter Control+Enter"
                        disabled={busy || !canPost}
                      >
                        {t(commentUploading ? 'tasks.attachUploading' : 'issues.postComment')}
                        <Send className="size-3" />
                      </Button>
                    </div>
                  </div>
                </form>
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
