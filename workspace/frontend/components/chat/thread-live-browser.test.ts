// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  ws: { browserTabs: [] as any[], currentSessionId: 'dm:me,bot', activeSessionIds: new Set<string>(), refreshBrowserTabs: vi.fn() },
  layout: { selectedArtifact: null as any, showBrowserPreview: false, setSelectedArtifact: vi.fn() },
  open: vi.fn(),
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => h.ws }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => h.layout }));
vi.mock('@/lib/thread-artifacts', () => ({ openArtifactPreview: h.open }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/artifacts/browser-thumbnail', () => ({ BrowserThumbnail: ({ tabId, refreshMs }: any) => React.createElement('span', { 'data-thumbnail': tabId, 'data-refresh': refreshMs }) }));
vi.mock('@/components/artifacts/browser-artifact-preview', () => ({ BrowserArtifactPreview: ({ tabId }: any) => React.createElement('div', { 'data-preview': tabId }) }));
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
  h.ws.browserTabs = [tab('other', 'other'), { ...tab('old', 'other'), artifactChannels: ['other','dm:me,bot'] }, { ...tab('closed'), status: 'closed' }, { ...tab('human'), createdBy: 'human:me' }];
  await render(); expect(host.querySelector('aside')).toBeNull();
  h.ws.browserTabs.push(tab()); await render();
  expect(host.querySelector('iframe')?.getAttribute('src')).toBe('https://browser.example/live?embed=1');
  expect(host.querySelector('iframe')?.hasAttribute('inert')).toBe(true);
});
it('keeps the stream mounted when minimized and expands over the conversation', async () => {
  h.ws.browserTabs = [tab()]; await render();
  await act(async () => (host.querySelector('[aria-label="threadLiveBrowser.minimize"]') as HTMLButtonElement).click());
  expect(host.querySelector('iframe')?.parentElement?.classList.contains('hidden')).toBe(true);
  await act(async () => (host.querySelector('[title="threadLiveBrowser.restore"]') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('[aria-label="threadLiveBrowser.expand"]') as HTMLButtonElement).click());
  expect(host.querySelector('[data-browser-overlay="fullscreen"][role="dialog"]')).not.toBeNull();
  expect(host.querySelector('[data-preview="tab"]')).not.toBeNull();
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('[data-browser-overlay="compact"]')).not.toBeNull();
});
it('opens a selected artifact in the overlay and supports returning from fullscreen', async () => {
  h.layout.selectedArtifact = { kind: 'browser', id: 'saved-tab' }; await render();
  expect(host.querySelector('[data-preview="saved-tab"]')).not.toBeNull();
  await act(async () => (host.querySelector('[aria-label="threadLiveBrowser.expand"]') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('[aria-label="threadLiveBrowser.collapse"]') as HTMLButtonElement).click());
  expect(host.querySelector('[data-browser-overlay="compact"]')).not.toBeNull();
  await act(async () => (host.querySelector('[aria-label="common.close"]') as HTMLButtonElement).click());
  expect(h.layout.setSelectedArtifact).toHaveBeenCalledWith(null);
});
it('automatically shows an agent live link even after its tab leaves the active list', async () => {
  const url = 'https://www.browserfabric.com/live/closed-session';
  const messages = [{ sessionId: 'dm:me,bot', senderType: 'agent', senderName: 'bot', messageType: 'chat', content: url }] as any;
  await act(async () => root.render(React.createElement(ThreadLiveBrowser, { messages })));
  expect(host.querySelector('[data-preview]')?.getAttribute('data-preview')).toBe(url);
  await act(async () => (host.querySelector('[aria-label="common.close"]') as HTMLButtonElement).click());
  expect(host.querySelector('aside')).toBeNull();
});
it('uses frequent authenticated screenshots when there is no live stream', async () => {
  h.ws.browserTabs = [{ ...tab(), liveUrl: null }]; await render();
  expect(host.querySelector('[data-thumbnail="tab"]')?.getAttribute('data-refresh')).toBe('2000');
});
it('shows an unassociated legacy tab explicitly linked in the current thread', async () => {
  h.ws.browserTabs = [{ ...tab(), artifactChannels: [] }];
  const messages = [{ sessionId: 'dm:me,bot', content: 'Watch https://browser.example/live', metadata: {} }] as any;
  await act(async () => root.render(React.createElement(ThreadLiveBrowser, { messages })));
  expect(host.querySelector('iframe')?.getAttribute('src')).toBe('https://browser.example/live?embed=1');
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
it('opens the current tab when a selected chat link predates a reconnect', async () => {
  const id = 'ac86e88a-be87-4c2b-b936-43524957a00d';
  h.ws.browserTabs = [{ ...tab(id), liveUrl: 'https://www.browserfabric.com/live/new-token' }];
  h.layout.selectedArtifact = { kind: 'browser', id: 'https://www.browserfabric.com/live/old-token' };
  const messages = [{ sessionId: 'dm:me,bot', senderType: 'agent', senderAddress: 'openagents:bot', messageType: 'chat', content: h.layout.selectedArtifact.id }] as any;
  await act(async () => root.render(React.createElement(ThreadLiveBrowser, { messages })));
  expect(host.querySelector('[data-preview]')?.getAttribute('data-preview')).toBe(id);
});

it('shows a reused human browser during tool work, then keeps the stable preview after link rotation', async () => {
  const id = '3100acd9-8150-4729-a2ff-af059d440335';
  h.ws.browserTabs = [{ ...tab(id), createdBy: 'human:user', artifactChannels: [], liveUrl: 'https://www.browserfabric.com/live/current' }];
  const messages: any[] = [{ sessionId: 'dm:me,bot', senderType: 'agent', senderAddress: 'openagents:bot', messageType: 'status', content: `Bash › TAB=${id}; curl "$B/v1/browser/tabs/$TAB/screenshot"` }];
  await act(async () => root.render(React.createElement(ThreadLiveBrowser, { messages })));
  expect(host.querySelector('[data-preview]')?.getAttribute('data-preview')).toBe(id);
  const expired = 'https://www.browserfabric.com/live/expired';
  messages.push({ sessionId: 'dm:me,bot', senderType: 'agent', senderAddress: 'openagents:bot', messageType: 'chat', content: expired });
  h.layout.selectedArtifact = {kind: 'browser', id: expired};
  await act(async () => root.render(React.createElement(ThreadLiveBrowser, { messages })));
  expect(host.querySelector('[data-preview]')?.getAttribute('data-preview')).toBe(id);
});
it('keeps sleeping associated tabs visible with the recovery controls', async () => {
  h.ws.browserTabs = [{ ...tab(), asleep: true }]; await render();
  expect(host.querySelector('[data-preview="tab"]')).not.toBeNull();
});
it('previews the last browser used before a reply, even when an older browser was refreshed later', async () => {
  const oldId = 'b74094a9-d5c9-4680-9c7a-1b694bc8ef51';
  const newId = 'a4d76856-7089-46fd-a4c9-a3a9447e277f';
  h.ws.browserTabs = [
    {...tab(oldId), artifactChannels:[], createdBy:'human:user', lastActiveAt:'2026-10-27T09:00:00Z'},
    {...tab(newId), artifactChannels:[], lastActiveAt:'2026-10-27T08:40:00Z'},
  ];
  const expired = 'https://www.browserfabric.com/live/old-token';
  const base = {sessionId:'dm:me,bot', senderType:'agent', senderAddress:'openagents:bot'};
  const messages: any[] = [
    {...base, messageType:'status', createdAt:'2026-10-27T08:40:00Z', content:`T=${oldId}; curl /v1/browser/tabs/$T/evaluate`},
    {...base, messageType:'status', createdAt:'2026-10-27T08:43:00Z', content:`T=${newId}; curl /v1/browser/tabs/$T/evaluate`},
    {...base, messageType:'chat', createdAt:'2026-10-27T08:44:00Z', content:expired},
  ];
  await act(async () => root.render(React.createElement(ThreadLiveBrowser, {messages})));
  expect(host.querySelector('[data-preview]')?.getAttribute('data-preview')).toBe(newId);
  h.layout.selectedArtifact = {kind:'browser', id:expired};
  await act(async () => root.render(React.createElement(ThreadLiveBrowser, {messages})));
  expect(host.querySelector('[data-preview]')?.getAttribute('data-preview')).toBe(newId);
});
