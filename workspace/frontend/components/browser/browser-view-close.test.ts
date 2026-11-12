// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BrowserTab } from '@/lib/types';
const state = vi.hoisted(() => ({
  confirm: vi.fn(), close: vi.fn(), tabs: [] as unknown[], contexts: [] as unknown[],
  toast: vi.fn(),
}));
vi.mock('./use-browser-control', () => ({ useBrowserControl: () => ({ controlling: false, busy: false, toggle: vi.fn(), input: vi.fn(), frameRevision: 0 }) }));
vi.mock('./new-browser-tab-dialog', () => ({ NewBrowserTabDialog: () => null }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ isMobile: false }) }));
vi.mock('@/components/tours/feature-tour-banner', () => ({ FeatureTourBanner: () => null }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: () => null }));
vi.mock('@/lib/api', () => ({ ApiError: class extends Error {}, workspaceApi: { validateBrowserTab: async () => ({ connectionStatus: 'alive' }), getBrowserScreenshotUrl: () => '' } }));
vi.mock('sonner', () => ({ toast: { success: state.toast, error: vi.fn() } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgoShort: () => '' }) }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  browserTabs: state.tabs, browserContexts: state.contexts, browserTabLimits: null,
  agents: [{ agentName: 'scout', displayName: 'Scout' }],
  selectedBrowserTabId: null, setSelectedBrowserTabId: vi.fn(),
  selectedBrowserContextId: null, setSelectedBrowserContextId: vi.fn(),
  closeBrowserTab: state.close, navigateBrowserTab: vi.fn(), openBrowserTabWithContext: vi.fn(),
  deleteBrowserContext: vi.fn(), refreshBrowserTabs: vi.fn(),
}) }));
import { BrowserView } from './browser-view';

const tab = (over: Partial<BrowserTab>): BrowserTab => ({
  id: 't', url: 'https://example.com/', title: 'Example', status: 'active', createdBy: 'human:user',
  sharedWith: [], liveUrl: null, sessionId: 's', contextId: null, contextName: null, kind: 'temporary',
  activity: null, createdAt: null, lastActiveAt: null, ...over,
});

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.confirm.mockReset(); state.close.mockReset().mockResolvedValue(undefined); state.toast.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function clickClose(label: string) {
  await act(async () => root.render(React.createElement(BrowserView)));
  const chip = [...host.querySelectorAll('[role="tab"]')].find((el) => el.textContent?.includes(label))!;
  await act(async () => chip.querySelector<HTMLButtonElement>('button[aria-label="browser.closeTab"]')!.click());
}

it('asks before closing a temporary tab and keeps it when the user cancels', async () => {
  state.tabs = [tab({ id: 'tmp', title: 'Docs' })]; state.contexts = [];
  state.confirm.mockResolvedValue(false);
  await clickClose('Docs');
  expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: 'browser.closeTabTemporaryDescription' }));
  expect(state.close).not.toHaveBeenCalled();
});

it('asks before closing a tab an agent is working in, then closes on confirm', async () => {
  state.tabs = [tab({ id: 'live', contextId: 'c1', contextName: 'LinkedIn', kind: 'permanent',
    activity: { action: 'click', actor: 'openagents:scout', at: new Date().toISOString() } })];
  state.contexts = [{ id: 'c1', name: 'LinkedIn', domain: 'linkedin.com', status: 'active', createdBy: 'human:user', sharedWith: [], createdAt: null, lastUsedAt: null }];
  state.confirm.mockResolvedValue(true);
  await clickClose('LinkedIn');
  expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ description: 'browser.closeTabAgentSleepDescription' }));
  expect(state.close).toHaveBeenCalledWith('live');
});

it('puts an idle permanent tab to sleep in one click and says so', async () => {
  state.tabs = [tab({ id: 'live', contextId: 'c1', contextName: 'LinkedIn', kind: 'permanent' })];
  state.contexts = [{ id: 'c1', name: 'LinkedIn', domain: 'linkedin.com', status: 'active', createdBy: 'human:user', sharedWith: [], createdAt: null, lastUsedAt: null }];
  await clickClose('LinkedIn');
  expect(state.confirm).not.toHaveBeenCalled();
  expect(state.close).toHaveBeenCalledWith('live');
  expect(state.toast).toHaveBeenCalledWith('browser.sleptToast');
});
