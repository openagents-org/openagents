'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceIssue } from '@/lib/types';
import { errorMessage } from './issue-ui';
import type { IssueStatusFilter } from './issues-toolbar';

interface IssueListFilters {
  status: IssueStatusFilter;
  query: string;
  assignee: string;
  boardId: string;
}

/**
 * Loads `pages` pages of issues for the filters, polls every 15s, and drops
 * responses that a newer request (or a local delete) has overtaken.
 */
export function useIssueList({ status, query, assignee, boardId }: IssueListFilters) {
  const activeOnly = status === 'all' || status === 'mine';
  const [issues, setIssues] = useState<WorkspaceIssue[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [pages, setPages] = useState(1);
  const requestVersion = useRef(0);
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  /** Clear the list before a filter or board change so stale rows don't flash. */
  const resetList = useCallback(() => { setIssues([]); setNextOffset(null); setPages(1); }, []);
  /** Drop a poll in flight: it may still list a just-deleted issue. */
  const invalidate = useCallback(() => { ++requestVersion.current; }, []);

  // <Activity> re-runs this when Issues is shown again with the same filters:
  // refresh in the background instead of flipping back into a loading state.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const loadKey = JSON.stringify([status, activeOnly, query, assignee, revision, pages, boardId]);
    if (loadedFor.current !== loadKey) setLoading(true);
    const load = async () => {
      const version = ++requestVersion.current;
      try {
        const batches = await Promise.all(
          Array.from({ length: pages }, (_, page) =>
            workspaceApi.listIssues({
              status: status === 'all' || status === 'mine' ? undefined : status,
              assignedToMe: status === 'mine',
              assignee: assignee || undefined,
              activeOnly,
              query,
              board: boardId,
              offset: page * 100,
            }),
          ),
        );
        const result = {
          issues: Array.from(new Map(batches.flatMap((batch) => batch.issues).map((issue) => [issue.id, issue])).values()),
          next_offset: batches.at(-1)!.next_offset,
        };
        if (!active || version !== requestVersion.current) return;
        setIssues(result.issues);
        setNextOffset(result.next_offset);
        setError('');
        loadedFor.current = loadKey;
      } catch (e) {
        if (active && version === requestVersion.current) setError(errorMessage(e));
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
  }, [status, activeOnly, query, assignee, revision, pages, boardId]);

  return { issues, setIssues, error, loading, nextOffset, setNextOffset, setPages, reload, resetList, invalidate };
}
