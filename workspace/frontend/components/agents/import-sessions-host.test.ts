// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listNodes: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: { listNodes: api.listNodes } }));
// The dialog itself is covered in import-sessions-dialog.test.ts.
vi.mock('./import-sessions-dialog', async (orig) => ({
  ...(await orig<typeof import('./import-sessions-dialog')>()),
  ImportSessionsDialog: (p: { node: { nodeId: string }; type: string; agentName: string }) =>
    React.createElement('div', { 'data-testid': 'dialog' }, `${p.node.nodeId}:${p.type}:${p.agentName}`),
}));

import { ImportSessionsHost, importRequestedInUrl, openImportSessions } from './import-sessions-host';

const NODES = [{ nodeId: 'n1', agents: [{ name: 'my-codex', type: 'codex' }, { name: 'my-aider', type: 'aider' }] }];
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  api.listNodes.mockReset().mockResolvedValue(NODES);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});
const mount = async () => { await act(async () => root.render(React.createElement(ImportSessionsHost))); };
const dialog = () => host.querySelector('[data-testid="dialog"]');

it('reads ?import= from the page URL or the desktop app\'s hash route', () => {
  expect(importRequestedInUrl('https://x.org/ws?import=my-codex')).toBe('my-codex');
  expect(importRequestedInUrl('file:///app/index.html#/ws?token=t&import=my-codex')).toBe('my-codex');
  expect(importRequestedInUrl('https://x.org/ws?thread=c1')).toBeNull();
  expect(importRequestedInUrl('not a url')).toBeNull();
});

it('opens the picker on the device the agent runs on, from anywhere in the app', async () => {
  await mount();
  expect(dialog()).toBeNull();
  await act(async () => { openImportSessions('my-codex'); });
  expect(dialog()!.textContent).toBe('n1:codex:my-codex');
});

it('waits for a just-added agent to show up on its device', async () => {
  api.listNodes.mockResolvedValueOnce([{ nodeId: 'n1', agents: [] }]).mockResolvedValue(NODES);
  await mount();
  await act(async () => { openImportSessions('my-codex'); });
  expect(dialog()).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3100); });
  expect(dialog()!.textContent).toBe('n1:codex:my-codex');
});

it('does nothing for a tool whose sessions cannot be imported', async () => {
  await mount();
  await act(async () => { openImportSessions('my-aider'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  expect(dialog()).toBeNull();
  expect(api.listNodes).toHaveBeenCalledTimes(1);
});

it('opens from ?import= once, then drops it from the address', async () => {
  window.history.replaceState(null, '', '/ws?import=my-codex&x=1');
  await mount();
  expect(dialog()!.textContent).toBe('n1:codex:my-codex');
  expect(window.location.search).toBe('?x=1');
});
