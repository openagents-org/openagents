/**
 * The launcher's Workspace tabs, as seen from the page in one of them.
 *
 * The launcher shows each workspace in its own view, plus one view for the
 * All Workspaces list. A page must therefore never route itself into another
 * workspace: picking one from the list, or switching workspaces from inside
 * one, is handed to the launcher, which brings that workspace's tab forward
 * or opens one. Off the desktop, or in a launcher without tabs, there is no
 * scope and every route stays in the page, as it always has.
 */

export type TabScope = { kind: 'home' } | { kind: 'workspace'; aliases: string[] };

interface TabBridge {
  tab?: () => TabScope | null;
  openRoute?: (route: string) => void;
  onNavigate?: (callback: (route: string) => void) => () => void;
}

function bridge(): TabBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __oaHost__?: TabBridge }).__oaHost__ ?? null;
}

/** Routes that are not any one workspace's and open wherever they are asked for. */
const SHARED = new Set(['invite', 'share', 'auth']);

/** The workspace a path belongs to; null for the list, undefined for neither. */
function owner(pathname: string): string | null | undefined {
  const first = pathname.split('/').filter(Boolean)[0];
  if (!first) return null;
  let segment: string;
  try { segment = decodeURIComponent(first); } catch { return undefined; }
  return SHARED.has(segment) ? undefined : segment;
}

/** Whether `pathname` belongs to a different tab than this page. */
export function belongsElsewhere(pathname: string, scope: TabScope | null): boolean {
  if (!scope) return false;
  const workspace = owner(pathname);
  if (workspace === undefined) return false;
  if (scope.kind === 'home') return workspace !== null;
  return workspace === null || !scope.aliases.includes(workspace);
}

/**
 * Give `route` to the launcher if it belongs to another tab. Returns whether
 * it did — the caller then leaves its own location as it is.
 */
export function handOffRoute(route: string): boolean {
  const host = bridge();
  if (!host?.openRoute) return false;
  const pathname = route.split('?')[0] || '/';
  if (!belongsElsewhere(pathname, host.tab?.() ?? null)) return false;
  host.openRoute(route);
  return true;
}

/** The launcher routed a deeper path of this workspace here. */
export function onHostNavigate(callback: (route: string) => void): () => void {
  return bridge()?.onNavigate?.(callback) ?? (() => {});
}
