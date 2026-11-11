import { resourcePath } from './resource-link';

export function requestedIssueBoard(location: string): string | null {
  try {
    const outer = new URL(location, 'https://workspace.invalid');
    const url = outer.hash.startsWith('#/') ? new URL(outer.hash.slice(1), outer.href) : outer;
    return url.searchParams.get('board')?.trim() || null;
  } catch { return null; }
}

/** Keep the selected issue and authentication parameters during navigation. */
export function withIssueBoard(location: string, boardId: string): URL {
  const outer = new URL(location);
  const hashRoute = outer.hash.startsWith('#/');
  const url = hashRoute ? new URL(outer.hash.slice(1), outer.href) : outer;
  url.searchParams.set('board', boardId);
  if (hashRoute) outer.hash = url.pathname + url.search;
  return outer;
}

/** Shared board links contain only the board identity, never session tokens. */
export function issueBoardPath(workspaceId: string, boardId: string): string {
  return `${resourcePath(workspaceId, 'issues')}?${new URLSearchParams({ board: boardId })}`;
}
