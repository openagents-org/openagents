// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  validate: vi.fn(), reactivate: vi.fn(), refresh: vi.fn(), reconnect: vi.fn(),
  tab: {id:'saved', url:'https://example.com', title:'Example', liveUrl:'https://browserfabric.com/live/old', sharedWith:[], createdBy:'human:user', asleep:false},
}));
vi.mock('./use-browser-control', () => ({useBrowserControl: () => ({controlling:false,busy:false,toggle:vi.fn(),input:vi.fn(),frameRevision:0})}));
vi.mock('./agent-activity', () => ({ actorName: () => null, useAgentActivity: () => ({active:false}) }));
vi.mock('./new-browser-tab-dialog', () => ({NewBrowserTabDialog: () => null}));
vi.mock('@/components/ui/dialogs-provider', () => ({useConfirm: () => vi.fn()}));
vi.mock('@/components/layout/layout-context', () => ({useLayout: () => ({isMobile:false})}));
vi.mock('@/lib/i18n', () => ({useT: () => (key:string) => key, useFormatters: () => ({timeAgoShort: () => ''})}));
vi.mock('sonner', () => ({toast:{success:vi.fn(),error:vi.fn()}}));
vi.mock('@/lib/api', () => ({workspaceApi:{validateBrowserTab:state.validate,reactivateBrowserTab:state.reactivate}}));
vi.mock('@/lib/workspace-context', () => ({useWorkspace: () => ({
  browserTabs:[state.tab],browserContexts:[],agents:[],refreshBrowserTabs:state.refresh,reconnectBrowserTab:state.reconnect,
})}));
import {BrowserView} from './browser-view';
let host:HTMLDivElement, root:Root;
const render = () => act(async () => root.render(React.createElement<{artifactTabId?:string}>(BrowserView,{artifactTabId:'saved'})));
const retry = () => act(async () => (host.querySelector('button[aria-label="browser.reactivate"]') as HTMLButtonElement).click());
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  state.tab.asleep=false;
  state.validate.mockReset().mockResolvedValue({connectionStatus:'alive'});
  state.reactivate.mockReset().mockResolvedValue({connectionStatus:'alive'});
  state.refresh.mockReset().mockResolvedValue(undefined);
  state.reconnect.mockReset();
  host=document.createElement('div'); document.body.append(host); root=createRoot(host);
});
afterEach(async () => {await act(async () => root.unmount()); host.remove();});
it('shows Reactivate for a sleeping session that still has an active tab record',async () => {
  state.validate.mockResolvedValue({connectionStatus:'alive',asleep:true});
  await render();
  expect(host.textContent).toContain('browser.sleepingTitle');
  expect(host.querySelector('iframe')).toBeNull();
  await retry();
  expect(state.reactivate).toHaveBeenCalledWith('saved');
  expect(state.reconnect).not.toHaveBeenCalled();
  expect(host.querySelector('iframe')).not.toBeNull();
});
it('does not call an uncertain session expired, and leaves retry available after a provider failure',async () => {
  state.validate.mockResolvedValue({connectionStatus:'unknown'});
  state.reactivate.mockRejectedValue(new Error('BrowserFabric unavailable'));
  await render(); await retry();
  expect(host.textContent).toContain('browser.unavailableTitle');
  expect(host.textContent).not.toContain('browser.expiredTitle');
  expect((host.querySelector('button[aria-label="browser.reactivate"]') as HTMLButtonElement).disabled).toBe(false);
  expect(state.reconnect).not.toHaveBeenCalled();
});
it('always allows reactivation when the embedded viewer fails but the session probe passes',async () => {
  await render();
  const previous=host.querySelector('iframe');
  await retry();
  expect(state.reactivate).toHaveBeenCalledWith('saved');
  expect(host.querySelector('iframe')).not.toBe(previous);
});
