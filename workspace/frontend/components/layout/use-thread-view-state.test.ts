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
it('restores independent artifact, browser, sidebar and width choices across thread switches and reloads', async () => {
  await render();
  const saved = { selectedArtifact: { kind: 'file' as const, id: 'doc' }, selectedBrowser: { kind: 'browser' as const, id: 'tab' }, previewOpen: true, browserView: 'minimized' as const, sidebarOpen: false, conversationWidth: 36 };
  await act(async () => view.update(saved));
  scope[2] = 'thread-b'; await render();
  expect(view.state.selectedArtifact).toBeNull(); expect(view.state.browserView).toBeNull();
  await act(async () => view.update({ previewOpen: false, browserView: 'closed' }));
  scope[2] = 'thread-a'; await render(); expect(view.state).toMatchObject(saved);
  await act(async () => root.unmount()); root = createRoot(host); await render();
  expect(view.state).toMatchObject(saved);
  scope[2] = 'thread-b'; await render(); expect(view.state.browserView).toBe('closed'); expect(view.state.previewOpen).toBe(false);
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
  await act(async () => view.update({ browserView: 'closed' }));
  scope[2] = 'other'; await render(); scope[2] = 'thread-a'; await render(); expect(view.state.browserView).toBe('closed');
});
it('ignores corrupt storage and does not write before the viewer and thread are known', async () => {
  storage.set('oa-thread-view:["workspace","alice","thread-a"]', '{broken');
  await render(); expect(view.state.conversationWidth).toBe(50);
  scope[1] = ''; await render(); const size = storage.size;
  await act(async () => view.update({ previewOpen: true })); expect(storage.size).toBe(size);
});
