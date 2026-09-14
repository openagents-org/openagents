'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { loadWorkspaceSession } from '@/lib/workspace-session';
import { restorableRoute } from './navigation-state';

/**
 * The desktop build's router.
 *
 * The web app is a Next.js app-router application; the desktop build is the
 * same components served from a file the app ships with. That rules out
 * Next.js routing on two counts — there is no server to route, and the pages
 * are loaded over file:, where `history.pushState` to a different path throws.
 * So routing here is hash-based (`index.html#/acme/settings/members`) and the
 * `next/navigation` hooks are re-implemented on top of it.
 *
 * Deliberately hand-written rather than react-router: what is needed is four
 * hooks with Next.js's exact signatures, and matching a fixed table of routes.
 * A router library would have to be adapted to those signatures anyway.
 */

export interface RouteMatch {
  /** The matched pattern, e.g. `/:workspaceId/settings/:section`. */
  pattern: string;
  /** The path as it stands, e.g. `/acme/settings/members`. */
  pathname: string;
  params: Record<string, string>;
  search: URLSearchParams;
}

interface RouterValue extends RouteMatch {
  push: (href: string) => void;
  replace: (href: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
}

const RouterContext = createContext<RouterValue | null>(null);

/** Every route the desktop build serves, most specific first. */
export type RouteTable = Array<{
  pattern: string;
  render: (params: Record<string, string>) => React.ReactNode;
}>;

/** Read the current location out of the hash, defaulting to the root. */
function readLocation(): { pathname: string; search: URLSearchParams } {
  let raw = window.location.hash.replace(/^#/, '') || '/';
  if (raw === '/?desktop_resume=1') {
    try {
      const email = loadWorkspaceSession()?.email;
      raw = (email && restorableRoute(localStorage.getItem(`oa:desktop:route:${email}`))) || '/';
    } catch { raw = '/'; }
  }
  const [pathname, query = ''] = raw.split('?');
  return {
    pathname: pathname.startsWith('/') ? pathname : `/${pathname}`,
    search: new URLSearchParams(query),
  };
}

/**
 * Match a path against a pattern with `:name` segments.
 *
 * No wildcards and no optional segments: the table below is a fixed list of
 * the app's own routes, and anything fancier would be a feature nothing asks
 * for.
 */
function matchPattern(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export function DesktopRouter({
  routes,
  notFound,
}: {
  routes: RouteTable;
  notFound: React.ReactNode;
}): React.JSX.Element {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const sync = (): void => setLocation(readLocation());
    window.addEventListener('hashchange', sync);
    // A hash-less first load (file:///…/index.html) is the root route.
    if (!window.location.hash || window.location.hash === '#/?desktop_resume=1') {
      const restored = readLocation();
      const query = restored.search.toString();
      window.location.replace(`#${restored.pathname}${query ? '?' + query : ''}`);
    }
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    try {
      const email = loadWorkspaceSession()?.email;
      const route = restorableRoute(location.pathname + (location.search.size ? '?' + location.search : ''));
      if (email && route) localStorage.setItem(`oa:desktop:route:${email}`, route);
    } catch { /* Optional restore preference. */ }
  }, [location]);

  // Plain internal links in shared web pages follow the same hash router as
  // next/link. This keeps home/error links inside the embedded application.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element).closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute('download')) return;
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('/') || href.startsWith('//')) return;
      event.preventDefault();
      window.location.hash = href;
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const navigate = useCallback((href: string, replace: boolean) => {
    // Absolute URLs are not ours to route — the shell opens those externally.
    const target = href.startsWith('#') ? href : `#${href.startsWith('/') ? href : `/${href}`}`;
    if (replace) window.location.replace(target);
    else window.location.hash = target.slice(1);
  }, []);

  const matched = useMemo(() => {
    for (const route of routes) {
      const params = matchPattern(route.pattern, location.pathname);
      if (params) return { route, params };
    }
    return null;
  }, [routes, location.pathname]);

  const value = useMemo<RouterValue>(
    () => ({
      pattern: matched?.route.pattern ?? '',
      pathname: location.pathname,
      params: matched?.params ?? {},
      search: location.search,
      push: (href) => navigate(href, false),
      replace: (href) => navigate(href, true),
      back: () => window.history.back(),
      forward: () => window.history.forward(),
      // Next's refresh re-fetches server data; with no server, re-reading the
      // location is the closest honest equivalent.
      refresh: () => setLocation(readLocation()),
    }),
    [matched, location, navigate],
  );

  return (
    <RouterContext.Provider value={value}>
      <React.Fragment key={location.pathname}>{matched ? matched.route.render(matched.params) : notFound}</React.Fragment>
    </RouterContext.Provider>
  );
}

function useRouterValue(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('Router hooks must be used inside DesktopRouter');
  return value;
}

// ── The next/navigation surface the pages import ───────────────────────────
// Same names, same shapes. `useRouter().push('/acme')` works unchanged.

export function useRouter(): Pick<
  RouterValue,
  'push' | 'replace' | 'back' | 'forward' | 'refresh'
> & { prefetch: (href: string) => void } {
  const { push, replace, back, forward, refresh } = useRouterValue();
  return useMemo(
    // Nothing to prefetch when every route is already in the bundle.
    () => ({ push, replace, back, forward, refresh, prefetch: () => {} }),
    [push, replace, back, forward, refresh],
  );
}

export function usePathname(): string {
  return useRouterValue().pathname;
}

export function useSearchParams(): URLSearchParams {
  return useRouterValue().search;
}

export function useParams<T = Record<string, string>>(): T {
  return useRouterValue().params as T;
}
