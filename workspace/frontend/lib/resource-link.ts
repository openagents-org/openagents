export type ResourceView = 'issues' | 'knowledge' | 'files';
export function resourcePath(workspace: string, view: ResourceView, id?: string | null): string {
  return `/${encodeURIComponent(workspace)}/${view}${id ? `/${encodeURIComponent(id)}` : ''}`;
}
/** Issue links use the short per-workspace number; the id still resolves. */
export function issueLinkId(issue: { id: string; number?: number | null }): string {
  return issue.number != null ? String(issue.number) : issue.id;
}
/** Links identify resources; their normal access checks still apply. */
export function requestedResource(location: string): { view: ResourceView; id: string | null } | null {
  try {
    const url = new URL(location, 'https://workspace.invalid');
    const path = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url;
    const match = path.pathname.match(/^\/[^/]+\/(issues|knowledge|files)(?:\/([^/]+))?\/?$/);
    if (match) return { view: match[1] as ResourceView, id: match[2] ? decodeURIComponent(match[2]) : null };
    for (const [key, view] of [['issue', 'issues'], ['knowledge', 'knowledge'], ['file', 'files']] as const) {
      const id = path.searchParams.get(key);
      if (id) return { view, id };
    }
    return null;
  } catch { return null; }
}

/** Views a link may ask the workspace to open on with `?view=`. */
export type LinkedView = 'connect';

/** Where a page's query lives: its own, or the desktop app's hash route (`#/slug?x=1`). */
function linkQuery(url: URL): { query: URLSearchParams; inHash: URL | null } {
  if (url.hash.startsWith('#/')) {
    // A fixed base: the desktop app's own scheme may have no usable origin.
    const inHash = new URL(url.hash.slice(1), 'https://workspace.invalid');
    return { query: inHash.searchParams, inHash };
  }
  return { query: url.searchParams, inHash: null };
}

/**
 * The view a link asks for (`/slug?view=connect` opens Manage Agents), or null.
 * Settings pages link back this way, since a view is not a route of its own.
 */
export function requestedView(location: string): LinkedView | null {
  try {
    const { query } = linkQuery(new URL(location, 'https://workspace.invalid'));
    return query.get('view') === 'connect' ? 'connect' : null;
  } catch { return null; }
}

/** The same location without `view=`, so a reload does not open that view again. */
export function withoutRequestedView(location: string): string {
  try {
    const url = new URL(location);
    const { query, inHash } = linkQuery(url);
    if (!query.has('view')) return location;
    query.delete('view');
    if (inHash) url.hash = `#${inHash.pathname}${inHash.search}`;
    return url.toString();
  } catch { return location; }
}
