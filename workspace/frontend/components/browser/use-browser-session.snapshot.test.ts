// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { BrowserTab } from '@/lib/types';
const api = vi.hoisted(() => ({ validateBrowserTab: vi.fn(), fetchBrowserScreenshot: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: api, ApiError: class extends Error {} }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { useBrowserSession } from './use-browser-session';
let root: Root, host: HTMLDivElement;
const revoke = vi.fn();
const base = { id: 'one', url: 'https://example.com', liveUrl: 'https://viewer.example/one', sharedWith: [] } as unknown as BrowserTab;
function Harness({ tab }: {tab: BrowserTab}) {
  const session = useBrowserSession({ selectedBrowserTabId: tab.id, tab, refreshBrowserTabs: async () => {}, controlling: false, frameRevision: 0 });
  return React.createElement('div', { 'data-dead': session.sessionDead }, session.screenshotUrl ? React.createElement('img', { alt: 'frame', src: session.screenshotUrl }) : null);
}
const render = (tab = base) => act(async () => root.render(React.createElement(Harness, { tab })));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  api.validateBrowserTab.mockReset().mockResolvedValue({ connectionStatus: 'alive' });
  api.fetchBrowserScreenshot.mockReset().mockImplementation(async () => new Response(new Blob(['frame'])));
  revoke.mockReset();
  let count = 0;
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return `blob:frame-${++count}`; } static revokeObjectURL(url: string) { revoke(url); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('keeps the last cloud frame on an outage and stops backup requests while unavailable', async () => {
  await render();
  expect(host.querySelector('img')?.src).toBe('blob:frame-1');
  api.validateBrowserTab.mockResolvedValue({connectionStatus: 'unknown'});
  api.fetchBrowserScreenshot.mockRejectedValue(new Error('offline'));
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(host.querySelector('[data-dead="true"]')).not.toBeNull();
  expect(host.querySelector('img')?.src).toBe('blob:frame-1');
  const count = api.fetchBrowserScreenshot.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
  expect(api.fetchBrowserScreenshot).toHaveBeenCalledTimes(count);
  expect(revoke).not.toHaveBeenCalledWith('blob:frame-1');
});
it('does not fetch screenshots from an already unavailable or sleeping cloud browser', async () => {
  api.validateBrowserTab.mockResolvedValue({connectionStatus: 'unknown'});
  await render();
  expect(api.fetchBrowserScreenshot).not.toHaveBeenCalled();
  api.validateBrowserTab.mockResolvedValue({connectionStatus: 'alive', asleep: true});
  await render({...base, id:'two'});
  expect(api.fetchBrowserScreenshot).not.toHaveBeenCalled();
});
it('never shows another tab’s frame and restores its own cached frame on return', async () => {
  await render();
  api.validateBrowserTab.mockResolvedValue({connectionStatus: 'unknown'});
  await render({...base, id: 'two'});
  expect(host.querySelector('img')).toBeNull();
  await render();
  expect(host.querySelector('img')?.src).toBe('blob:frame-1');
});
it('preserves a local frame through three failures and revokes it on unmount', async () => {
  await render({...base, liveUrl:''});
  api.fetchBrowserScreenshot.mockRejectedValue(new Error('offline'));
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(host.querySelector('[data-dead="true"]')).not.toBeNull();
  expect(host.querySelector('img')?.src).toBe('blob:frame-1');
  await act(async () => root.unmount());
  expect(revoke).toHaveBeenCalledWith('blob:frame-1');
  root = createRoot(host);
});
