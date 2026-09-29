/**
 * Server-renders the browser view and the sidebar list in their main states.
 * No DOM is available here, so this is not a visual check — it proves the
 * components render without throwing, resolve every i18n key, and put the
 * right words on screen for each state (kinds, quota, asleep, agent driving).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { messages as en } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { BrowserPersistentContext, BrowserTab, BrowserTabLimits } from '@/lib/types';

// ── mutable state the mocked hooks read ────────────────────────────────────
const ws: Record<string, unknown> = {};
const noop = async () => undefined;
function resetWs() {
  Object.assign(ws, {
    browserTabs: [] as BrowserTab[],
    browserContexts: [] as BrowserPersistentContext[],
    browserTabLimits: null as BrowserTabLimits | null,
    agents: [{ agentName: 'scout', displayName: 'Scout' }],
    selectedBrowserTabId: null,
    setSelectedBrowserTabId: () => {},
    selectedBrowserContextId: null,
    setSelectedBrowserContextId: () => {},
    closeBrowserTab: noop, navigateBrowserTab: noop, reconnectBrowserTab: noop,
    persistBrowserTab: noop, unpersistBrowserTab: noop, openBrowserTabWithContext: noop,
    deleteBrowserContext: noop, refreshBrowserTabs: noop, openBrowserTab: noop,
  });
}

vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ws }));
vi.mock('@/components/layout/layout-context', () => ({
  useLayout: () => ({
    isMobile: false, openMobileDetail: () => {}, openMobileList: () => {},
    isDetailExpanded: false, toggleDetailExpanded: () => {},
  }),
}));
vi.mock('@/lib/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => translate(en, en, 'en-US', key, params),
  useFormatters: () => ({ timeAgoShort: () => '2m ago' }),
}));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => async () => true, usePrompt: () => async () => null }));
vi.mock('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock('@/components/tours/feature-tours', () => ({ FeatureTourBanner: () => null }));
vi.mock('@/components/layout/app-header', () => ({
  DetailHeader: ({ title, children }: { title: unknown; children?: unknown }) =>
    createElement('div', { 'data-slot': 'detail-header' }, title as never, children as never),
}));
vi.mock('@/lib/api', () => ({ workspaceApi: { validateBrowserTab: noop, getBrowserScreenshotUrl: () => '' } }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

const { BrowserView } = await import('./browser-view');
const { BrowserTabList } = await import('./browser-tab-list');

const render = (C: () => unknown) => renderToString(createElement(C as never));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

const tab = (over: Partial<BrowserTab>): BrowserTab => ({
  id: 't', url: 'https://www.example.com/', title: 'Example', status: 'active', createdBy: 'human:user',
  sharedWith: [], liveUrl: 'https://www.browserfabric.com/live/abc', sessionId: 's', contextId: null,
  contextName: null, kind: 'temporary', activity: null, createdAt: null, lastActiveAt: new Date().toISOString(), ...over,
});
const ctx = (over: Partial<BrowserPersistentContext>): BrowserPersistentContext => ({
  id: 'c', name: 'LinkedIn', domain: 'linkedin.com', status: 'active', createdBy: 'human:user',
  sharedWith: [], createdAt: null, lastUsedAt: null, ...over,
});
const limits: BrowserTabLimits = { permanent: { used: 1, max: 5 }, temporary: { used: 1, max: 3 }, temporaryIdleMinutes: 30 };

let warnings: string[] = [];
beforeEach(() => {
  resetWs();
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => { warnings.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});
const noMissingKeys = () => expect(warnings.filter((w) => w.includes('[i18n]'))).toEqual([]);

describe('BrowserView', () => {
  it('renders the empty cloud browser', () => {
    const out = text(render(BrowserView));
    expect(out).toContain('Your cloud browser is empty');
    expect(out).toContain('New tab');
    noMissingKeys();
  });

  it('renders permanent + temporary tabs, quota, agent driving and take-over', () => {
    const live = tab({ id: 'live', contextId: 'c1', contextName: 'LinkedIn', kind: 'permanent', createdBy: 'openagents:scout',
      activity: { action: 'click', actor: 'openagents:scout', at: new Date().toISOString() } });
    const temp = tab({ id: 'tmp', title: 'Docs' });
    Object.assign(ws, {
      browserTabs: [live, temp],
      browserContexts: [ctx({ id: 'c1' }), ctx({ id: 'c2', name: 'GitHub', domain: 'github.com' })],
      browserTabLimits: limits,
      selectedBrowserTabId: 'live',
    });
    const html = render(BrowserView);
    const out = text(html);
    // No tab strip inside the view: switching tabs and the quota live in
    // BrowserTabList beside it, so the other tabs are not rendered here.
    expect(html).not.toContain('role="tab"');
    expect(out).not.toContain('GitHub');
    expect(out).not.toContain('Docs');
    expect(out).not.toMatch(/1\s*\/\s*5/);
    // the selected permanent tab still names its context in the header
    expect(out).toContain('LinkedIn');
    // address bar + status bar
    expect(out).toContain('https://www.example.com/');
    expect(out).toContain('Permanent tab');
    expect(out).toContain('Live');
    // agent presence + control layer
    expect(out).toContain('Scout is clicking');
    expect(out).toContain('Take over');
    // embedded chrome-less live view
    expect(html).toContain('browserfabric.com/live/abc?embed=1');
    noMissingKeys();
  });

  it('renders a temporary tab with its idle countdown and the pin-to-keep affordance', () => {
    const temp = tab({ id: 'tmp', title: 'Docs', lastActiveAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    Object.assign(ws, { browserTabs: [temp], browserTabLimits: limits, selectedBrowserTabId: 'tmp' });
    const out = text(render(BrowserView));
    expect(out).toContain('Temporary tab');
    expect(out).toMatch(/closes in (19|20) min if idle/);
    expect(out).toContain('Make permanent');
    noMissingKeys();
  });

  it('renders the asleep state for a permanent tab without a session', () => {
    Object.assign(ws, { browserContexts: [ctx({ id: 'c2', name: 'GitHub', domain: 'github.com' })], selectedBrowserContextId: 'c2' });
    const out = text(render(BrowserView));
    expect(out).toContain('This tab is asleep');
    expect(out).toContain('Wake');
    expect(out).toContain('github.com');
    noMissingKeys();
  });
});

describe('BrowserTabList', () => {
  it('renders the empty state', () => {
    const out = text(render(BrowserTabList));
    expect(out).toContain('Your cloud browser is empty');
    noMissingKeys();
  });

  it('separates permanent and temporary sections with quota, asleep rows and agent chips', () => {
    const live = tab({ id: 'live', contextId: 'c1', kind: 'permanent',
      activity: { action: 'type', actor: 'openagents:scout', at: new Date().toISOString() } });
    Object.assign(ws, {
      browserTabs: [live, tab({ id: 'tmp', title: 'Docs', createdBy: 'openagents:scout' })],
      browserContexts: [ctx({ id: 'c1' }), ctx({ id: 'c2', name: 'GitHub' })],
      browserTabLimits: limits,
    });
    const out = text(render(BrowserTabList));
    expect(out).toContain('Permanent');
    expect(out).toContain('Temporary');
    expect(out).toContain('Asleep');
    expect(out).toContain('Scout is browsing');
    expect(out).toMatch(/1\s*\/\s*5/);
    expect(out).toMatch(/1\s*\/\s*3/);
    expect(out).toContain('closes in');
    noMissingKeys();
  });
});
