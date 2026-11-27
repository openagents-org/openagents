// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useThreadViewState } from './use-thread-view-state';

let host: HTMLDivElement, root: Root;
let scope: [string, string, string];
let view: ReturnType<typeof useThreadViewState>;
let storage: Map<string, string>;
function Harness() { view = useThreadViewState(...scope); return null; }
const render = async () => { await act(async () => root.render(React.createElement(Harness))); };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
  scope = ['workspace', 'alice', 'thread-a'];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('restores independent artifact, sidebar and width choices across thread switches and reloads', async () => {
  await render();
  const saved = { selectedArtifact: { kind: 'file' as const, id: 'doc' }, previewOpen: true, sidebarOpen: false, conversationWidth: 36 };
  await act(async () => view.update(saved));
  scope[2] = 'thread-b'; await render();
  expect(view.state.selectedArtifact).toBeNull();
  await act(async () => view.update({ previewOpen: false }));
  scope[2] = 'thread-a'; await render(); expect(view.state).toMatchObject(saved);
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(view.state).toMatchObject(saved);
  scope[2] = 'thread-b'; await render(); expect(view.state.previewOpen).toBe(false);
});
it('keeps an opened, minimized or fullscreen browser for one visit only; switching back or reloading collapses it', async () => {
  const browser = { kind: 'browser' as const, id: 'tab' };
  for (const browserView of ['compact', 'minimized', 'fullscreen'] as const) {
    scope[2] = 'thread-a'; await render();
    await act(async () => view.update({ selectedBrowser: browser, browserView, browserWatchOnly: true }));
    expect(view.state).toMatchObject({ selectedBrowser: browser, browserView, browserWatchOnly: true });
    scope[2] = 'thread-b'; await render();
    expect(view.state).toMatchObject({ selectedBrowser: null, browserView: null, browserWatchOnly: false });
    scope[2] = 'thread-a'; await render();
    expect(view.state.selectedBrowser).toBeNull(); expect(view.state.browserView).toBeNull();
  }
  await act(async () => view.update({ selectedBrowser: browser, browserView: 'compact' }));
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(view.state.selectedBrowser).toBeNull();
  expect([...storage.values()].join('')).not.toContain('"tab"');
});
it('ignores browser choices stored by older versions', async () => {
  storage.set('oa-thread-view:["workspace","alice","thread-a"]', JSON.stringify({ version: 1, selectedBrowser: { kind: 'browser', id: 'tab' }, browserView: 'fullscreen', conversationWidth: 40 }));
  await render();
  expect(view.state).toMatchObject({ selectedBrowser: null, browserView: null, conversationWidth: 40 });
});
it('discards a late browser update from the thread the viewer already left', async () => {
  await render(); const stale = view.update;
  scope[2] = 'thread-b'; await render();
  await act(async () => stale({ selectedBrowser: { kind: 'browser', id: 'late' }, browserView: 'compact' }));
  expect(view.state.selectedBrowser).toBeNull();
  // Nor does it disturb a browser the viewer opened in the current thread.
  await act(async () => view.update({ selectedBrowser: { kind: 'browser', id: 'mine' }, browserView: 'minimized' }));
  await act(async () => stale({ browserView: 'closed', selectedBrowser: null }));
  expect(view.state).toMatchObject({ selectedBrowser: { id: 'mine' }, browserView: 'minimized' });
});
it('never opens a pinned browser on arrival', async () => {
  await render(); await act(async () => view.applyDefault({ kind: 'browser', id: 'pinned' }));
  expect(view.state.selectedBrowser).toBeNull(); expect(view.state.browserView).toBeNull();
});
it('isolates preferences by viewer and workspace', async () => {
  await render(); await act(async () => view.update({ previewOpen: true, conversationWidth: 32 }));
  scope[1] = 'bob'; await render(); expect(view.hasSavedView).toBe(false); expect(view.state.previewOpen).toBe(false);
  await act(async () => view.update({ conversationWidth: 70 }));
  scope[0] = 'other'; await render(); expect(view.state.conversationWidth).toBe(50);
  scope = ['workspace', 'alice', 'thread-a']; await render(); expect(view.state.conversationWidth).toBe(32);
});
it('uses the owner pin only as a default and never reopens a panel after manual Close', async () => {
  await render(); await act(async () => view.applyDefault({ kind: 'file', id: 'pin' }));
  expect(view.state.previewOpen).toBe(true); expect(view.hasSavedView).toBe(false);
  await act(async () => view.update({ previewOpen: false }));
  await act(async () => view.applyDefault({ kind: 'file', id: 'new-pin' }));
  expect(view.state.previewOpen).toBe(false); expect(view.state.selectedArtifact?.id).toBe('pin');
  await act(async () => root.unmount()); root = createRoot(host); await render();
  await act(async () => view.applyDefault({ kind: 'file', id: 'pin' })); expect(view.state.previewOpen).toBe(false);
});
it('keeps preferences in memory when storage is blocked and does not persist temporary browser URLs', async () => {
  await render();
  await act(async () => view.update({ selectedBrowser: { kind: 'browser', id: 'https://example.com/live/secret' } }));
  expect([...storage.values()].join('')).not.toContain('secret');
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } });
  await act(async () => view.update({ conversationWidth: 30 }));
  scope[2] = 'other'; await render(); scope[2] = 'thread-a'; await render(); expect(view.state.conversationWidth).toBe(30);
});
it('ignores corrupt storage and does not write before the viewer and thread are known', async () => {
  storage.set('oa-thread-view:["workspace","alice","thread-a"]', '{broken');
  await render(); expect(view.state.conversationWidth).toBe(50);
  scope[1] = ''; await render(); const size = storage.size;
  await act(async () => view.update({ previewOpen: true })); expect(storage.size).toBe(size);
});
