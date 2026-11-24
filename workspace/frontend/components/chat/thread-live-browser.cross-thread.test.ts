// @vitest-environment jsdom
// Switching threads with the real per-thread view state and overlay selection:
// a shared tab driven from one thread must never surface in another.
import React, { act, createContext, useCallback, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useThreadViewState, type BrowserView } from '@/components/layout/use-thread-view-state';
import type { ArtifactReference } from '@/lib/thread-artifacts';

const h = vi.hoisted(() => ({
  ws: { workspace: { workspaceId: 'ws' }, currentUser: { id: 'me' }, browserTabs: [] as any[], currentSessionId: 'A', activeSessionIds: new Set<string>(), refreshBrowserTabs: vi.fn() },
  Layout: null as unknown as React.Context<any>,
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => h.ws }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => useContext(h.Layout) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/artifacts/browser-thumbnail', () => ({ BrowserThumbnail: ({ tabId }: any) => React.createElement('span', { 'data-thumbnail': tabId }) }));
vi.mock('@/components/artifacts/browser-artifact-preview', () => ({ BrowserArtifactPreview: ({ tabId }: any) => React.createElement('div', { 'data-preview': tabId }) }));
h.Layout = createContext<any>(null);
import { ThreadLiveBrowser } from './thread-live-browser';

let root: Root, host: HTMLDivElement;
let layout: any;
/** The same wiring as LayoutProvider + ChatView, without the rest of the app. */
function App() {
  const view = useThreadViewState(h.ws.workspace.workspaceId, h.ws.currentUser.id, h.ws.currentSessionId);
  const setBrowserView = useCallback((browserView: BrowserView, browser?: ArtifactReference, watchOnly = false) =>
    view.update({ browserView, browserWatchOnly: watchOnly, ...(browserView === 'closed' ? { selectedBrowser: null } : browser ? { selectedBrowser: browser } : {}) }), [view.update]);
  const openArtifact = useCallback((artifact: ArtifactReference) =>
    view.update({ selectedBrowser: artifact, browserView: 'compact', browserWatchOnly: false }), [view.update]);
  layout = { ...view.state, setBrowserView, openArtifact, applyDefault: view.applyDefault };
  return React.createElement(h.Layout.Provider, { value: layout },
    React.createElement(ThreadLiveBrowser, { key: `live-browser:${h.ws.currentSessionId}` }));
}
const render = async () => { await act(async () => root.render(React.createElement(App))); };
const visit = async (thread: string) => { h.ws.currentSessionId = thread; await render(); };
const shown = () => host.querySelector('aside');
const shared = (channel: string | undefined) => ({
  id: 'shared', status: 'active', createdBy: 'openagents:bot', artifactChannels: ['B', 'A'], url: 'https://example.com/post', title: 'Post',
  liveUrl: 'https://browser.example/live/shared', lastActiveAt: new Date().toISOString(),
  activity: { actor: 'openagents:bot', action: 'navigate', at: new Date().toISOString(), ...(channel ? { channel } : {}) },
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers();
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  h.ws.currentSessionId = 'A'; h.ws.browserTabs = []; h.ws.activeSessionIds = new Set(['B']);
  h.ws.refreshBrowserTabs.mockResolvedValue(undefined);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('shows B\'s live browser in B only, even after A opened, minimized or enlarged the same tab', async () => {
  // A's historical browser is the tab the agent is now reusing for B.
  h.ws.browserTabs = [shared('B')];
  for (const view of ['compact', 'minimized', 'fullscreen'] as const) {
    await visit('A');
    expect(shown()).toBeNull();
    await act(async () => layout.openArtifact({ kind: 'browser', id: 'shared' }));
    if (view !== 'compact') await act(async () => layout.setBrowserView(view, { kind: 'browser', id: 'shared' }));
    expect(shown()).not.toBeNull();
    await visit('B');
    expect(host.querySelector('iframe, [data-preview]')).not.toBeNull();
    await visit('A');
    expect(shown()).toBeNull();
  }
  // A reload of A stays collapsed too.
  await act(async () => root.unmount()); root = createRoot(host); await visit('A');
  expect(shown()).toBeNull();
});

it('keeps an idle thread collapsed through rapid round trips while B keeps its live view', async () => {
  h.ws.browserTabs = [shared('B')];
  for (let i = 0; i < 3; i++) {
    await visit('B'); expect(shown()).not.toBeNull();
    await visit('A'); expect(shown()).toBeNull();
  }
});

it('does not open a pinned browser on arrival, and opens it when clicked', async () => {
  h.ws.browserTabs = [shared('B')];
  await visit('A');
  await act(async () => layout.applyDefault({ kind: 'browser', id: 'shared' }));
  expect(shown()).toBeNull();
  await act(async () => layout.openArtifact({ kind: 'browser', id: 'shared' }));
  expect(host.querySelector('[data-preview="shared"]')).not.toBeNull();
});

it('does not follow unattributed activity into a running thread, and Close in B leaves A independent', async () => {
  h.ws.activeSessionIds = new Set(['A', 'B']);
  h.ws.browserTabs = [shared(undefined)];
  await visit('A'); expect(shown()).toBeNull();
  await visit('B'); expect(shown()).toBeNull();
  h.ws.browserTabs = [shared('B')]; await render();
  expect(shown()).not.toBeNull();
  await act(async () => (host.querySelector('[aria-label="common.close"]') as HTMLButtonElement).click());
  expect(shown()).toBeNull();
  await visit('A'); await visit('B'); expect(shown()).toBeNull();
  h.ws.browserTabs = [{ ...shared('A'), artifactChannels: ['A', 'B'] }];
  await visit('A'); expect(shown()).not.toBeNull();
});
