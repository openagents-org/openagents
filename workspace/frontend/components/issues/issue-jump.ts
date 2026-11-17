import type { IssueStatus, WorkspaceIssue } from '@/lib/types';

export type IssueStatusTab = IssueStatus | 'all' | 'mine';

export interface IssueListFilters {
  status: IssueStatusTab;
  query: string;
  /** "" for anyone, "none" for unassigned, else "human:<email>" / "openagents:<agent>". */
  assignee: string;
}

const isActive = (status: IssueStatus) => status === 'open' || status === 'in_progress';
const same = (a: string | null | undefined, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();

/**
 * The list filters to use when jumping to `issue`: unchanged when the current
 * filters already list it, otherwise only the filters that hide it are moved.
 * A hidden active issue goes to "Active issues", any other to its own status.
 */
export function filtersShowingIssue(
  current: IssueListFilters,
  issue: Pick<WorkspaceIssue, 'status' | 'assignee' | 'title' | 'description'>,
  viewerEmail: string,
): IssueListFilters {
  const active = isActive(issue.status);
  const tabShows =
    current.status === 'all' ? active
      : current.status === 'mine' ? active && same(issue.assignee, `human:${viewerEmail}`)
        : current.status === issue.status;
  const status = tabShows ? current.status : active ? 'all' : issue.status;

  const assigneeShows =
    !current.assignee
    || (current.assignee === 'none' ? !issue.assignee : same(issue.assignee, current.assignee));

  const needle = current.query.trim().toLowerCase();
  const queryShows =
    !needle || `${issue.title}\n${issue.description ?? ''}`.toLowerCase().includes(needle);

  return {
    status,
    assignee: assigneeShows ? current.assignee : '',
    query: queryShows ? current.query : '',
  };
}
