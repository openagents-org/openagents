'use client';

import { useLayout } from '@/components/layout/layout-context';
import { issueLinkId, requestedResource, resourcePath } from '@/lib/resource-link';
import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { unreadIssueCounts } from '@/lib/signals';
import { useT } from '@/lib/i18n';
import { shareOrigin } from '@/lib/share-origin';
import type { IssueStatus, WorkspaceIssue } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DetailHeader } from '@/components/layout/app-header';
import { IssueEditor } from './issue-editor';
import { IssueDiscussion } from './issue-discussion';
import { IssueBoardTabs, useIssueBoards } from './issue-boards';
import { IssueRow } from './issue-row';
import { IssueBoardColumns, IssuesEmpty } from './issue-list-states';
import { IssuesToolbar, type IssueStatusFilter, type IssueViewMode } from './issues-toolbar';
import { useIssueList } from './use-issue-list';
import { ErrorNotice, IssueSkeleton, errorMessage, useConfirmIssueDelete } from './issue-ui';

export function IssuesView() {
  const { workspace } = useWorkspace();
  // A workspace switch must discard selection and pending requests.
  return <IssueWorkspace key={workspace?.workspaceId} />;
}

function IssueWorkspace() {
  const { unreadSignals, workspace } = useWorkspace();
  const { boards, boardId, setBoardId, reloadBoards } = useIssueBoards(workspace?.workspaceId);
  const unreadByIssue = unreadIssueCounts(unreadSignals);
  const { pendingIssueId, setPendingIssueId } = useLayout();
  const t = useT();
  const confirmDelete = useConfirmIssueDelete();
  const [selected, setSelected] = useState<string | null>(() =>
    typeof window === 'undefined'
      ? null
      : (requestedResource(window.location.href)?.view === 'issues' ? requestedResource(window.location.href)?.id ?? null : null),
  );
  const selectedRef = useRef(selected);
  // Filled from the list hook below; read by callbacks, not during render.
  const issuesRef = useRef<WorkspaceIssue[]>([]);
  const boardIdRef = useRef(boardId);
  boardIdRef.current = boardId;
  const writeIssueUrl = (linkId: string | null, nextBoardId: string) => {
    const outer = new URL(window.location.href);
    const isHashRoute = outer.hash.startsWith('#/');
    const url = isHashRoute ? new URL(outer.hash.slice(1), outer.href) : outer;
    url.pathname = resourcePath(decodeURIComponent(url.pathname.split('/')[1]), 'issues', linkId);
    for (const key of ['issue', 'thread', 'knowledge', 'file']) url.searchParams.delete(key);
    url.searchParams.set('board', nextBoardId);
    if (isHashRoute) { outer.hash = url.pathname + url.search; }
    window.history.replaceState(window.history.state, '', isHashRoute ? outer : url);
  };
  // `id` may be an issue id or a link number; state always keeps the id and
  // the URL the short number.
  const selectIssue = (id: string | null, nextBoardId = boardId) => {
    const known = id ? issuesRef.current.find((i) => i.id === id || (i.number != null && String(i.number) === id)) : undefined;
    const next = known?.id ?? id;
    selectedRef.current = next;
    writeIssueUrl(known ? issueLinkId(known) : id, nextBoardId);
    setSelected(next);
  };
  // An issue outside the loaded list (a numbered deep link, a notification):
  // look it up once to learn both its id and its number.
  useEffect(() => {
    if (!selected || issuesRef.current.some((i) => i.id === selected)) return;
    let cancelled = false;
    workspaceApi.getIssue(selected).then((issue) => {
      if (cancelled || selectedRef.current !== selected) return;
      if (issue.id !== selected && String(issue.number) !== selected) return;
      selectedRef.current = issue.id;
      writeIssueUrl(issueLinkId(issue), boardIdRef.current);
      setSelected(issue.id);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selected]);
  useEffect(() => {
    if (!pendingIssueId) return;
    selectIssue(pendingIssueId);
    setPendingIssueId(null);
  }, [pendingIssueId, setPendingIssueId]);
  useEffect(() => { if (!pendingIssueId) selectIssue(selected); }, []); // Normalize legacy issue links.
  const [createOpen, setCreateOpen] = useState(false);
  const [view, setView] = useState<IssueViewMode>('list');
  const board = view === 'board';
  const split = view === 'list' && selected !== null;
  const [status, setStatus] = useState<IssueStatusFilter>('all');
  const activeOnly = status === 'all' || status === 'mine';
  const boardStatuses: IssueStatus[] = activeOnly ? ['open', 'in_progress'] : [status as IssueStatus];
  const [query, setQuery] = useState('');
  const [assignee, setAssignee] = useState('');
  const { issues, setIssues, error, loading, nextOffset, setPages, reload, resetList, invalidate } = useIssueList({ status, query, assignee, boardId });
  issuesRef.current = issues;
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copiedIssue, setCopiedIssue] = useState<string | null>(null);
  const copyIssueLink = async (issue: WorkspaceIssue) => {
    try {
      const url = new URL(resourcePath(workspace?.slug || workspace?.workspaceId || '', 'issues', issueLinkId(issue)), shareOrigin());
      url.searchParams.set('board', boardId);
      await navigator.clipboard.writeText(url.toString());
      setCopiedIssue(issue.id);
      toast.success(t('common.copied'));
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const removeIssue = async (issue: WorkspaceIssue) => {
    if (deleting || !(await confirmDelete(issue.title))) return;
    setDeleting(issue.id);
    try {
      await workspaceApi.deleteIssue(issue.id);
      // Drop a poll in flight: it may still list the issue.
      invalidate();
      setIssues((current) => current.filter((i) => i.id !== issue.id));
      if (selectedRef.current === issue.id) selectIssue(null);
      reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDeleting(null);
    }
  };

  const row = (issue: WorkspaceIssue, asCard = false) => (
    <IssueRow
      key={issue.id}
      issue={issue}
      asCard={asCard}
      isSelected={split && selected === issue.id}
      unread={unreadByIssue[issue.id] || 0}
      copied={copiedIssue === issue.id}
      deleting={deleting === issue.id}
      onSelect={() => selectIssue(issue.id)}
      onCopyLink={() => void copyIssueLink(issue)}
      onDelete={() => void removeIssue(issue)}
    />
  );

  if (selected && !split)
    return (
      <IssueDiscussion
        key={selected}
        id={selected}
        onBack={() => {
          selectIssue(null);
          reload();
          void reloadBoards();
        }}
        onChanged={reload}
      />
    );
  return (
    <div className="@container/issues flex h-full min-h-0 min-w-0 flex-col bg-background">
      <DetailHeader
        titleInHeader
        title={<h1 className="truncate text-sm font-semibold">{t('views.issues')}</h1>}
      >
        <Button size="sm" className="shrink-0" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" />
          {t('issues.newIssue')}
        </Button>
      </DetailHeader>
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-border/70 px-5 pt-3 sm:px-8">
        <div className="w-full min-w-0">
          <IssueBoardTabs
            boards={boards}
            boardId={boardId}
            workspaceId={workspace?.slug || workspace?.workspaceId || ''}
            onSelect={(id) => {
              if (id === boardId) return;
              setBoardId(id);
              resetList();
              selectIssue(null, id);
            }}
            onChanged={(selectId) => {
              void reloadBoards();
              if (selectId && selectId !== boardId) { setBoardId(selectId); resetList(); selectIssue(null, selectId); }
              reload();
            }}
          />
        </div>
        <IssuesToolbar
          status={status}
          onStatus={(next) => { if (next === status) return; setStatus(next); resetList(); }}
          assignee={assignee}
          onAssignee={(next) => { if (next === assignee) return; setAssignee(next); resetList(); }}
          query={query}
          onQuery={(next) => { setQuery(next); setPages(1); }}
          view={view}
          onView={(next) => { setView(next); selectIssue(null); }}
        />
      </div>
      <div className="flex min-h-0 flex-1">
      <div className={cn('min-h-0 min-w-0 flex-1 overflow-auto', split && '@3xl/issues:w-[36%] @3xl/issues:max-w-105 @3xl/issues:flex-none @3xl/issues:border-r', split && selected && 'hidden @3xl/issues:block')} aria-label={t('issues.list')} aria-busy={loading}>
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
          <IssuesEmpty filtered={!!(query || assignee || status !== 'all')} onCreate={() => setCreateOpen(true)} />
        ) : board ? (
          <IssueBoardColumns statuses={boardStatuses} issues={issues} card={(issue) => row(issue, true)} />
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
      {split && <section aria-label={t('issues.discussion')} className={cn('min-h-0 min-w-0 flex-1', !selected && 'hidden @3xl/issues:block')}>
        {selected ? <IssueDiscussion
          key={selected}
          id={selected}
          embedded
          onBack={() => { selectIssue(null); reload(); void reloadBoards(); }}
          onChanged={reload}
        /> : <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">{t('issues.selectIssue')}</div>}
      </section>}
      </div>
      <IssueEditor
        open={createOpen}
        onOpenChange={setCreateOpen}
        boardId={boardId}
        onSaved={(issue) => {
          setCreateOpen(false);
          selectIssue(issue.id);
          reload();
          void reloadBoards();
        }}
      />
    </div>
  );
}
