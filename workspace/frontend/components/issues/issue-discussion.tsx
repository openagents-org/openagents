'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Link2,
  MessageSquare,
  Plus,
  Play,
  Pencil,
  PanelRight,
  Send,
  ListTodo,
  ChevronDown,
} from 'lucide-react';
import { DetailHeader } from '@/components/layout/app-header';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { workspaceApi } from '@/lib/api';
import { useT, useFormatters } from '@/lib/i18n';
import type { IssueDetail, IssueReply, IssueStatus } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { agentLabel } from '@/lib/helpers';
import { cn } from '@/lib/utils';
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
  const { currentUser, agents, sessions, tasks, refreshTasks } = useWorkspace();
  const { openView } = useLayout();
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [action, setAction] = useState<'agent' | 'thread' | 'task'>('agent');
  const [actionOpen, setActionOpen] = useState(false);
  function openAction(next: 'agent' | 'thread' | 'task') {
    setAction(next);
    setActionOpen(true);
  }
  const [chosenAgents, setChosenAgents] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [thread, setThread] = useState('');
  const [taskId, setTaskId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
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
        if (action === 'agent')
          await workspaceApi.startIssueThread(id, {
            agents: chosenAgents,
            instruction,
            ...identity,
          });
        else if (action === 'thread')
          await workspaceApi.linkIssueThread(id, thread);
        else if (action === 'task') {
          await workspaceApi.addIssueTask(id, {
            ...(taskId
              ? { task_id: taskId }
              : { title: taskTitle, description: taskDescription }),
            ...identity,
          });
          await refreshTasks();
        }
      },
      () => {
        setActionOpen(false);
        setInstruction('');
        setChosenAgents([]);
        setThread('');
        setTaskId('');
        setTaskTitle('');
        setTaskDescription('');
      },
    );
  }

  const people = new Map<string, string>();
  if (issue) {
    people.set(
      issue.created_by,
      issue.created_by_name || authorName(issue.created_by),
    );
    issue.comments.forEach((c) =>
      people.set(c.author, c.author_name || authorName(c.author)),
    );
    issue.threads.forEach((th) =>
      th.agents.forEach((agent) =>
        people.set(
          `openagents:${agent}`,
          agentLabel(
            agents.find((a) => a.agentName === agent) || { agentName: agent },
          ),
        ),
      ),
    );
  }
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
  const taskStatusKeys = {
    backlog: 'tasks.col.backlog',
    todo: 'tasks.col.backlog',
    in_progress: 'tasks.col.in_progress',
    need_input: 'tasks.col.need_input',
    done: 'tasks.col.done',
  } as const;

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
              url.searchParams.set('issue', id);
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
                  onSubmit={(e) => {
                    e.preventDefault();
                    void mutate(
                      () =>
                        workspaceApi.commentOnIssue(id, {
                          content: comment,
                          ...identity,
                        }),
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
                      mentions={mentions}
                      readOnly={busy}
                      id={`issue-comment-${id}`}
                      className="min-h-24 resize-y rounded-none border-0 px-4 py-3 text-[13px] shadow-none focus-visible:ring-0"
                      value={comment}
                      maxLength={50000}
                      onValueChange={setComment}
                      placeholder={t('issues.commentPlaceholder')}
                    />
                    <div className="flex items-center justify-between gap-3 px-3 pb-3">
                      <p className="max-w-[32ch] pl-1 text-[11px] leading-4 text-muted-foreground">
                        {t('issues.commentHint')}
                      </p>
                      <Button
                        size="sm"
                        variant="mono"
                        type="submit"
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
                <section>
                  <h2 className="mb-3 text-[11px] font-medium text-muted-foreground">
                    {t('issues.participants')}
                  </h2>
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label={Array.from(people.values()).join(', ')}
                  >
                    {Array.from(people, ([person, name]) => (
                      <IssueAvatar
                        key={person}
                        source={person}
                        name={name}
                        size={26}
                      />
                    ))}
                  </div>
                </section>
                <section className="border-t border-border/60 pt-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="text-[11px] font-medium text-muted-foreground">
                      {t('issues.agentWork')}
                      <span className="ml-2 tabular-nums">
                        {issue.threads.length || ''}
                      </span>
                    </h2>
                    <button
                      aria-label={t('issues.linkThread')}
                      title={t('issues.linkThread')}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      disabled={busy}
                      onClick={() => openAction('thread')}
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
                  <Button
                    className="mt-4 w-full justify-start text-xs"
                    variant="outline"
                    size="sm"
                    disabled={busy || issue.status === 'closed'}
                    onClick={() => openAction('agent')}
                  >
                    <Plus className="size-3.5" />
                    {t('issues.bringAgent')}
                  </Button>
                </section>
                <section className="border-t border-border/60 pt-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[11px] font-medium text-muted-foreground">
                      {t('issues.scopedTasks')}
                      <span className="ml-2 tabular-nums">
                        {issue.tasks.length || ''}
                      </span>
                    </h2>
                    <button
                      aria-label={t('issues.addTask')}
                      title={t('issues.addTask')}
                      disabled={busy}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => {
                        void refreshTasks().catch((e) =>
                          setError(errorMessage(e)),
                        );
                        setAction('task');
                      }}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <div className="space-y-4">
                    {issue.tasks.map((task) => (
                      <div key={task.id}>
                        <button
                          className="group flex w-full items-start gap-2 text-left text-xs leading-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() =>
                            task.channelName
                              ? setChat({
                                  channel: task.channelName,
                                  title: task.title,
                                })
                              : openView('tasks')
                          }
                        >
                          <ListTodo className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                          <span>
                            <span className="font-medium group-hover:underline">
                              {task.title}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">
                              {t(taskStatusKeys[task.status])}
                            </span>
                          </span>
                        </button>
                        {share(task.latest_reply)}
                      </div>
                    ))}
                  </div>
                  {!issue.tasks.length && (
                    <p className="text-xs leading-5 text-muted-foreground">
                      {t('issues.noTasks')}
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
              {t(
                action === 'agent'
                  ? 'issues.bringAgent'
                  : action === 'thread'
                    ? 'issues.linkThread'
                    : 'issues.addTask',
              )}
            </DialogTitle>
          </DialogHeader>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={submitAction}
          >
            <DialogBody className="space-y-5 pb-2">
              {action === 'agent' && (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t('issues.agentHint')}
                  </p>
                  <fieldset className="max-h-48 space-y-2 overflow-auto rounded-md">
                    <legend className="mb-2 text-sm font-medium">
                      {t('issues.chooseAgents')}
                    </legend>
                    {agents.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        {t('issues.noAgents')}
                      </p>
                    )}
                    {agents.map((a) => (
                      <label
                        key={a.agentName}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-xs transition-colors has-[:checked]:border-foreground/30 has-[:checked]:bg-muted/50 hover:bg-muted/30"
                      >
                        <input
                          type="checkbox"
                          checked={chosenAgents.includes(a.agentName)}
                          onChange={(e) =>
                            setChosenAgents((prev) =>
                              e.target.checked
                                ? [...prev, a.agentName]
                                : prev.filter((n) => n !== a.agentName),
                            )
                          }
                        />
                        <IssueAvatar
                          name={agentLabel(a)}
                          source={`openagents:${a.agentName}`}
                          size={26}
                        />
                        {agentLabel(a)}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {a.status === 'online'
                            ? t('issues.online')
                            : t('issues.offline')}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <label className="block space-y-2 text-sm">
                    <span>{t('issues.instruction')}</span>
                    <Textarea
                      required
                      maxLength={10000}
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder={t('issues.instructionPlaceholder')}
                    />
                  </label>
                </>
              )}
              {action === 'thread' && (
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
              )}
              {action === 'task' && (
                <>
                  <label className="block space-y-2 text-sm">
                    <span>{t('issues.existingTask')}</span>
                    <select
                      className={cn(selectClass, 'w-full')}
                      value={taskId}
                      onChange={(e) => setTaskId(e.target.value)}
                    >
                      <option value="">{t('issues.newTask')}</option>
                      {tasks
                        .filter(
                          (task) =>
                            !task.issueId &&
                            !issue?.tasks.some(
                              (linked) => linked.id === task.id,
                            ),
                        )
                        .map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  {!taskId && (
                    <>
                      <label className="block space-y-2 text-sm">
                        <span>{t('issues.title')}</span>
                        <Input
                          required
                          maxLength={240}
                          value={taskTitle}
                          onChange={(e) => setTaskTitle(e.target.value)}
                        />
                      </label>
                      <label className="block space-y-2 text-sm">
                        <span>{t('issues.taskScope')}</span>
                        <Textarea
                          value={taskDescription}
                          maxLength={50000}
                          onChange={(e) => setTaskDescription(e.target.value)}
                          placeholder={t('issues.taskScopePlaceholder')}
                        />
                      </label>
                    </>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t('issues.taskHint')}
                  </p>
                </>
              )}
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
                disabled={
                  busy ||
                  (action === 'agent'
                    ? !chosenAgents.length ||
                      chosenAgents.length > 10 ||
                      !instruction.trim()
                    : action === 'thread'
                      ? !thread
                      : !taskId && !taskTitle.trim())
                }
              >
                {t(
                  busy
                    ? 'common.saving'
                    : action === 'agent'
                      ? 'issues.startWork'
                      : action === 'thread'
                        ? 'issues.linkThread'
                        : 'issues.addTask',
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
