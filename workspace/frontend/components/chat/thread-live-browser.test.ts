// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  ws: { browserTabs: [] as any[], currentSessionId: 'dm:me,bot', activeSessionIds: new Set<string>(), refreshBrowserTabs: vi.fn() },
  layout: { selectedArtifact: null as any, showBrowserPreview: false },
  open: vi.fn(),
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => h.ws }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => h.layout }));
vi.mock('@/lib/thread-artifacts', () => ({ openArtifactPreview: h.open }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/artifacts/browser-thumbnail', () => ({ BrowserThumbnail: ({ tabId, refreshMs }: any) => React.createElement('span', { 'data-thumbnail': tabId, 'data-refresh': refreshMs }) }));
import { ThreadLiveBrowser } from './thread-live-browser';
let root: Root, host: HTMLDivElement;
const tab = (id = 'tab', channel = 'dm:me,bot') => ({ id, status: 'active', createdBy: 'openagents:bot', artifactChannels: [channel], url: 'https://example.com', liveUrl: 'https://browser.example/live', lastActiveAt: '2026-10-16T06:00:00Z' });
const render = async () => { await act(async () => root.render(React.createElement(ThreadLiveBrowser))); };
beforeEach(() => {
  vi.stubGlobal('React', React); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers(); vi.clearAllMocks();
  h.ws.browserTabs = []; h.ws.activeSessionIds = new Set(); h.ws.refreshBrowserTabs.mockResolvedValue(undefined);
  h.layout.selectedArtifact = null; h.layout.showBrowserPreview = false;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('shows only awake agent tabs whose latest association is this conversation', async () => {
  h.ws.browserTabs = [tab('other', 'other'), { ...tab('old', 'other'), artifactChannels: ['other','dm:me,bot'] }, { ...tab('closed'), status: 'closed' }, { ...tab('asleep'), asleep: true }, { ...tab('human'), createdBy: 'human:me' }];
  await render(); expect(host.querySelector('aside')).toBeNull();
  h.ws.browserTabs.push(tab()); await render();
  expect(host.querySelector('iframe')?.getAttribute('src')).toBe('https://browser.example/live?embed=1');
  expect(host.querySelector('iframe')?.hasAttribute('inert')).toBe(true);
});
it('minimizes without navigation, expands on request, and avoids duplicating the full browser', async () => {
  h.ws.browserTabs = [tab()]; await render();
  await act(async () => (host.querySelector('[aria-label="threadLiveBrowser.minimize"]') as HTMLButtonElement).click());
  expect(host.querySelector('iframe')).toBeNull(); expect(h.open).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('[title="threadLiveBrowser.restore"]') as HTMLButtonElement).click());
  expect(host.querySelector('iframe')).not.toBeNull();
  await act(async () => (host.querySelector('[aria-label="threadLiveBrowser.expand"]') as HTMLButtonElement).click());
  expect(h.open).toHaveBeenCalledWith({ kind: 'browser', id: 'tab' });
  h.layout.showBrowserPreview = true; h.layout.selectedArtifact = { kind: 'browser', id: 'tab' }; await render();
  expect(host.querySelector('aside')).toBeNull();
});
it('uses frequent authenticated screenshots when there is no live stream', async () => {
  h.ws.browserTabs = [{ ...tab(), liveUrl: null }]; await render();
  expect(host.querySelector('[data-thumbnail="tab"]')?.getAttribute('data-refresh')).toBe('2000');
});
it('discovers new browser activity while the agent works, and stops when it finishes', async () => {
  h.ws.activeSessionIds.add('dm:me,bot'); await render();
  expect(h.ws.refreshBrowserTabs).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(h.ws.refreshBrowserTabs).toHaveBeenCalledTimes(2);
  h.ws.activeSessionIds.clear(); await render();
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(h.ws.refreshBrowserTabs).toHaveBeenCalledTimes(2);
});
