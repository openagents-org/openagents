export type ResourceView = 'issues' | 'knowledge' | 'files';
export function resourcePath(workspace: string, view: ResourceView, id?: string | null): string {
  return `/${encodeURIComponent(workspace)}/${view}${id ? `/${encodeURIComponent(id)}` : ''}`;
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
