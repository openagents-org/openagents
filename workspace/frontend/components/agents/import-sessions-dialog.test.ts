// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ enqueue: vi.fn(), list: vi.fn() }));
const ws = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), open: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: { enqueueNodeCommand: api.enqueue, listNodeCommands: api.list } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  agents: [{ agentName: 'coder', displayName: null, role: 'member' }, { agentName: 'claude-bot', displayName: 'Claude', role: 'member' }],
  refreshWorkspace: ws.refresh, setCurrentSessionId: ws.open,
}) }));
const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const formatters = { timeAgo: () => '2d ago' };
vi.mock('@/lib/i18n', () => ({ useT: () => t, useFormatters: () => formatters }));

import { ImportSessionsDialog } from './import-sessions-dialog';

const node = { nodeId: 'n1', name: 'laptop', hostname: 'laptop', agents: [{ name: 'coder', type: 'codex', status: 'running' }] } as never;
const SESSIONS = [
  { id: 's1', type: 'codex', title: 'Add pagination', cwd: '/work/api', updatedAt: '2026-11-20T00:00:00Z', messageCount: 12 },
  { id: 's2', type: 'codex', title: 'Fix login', cwd: '/work/web', updatedAt: '2026-11-19T00:00:00Z', messageCount: 4 },
];

let host: HTMLDivElement, root: Root;
let commands: Record<string, unknown>[];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  commands = [];
  let n = 0;
  api.enqueue.mockReset(); api.list.mockReset(); ws.open.mockReset();
  api.enqueue.mockImplementation(async (_node: string, action: string, args: Record<string, unknown>) => {
    const commandId = `c${++n}`;
    const data = action === 'list_local_sessions' ? { sessions: SESSIONS } : { channel: `channel-${args.id}`, resumable: true };
    commands.push({ commandId, action, status: 'done', result: { ok: true, message: null, data }, args });
    return { commandId };
  });
  api.list.mockImplementation(async () => commands);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const tick = async (ms = 1600) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const render = async () => {
  await act(async () => root.render(React.createElement(ImportSessionsDialog, { open: true, onOpenChange: () => {}, node, type: 'codex', agentName: 'coder' })));
  await tick();
};
const q = (sel: string) => document.body.querySelector(sel);

it('lists the device\'s sessions for the tool and imports the picked ones into the chosen agent', async () => {
  await render();
  expect(api.enqueue).toHaveBeenCalledWith('n1', 'list_local_sessions', { type: 'codex' });
  expect(q('[data-testid="import-sessions-list"]')!.textContent).toContain('Add pagination');
  const box = document.body.querySelector<HTMLButtonElement>('[aria-label="Add pagination"]')!;
  await act(async () => box.click());
  await act(async () => (q('[data-testid="import-sessions-submit"]') as HTMLButtonElement)!.click());
  await tick();
  expect(api.enqueue).toHaveBeenCalledWith('n1', 'import_local_session', { type: 'codex', id: 's1', agent: 'coder' });
  expect(ws.refresh).toHaveBeenCalled();
  const done = q('[data-testid="import-sessions-done"]')!;
  expect(done.textContent).toContain('Add pagination');
  await act(async () => done.querySelector('button')!.click());
  expect(ws.open).toHaveBeenCalledWith('channel-s1');
});

it('says when the device cannot list its sessions', async () => {
  api.enqueue.mockImplementation(async () => {
    commands.push({ commandId: 'x', action: 'list_local_sessions', status: 'done', result: { ok: false, message: 'Importing aider sessions is not supported' } });
    return { commandId: 'x' };
  });
  await render();
  expect(q('[data-testid="import-sessions-list"]')!.textContent).toContain('not supported');
  expect((q('[data-testid="import-sessions-submit"]') as HTMLButtonElement)!.disabled).toBe(true);
});
