'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CircleDot,
  LayoutList,
  KanbanSquare,
  MessageSquare,
  Plus,
  Search,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { useT, useFormatters } from '@/lib/i18n';
import type { IssueStatus, WorkspaceIssue } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DetailHeader } from '@/components/layout/app-header';
import { IssueEditor } from './issue-editor';
import { IssueDiscussion } from './issue-discussion';
import {
  ErrorNotice,
  StatusIcon,
  IssueAvatar,
  IssueSkeleton,
  errorMessage,
  authorName,
  statuses,
  statusKeys,
} from './issue-ui';

export function IssuesView() {
  const { workspace } = useWorkspace();
  // A workspace switch must discard selection and pending requests.
  return <IssueWorkspace key={workspace?.workspaceId} />;
}

function IssueWorkspace() {
  const t = useT();
  const { timeAgo } = useFormatters();
  const [issues, setIssues] = useState<WorkspaceIssue[]>([]);
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('issue'),
  );
  const selectIssue = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('issue', id);
    else url.searchParams.delete('issue');
    window.history.replaceState(null, '', url);
    setSelected(id);
  };
  const [createOpen, setCreateOpen] = useState(false);
  const [board, setBoard] = useState(false);
  const [status, setStatus] = useState<IssueStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [pages, setPages] = useState(1);
  const requestVersion = useRef(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = async () => {
      const version = ++requestVersion.current;
      try {
        const batches = await Promise.all(
          Array.from({ length: pages }, (_, page) =>
            workspaceApi.listIssues({
              status: status === 'all' ? undefined : status,
              query,
              offset: page * 100,
            }),
          ),
        );
        const result = {
          issues: Array.from(
            new Map(
              batches
                .flatMap((batch) => batch.issues)
                .map((issue) => [issue.id, issue]),
            ).values(),
          ),
          next_offset: batches.at(-1)!.next_offset,
        };
        if (!active || version !== requestVersion.current) return;
        setIssues(result.issues);
        setNextOffset(result.next_offset);
        setError('');
      } catch (e) {
        if (active && version === requestVersion.current)
          setError(errorMessage(e));
      } finally {
        if (active && version === requestVersion.current) setLoading(false);
      }
    };
    const debounce = setTimeout(load, 200);
    const interval = setInterval(load, 15000);
    return () => {
      active = false;
      clearTimeout(debounce);
      clearInterval(interval);
    };
  }, [status, query, revision, pages]);

  const preview = (description: string) =>
    description
      .split(/\n\s*\n/)[0]
      .replace(/[#*_`>]/g, '')
      .trim();
  const row = (issue: WorkspaceIssue, asCard = false) => (
    <button
      key={issue.id}
      aria-label={`${issue.title} · ${t(statusKeys[issue.status])}`}
      onClick={() => selectIssue(issue.id)}
      className={cn(
        'group w-full text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        asCard
          ? 'rounded-lg border border-border/70 bg-background p-4 shadow-xs hover:border-foreground/20'
          : 'flex items-start gap-3 px-5 py-4 hover:bg-muted/40 sm:px-8',
      )}
    >
      <StatusIcon
        status={issue.status}
        className={cn('mt-0.5', asCard && 'hidden')}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn('flex gap-4', asCard ? 'items-start' : 'items-center')}
        >
          <span
            className={cn(
              'min-w-0 flex-1 text-[13px] font-medium leading-5 text-foreground',
              asCard ? 'line-clamp-3' : 'truncate',
            )}
          >
            {issue.title}
          </span>
          {!asCard && (
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
              {timeAgo(issue.updated_at)}
            </span>
          )}
        </div>
        {issue.description && (
          <p
            className={cn(
              'mt-1 text-xs leading-5 text-muted-foreground',
              asCard ? 'line-clamp-2' : 'truncate',
            )}
          >
            {preview(issue.description)}
          </p>
        )}
        <div
          className={cn(
            'flex items-center gap-2 text-[11px] text-muted-foreground',
            asCard ? 'mt-4' : 'mt-2',
          )}
        >
          <IssueAvatar
            name={issue.created_by_name || authorName(issue.created_by)}
            size={18}
          />
          <span className="truncate">
            {issue.created_by_name || authorName(issue.created_by)}
          </span>
          {asCard && (
            <span className="ml-auto shrink-0">
              {timeAgo(issue.updated_at)}
            </span>
          )}
          {!!issue.comment_count && (
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1',
                !asCard && 'ml-2',
              )}
            >
              <MessageSquare className="size-3" />
              {issue.comment_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );

  if (selected)
    return (
      <IssueDiscussion
        key={selected}
        id={selected}
        onBack={() => {
          selectIssue(null);
          reload();
        }}
        onChanged={reload}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <DetailHeader
        title={<h1 className="text-sm font-semibold">{t('views.issues')}</h1>}
      >
        <Button size="sm" variant="mono" onClick={() => setCreateOpen(true)}>
          <Plus className="size-3.5" />
          {t('issues.newIssue')}
        </Button>
      </DetailHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-border/70 px-5 pt-3 sm:px-8">
        <div
          className="flex items-center gap-5 overflow-x-auto"
          role="group"
          aria-label={t('issues.status')}
        >
          {(['all', ...statuses] as const).map((value) => (
            <button
              key={value}
              aria-pressed={status === value}
              onClick={() => {
                setStatus(value);
                setPages(1);
              }}
              className={cn(
                'relative shrink-0 whitespace-nowrap pb-3 pt-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                status === value
                  ? 'font-medium text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-t after:bg-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {value === 'all' ? t('issues.allIssues') : t(statusKeys[value])}
            </button>
          ))}
        </div>
        <div className="mb-3 ml-auto flex min-w-0 flex-1 items-center justify-end gap-3 sm:flex-none">
          <div className="relative w-full sm:w-48">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <Input
              className="h-7 border-transparent bg-muted/40 pl-8 text-xs shadow-none focus:border-input"
              aria-label={t('issues.search')}
              placeholder={t('issues.search')}
              value={query}
              maxLength={240}
              onChange={(e) => {
                setQuery(e.target.value);
                setPages(1);
              }}
            />
          </div>
          <div className="flex shrink-0 gap-0.5 rounded-md border border-border/60 bg-muted/30 p-0.5">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'size-6 rounded-sm [&_svg]:size-3.5',
                !board && 'bg-background shadow-xs',
              )}
              aria-label={t('issues.list')}
              aria-pressed={!board}
              onClick={() => setBoard(false)}
            >
              <LayoutList />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'size-6 rounded-sm [&_svg]:size-3.5',
                board && 'bg-background shadow-xs',
              )}
              aria-label={t('issues.board')}
              aria-pressed={board}
              onClick={() => setBoard(true)}
            >
              <KanbanSquare />
            </Button>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
        {error && (
          <div className="px-5 pt-5 sm:px-8">
            <ErrorNotice message={error} retry={reload} />
          </div>
        )}
        {loading && issues.length === 0 ? (
          <>
            <span className="sr-only">{t('common.loading')}</span>
            <IssueSkeleton />
          </>
        ) : error && issues.length === 0 ? null : issues.length === 0 ? (
          <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-24 text-center">
            <div className="mb-5 flex size-12 items-center justify-center rounded-xl border border-border/70 bg-muted/30">
              <CircleDot
                className="size-5 text-muted-foreground"
                strokeWidth={1.5}
              />
            </div>
            <h2 className="text-sm font-medium">
              {t(
                query || status !== 'all'
                  ? 'issues.noMatches'
                  : 'issues.emptyTitle',
              )}
            </h2>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              {t(
                query || status !== 'all'
                  ? 'issues.noMatchesHint'
                  : 'issues.emptyDescription',
              )}
            </p>
            {!query && status === 'all' && (
              <Button
                className="mt-6"
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
              >
                <Plus />
                {t('issues.newIssue')}
              </Button>
            )}
          </div>
        ) : board ? (
          <div className="grid min-h-full grid-cols-1 gap-6 bg-muted/15 p-5 sm:grid-cols-3 sm:px-8 sm:py-6">
            {statuses.map((value) => (
              <section key={value} className="min-w-0">
                <div className="mb-4 flex items-center gap-2.5 px-1">
                  <StatusIcon status={value} />
                  <h2 className="text-xs font-medium">
                    {t(statusKeys[value])}
                  </h2>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {issues.filter((issue) => issue.status === value).length}
                  </span>
                </div>
                <div className="space-y-3">
                  {issues
                    .filter((issue) => issue.status === value)
                    .map((issue) => row(issue, true))}
                  {!issues.some((issue) => issue.status === value) && (
                    <p className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center text-xs text-muted-foreground">
                      {t('issues.emptyColumn')}
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {issues.map((issue) => row(issue))}
          </div>
        )}
        {nextOffset !== null && (
          <div className="p-5 text-center">
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => setPages((p) => p + 1)}
            >
              {t('issues.loadMore')}
            </Button>
          </div>
        )}
      </div>
      <IssueEditor
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(issue) => {
          setCreateOpen(false);
          selectIssue(issue.id);
          reload();
        }}
      />
    </div>
  );
}
