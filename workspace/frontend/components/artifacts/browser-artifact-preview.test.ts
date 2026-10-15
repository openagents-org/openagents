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
