'use client';

/**
 * The tab strip and the sidebar list render the same thing: every permanent
 * tab (a saved context, awake or asleep) followed by every temporary tab.
 * Building that once here keeps the two views from drifting apart.
 */

import type { BrowserPersistentContext, BrowserTab } from '@/lib/types';

export interface PermanentEntry {
  kind: 'permanent';
  key: string;
  context: BrowserPersistentContext;
  /** The live session, when the tab is awake. */
  tab: BrowserTab | null;
}

export interface TemporaryEntry {
  kind: 'temporary';
  key: string;
  tab: BrowserTab;
}

export type TabEntry = PermanentEntry | TemporaryEntry;

export function buildTabEntries(tabs: BrowserTab[], contexts: BrowserPersistentContext[]): {
  permanent: PermanentEntry[];
  temporary: TemporaryEntry[];
} {
  const liveByContext = new Map<string, BrowserTab>();
  for (const t of tabs) if (t.contextId) liveByContext.set(t.contextId, t);

  const permanent: PermanentEntry[] = contexts.map((context) => ({
    kind: 'permanent',
    key: `ctx:${context.id}`,
    context,
    tab: liveByContext.get(context.id) ?? null,
  }));

  // A live tab whose context row is missing (deleted elsewhere, listing lag)
  // still needs a home — treat it as permanent with what the tab knows.
  const known = new Set(contexts.map((c) => c.id));
  for (const t of tabs) {
    if (t.contextId && !known.has(t.contextId)) {
      permanent.push({
        kind: 'permanent',
        key: `ctx:${t.contextId}`,
        context: {
          id: t.contextId,
          name: t.contextName || t.title || hostOf(t.url),
          domain: hostOf(t.url),
          status: 'active',
          createdBy: t.createdBy,
          sharedWith: t.sharedWith,
          createdAt: t.createdAt,
          lastUsedAt: t.lastActiveAt,
        },
        tab: t,
      });
    }
  }

  const temporary: TemporaryEntry[] = tabs
    .filter((t) => !t.contextId)
    .map((tab) => ({ kind: 'temporary', key: `tab:${tab.id}`, tab }));

  return { permanent, temporary };
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const h = new URL(url).hostname;
    return h.startsWith('www.') ? h.slice(4) : h;
  } catch {
    return url;
  }
}

export function displayUrl(url: string, max = 48): string {
  try {
    const u = new URL(url);
    const display = u.hostname + (u.pathname !== '/' ? u.pathname : '') + (u.search || '');
    return display.length > max ? display.slice(0, max) + '…' : display;
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url;
  }
}

export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/** Minutes until the idle sweeper closes a temporary tab, floored at 0. */
export function idleMinutesLeft(tab: BrowserTab, idleMinutes: number, now = Date.now()): number {
  const last = tab.lastActiveAt ? Date.parse(tab.lastActiveAt) : NaN;
  if (!Number.isFinite(last)) return idleMinutes;
  return Math.max(0, Math.round(idleMinutes - (now - last) / 60_000));
}

/** Strip the `human:` / `openagents:` prefix for display. */
export function whoLabel(source: string | null | undefined): string {
  return (source || 'unknown').replace(/^(openagents:|human:)/, '');
}
