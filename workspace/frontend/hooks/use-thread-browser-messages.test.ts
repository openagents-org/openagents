// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  ws: { workspace: { workspaceId: 'workspace' }, currentSessionId: 'one', browserTabs: [{ id: 'tab', status: 'active', artifactChannels: [] as string[], createdBy: 'openagents:bot' }], refreshBrowserTabs: vi.fn() },
  poll: vi.fn(), dm: vi.fn(),
  messages: [] as any[],
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => h.ws }));
vi.mock('@/lib/api', () => ({ workspaceApi: { pollEvents: h.poll, pollConversation: h.dm } }));
import { useThreadBrowserMessages } from './use-thread-browser-messages';
function Probe() { return React.createElement('span', null, useThreadBrowserMessages(h.messages).map(m => m.sessionId + ':' + m.content).join('|')); }
let root: Root, host: HTMLDivElement;
const event = (target: string) => ({ id: target, source: 'openagents:bot', target, timestamp: 1, payload: { content: 'browser step', message_type: 'status' } });
const render = async () => { await act(async () => root.render(React.createElement(Probe))); };
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  h.ws.currentSessionId = 'one'; h.ws.browserTabs[0].artifactChannels = [];
  h.ws.browserTabs[0].createdBy = 'openagents:bot'; h.messages = [];
  h.ws.refreshBrowserTabs.mockResolvedValue(undefined);
  h.poll.mockResolvedValue({ events: [event('channel/one'), event('channel/other')] });
  h.dm.mockResolvedValue({ events: [event('human:me'), event('human:other')] });
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it('recovers browser activity omitted from chat history and scopes it to the current thread', async () => {
  await render();
  expect(h.poll).toHaveBeenCalledWith(expect.objectContaining({ channel: 'one', search: '/v1/browser/tabs/', limit: 50 }));
  expect(host.textContent).toBe('one:browser step');
});
it('does not fetch extra history for explicitly associated tabs', async () => {
  h.ws.browserTabs[0].artifactChannels = ['one']; await render();
  expect(h.poll).not.toHaveBeenCalled();
});
it('discards a delayed response after switching threads', async () => {
  let resolve!: (result: any) => void;
  h.poll.mockReturnValueOnce(new Promise(r => { resolve = r; })); await render();
  h.ws.currentSessionId = 'two'; h.poll.mockResolvedValue({ events: [] }); await render();
  await act(async () => resolve({ events: [event('channel/one')] }));
  expect(host.textContent).toBe('');
});
it('keeps recovered DM steps inside the selected pair', async () => {
  h.ws.currentSessionId = 'dm:human:me,openagents:bot'; await render();
  expect(h.poll).not.toHaveBeenCalled();
  expect(host.textContent).toBe('dm:human:me,openagents:bot:browser step');
});
it('recovers tool history for reused human-created browsers', async () => {
  h.ws.browserTabs[0].createdBy = 'human:user'; await render();
  expect(h.poll).toHaveBeenCalledTimes(1);
  expect(host.textContent).toBe('one:browser step');
});
it('refreshes browser evidence when a reply arrives after the live tool steps disappear', async () => {
  await render();
  h.poll.mockResolvedValue({events:[{...event('channel/one'), payload:{content:'latest browser step',message_type:'status'}}]});
  h.messages = [{id:'reply', sessionId:'one', senderType:'agent', senderAddress:'openagents:bot', messageType:'chat', content:'https://www.browserfabric.com/live/new-reply'}];
  await render();
  expect(h.poll).toHaveBeenCalledTimes(2);
  expect(h.ws.refreshBrowserTabs).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('one:latest browser step');
  await render();
  expect(h.poll).toHaveBeenCalledTimes(2);
  expect(h.ws.refreshBrowserTabs).toHaveBeenCalledTimes(1);
});
