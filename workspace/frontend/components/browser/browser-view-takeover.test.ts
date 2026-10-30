// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ active: false, toggle: vi.fn() }));
vi.mock('./use-browser-control', () => ({ useBrowserControl: () => ({ controlling: false, busy: false, toggle: state.toggle, input: vi.fn(), frameRevision: 0 }) }));
vi.mock('./agent-activity', () => ({ actorName: () => null, useAgentActivity: () => ({ active: state.active, action: 'click' }) }));
vi.mock('./new-browser-tab-dialog', () => ({ NewBrowserTabDialog: () => null }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ isMobile: false }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key, useFormatters: () => ({ timeAgoShort: () => '' }) }));
vi.mock('@/lib/api', () => ({ workspaceApi: { validateBrowserTab: vi.fn(async () => ({ connectionStatus: 'alive', asleep: false })) } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  browserTabs: [{ id: 'tab', url: 'https://example.com', title: 'Example', sharedWith: [], createdBy: 'human:user', liveUrl: 'https://bf.example/live/abc' }],
  browserContexts: [], agents: [], refreshBrowserTabs: vi.fn(),
}) }));
import { BrowserView } from './browser-view';
let host: HTMLDivElement, root: Root;
const render = () => act(async () => root.render(React.createElement<{ artifactTabId?: string }>(BrowserView, { artifactTabId: 'tab' })));
const sheet = () => host.querySelector('iframe')!.parentElement!.querySelector<HTMLDivElement>('div.absolute.inset-0.z-10')!;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.active = false; state.toggle.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it('embeds the sharper live stream for the take-over surface', async () => {
  await render();
  expect(host.querySelector('iframe')!.getAttribute('src')).toBe('https://bf.example/live/abc?embed=1&q=high');
});

it('takes over when someone clicks the page while the agent is idle', async () => {
  await render();
  await act(async () => sheet().dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(state.toggle).toHaveBeenCalledTimes(1);
});

it('points at Take over instead of grabbing control while the agent is acting', async () => {
  state.active = true; await render();
  await act(async () => sheet().dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(state.toggle).not.toHaveBeenCalled();
  expect(host.querySelector('button.ring-4')?.textContent).toContain('browser.takeOver');
});
