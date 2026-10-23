// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workspaceApi } from '@/lib/api';
const state = vi.hoisted(() => ({ tabs: [] as any[], refresh: vi.fn(async () => {}) }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ browserTabs: state.tabs, refreshBrowserTabs: state.refresh }) }));
vi.mock('@/lib/openagents-auth-context', () => ({ useOpenAgentsAuth: () => ({ idToken: 'viewer' }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/browser/browser-view', () => ({ BrowserView: ({artifactTabId}: any) => React.createElement('div', {'data-live-tab': artifactTabId}, 'Live browser') }));
import { BrowserArtifactPreview } from './browser-artifact-preview';
let host: HTMLDivElement, root: Root;
const closed = { id: 'tab', title: 'Example Domain', url: 'https://example.com', status: 'closed' } as any;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.tabs = []; state.refresh.mockReset().mockResolvedValue(undefined);
  vi.spyOn(workspaceApi, 'getBrowserTab').mockResolvedValue(closed);
  vi.spyOn(workspaceApi, 'reconnectBrowserTab').mockImplementation(async () => {
    const tab = { ...closed, status: 'active' }; state.tabs = [tab]; vi.mocked(workspaceApi.getBrowserTab).mockResolvedValue(tab); return tab;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = () => act(async () => root.render(React.createElement(BrowserArtifactPreview, { tabId: 'tab', revision: 0 })));
it('explains a closed session without automatically opening it, and reopens the same artifact on request', async () => {
  await render();
  expect(host.textContent).toContain('artifactPanel.browserClosed');
  expect(host.textContent).toContain('Example Domain');
  expect(workspaceApi.reconnectBrowserTab).not.toHaveBeenCalled();
  await act(async () => host.querySelector('button')!.click());
  expect(workspaceApi.reconnectBrowserTab).toHaveBeenCalledWith('tab', true);
  expect(host.querySelector('[data-live-tab="tab"]')).not.toBeNull();
});
it('keeps a failed reopen retryable', async () => {
  vi.mocked(workspaceApi.reconnectBrowserTab).mockRejectedValue(new Error('offline'));
  await render(); await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('artifactPanel.reopenFailed');
  expect(host.querySelector('button')?.disabled).toBe(false);
});
it('does not disclose saved metadata or offer reopen when access fails', async () => {
  vi.mocked(workspaceApi.getBrowserTab).mockRejectedValue(new Error('forbidden'));
  await render();
  expect(host.textContent).toContain('artifactPanel.unavailable');
  expect(host.textContent).not.toContain('Example Domain');
  expect(host.querySelector('button')).toBeNull();
});

it('resolves a live link to its closed artifact and reopens only on request', async () => {
  const liveUrl = 'https://www.browserfabric.com/live/old-session';
  vi.spyOn(workspaceApi, 'listBrowserTabs').mockResolvedValue({ tabs: [{ ...closed, liveUrl }] } as any);
  await act(async () => root.render(React.createElement(BrowserArtifactPreview, { tabId: liveUrl, revision: 0 })));
  expect(workspaceApi.listBrowserTabs).toHaveBeenCalledWith('closed');
  expect(workspaceApi.getBrowserTab).toHaveBeenCalledWith('tab');
  expect(host.textContent).toContain('artifactPanel.browserClosed');
  expect(workspaceApi.reconnectBrowserTab).not.toHaveBeenCalled();
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('[data-live-tab="tab"]')).not.toBeNull();
});
it('embeds an unmatched shared live link without using it as a tab UUID', async () => {
  const liveUrl = 'https://www.browserfabric.com/live/shared-session';
  vi.spyOn(workspaceApi, 'listBrowserTabs').mockResolvedValue({ tabs: [] } as any);
  await act(async () => root.render(React.createElement(BrowserArtifactPreview, { tabId: liveUrl, revision: 0 })));
  expect(host.querySelector('iframe')?.getAttribute('src')).toBe(liveUrl + '?embed=1');
  expect(workspaceApi.getBrowserTab).not.toHaveBeenCalled();
  expect(workspaceApi.reconnectBrowserTab).not.toHaveBeenCalled();
});
