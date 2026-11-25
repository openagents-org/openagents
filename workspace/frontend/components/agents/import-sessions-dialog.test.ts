// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ enqueue: vi.fn(), get: vi.fn() }));
const ws = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), open: vi.fn() }));
const layout = vi.hoisted(() => ({ openView: vi.fn(), openMobileDetail: vi.fn() }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => layout }));
vi.mock('@/lib/api', () => ({ workspaceApi: { enqueueNodeCommand: api.enqueue, getNodeCommand: api.get } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  agents: [
    { agentName: 'coder', displayName: null, role: 'member', ownerEmail: 'me@x.com' },
    { agentName: 'theirs', displayName: 'Someone else’s agent', role: 'member', ownerEmail: 'other@x.com' },
  ],
  refreshWorkspace: ws.refresh, setCurrentSessionId: ws.open, currentUser: { id: 'me@x.com' },
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
  api.enqueue.mockReset(); api.get.mockReset(); ws.open.mockReset();
  api.enqueue.mockImplementation(async (_node: string, action: string, args: Record<string, unknown>) => {
    const commandId = `c${++n}`;
    const data = action === 'list_local_sessions' ? { sessions: SESSIONS } : { channel: `channel-${args.id}`, resumable: true };
    commands.push({ commandId, action, status: 'done', result: { ok: true, message: null, data }, args });
    return { commandId };
  });
  api.get.mockImplementation(async (_node: string, id: string) => commands.find((c) => c.commandId === id));
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
  expect(layout.openView).toHaveBeenCalledWith('threads');
  expect(layout.openMobileDetail).toHaveBeenCalled();
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

it('offers only the person\'s own agents, never someone else\'s', async () => {
  // Radix Select scrolls the picked option into view; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  await render();
  await act(async () => document.body.querySelector<HTMLButtonElement>('[aria-label="importSessions.agent"]')!.click());
  const options = [...document.body.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  expect(options.some((o) => o?.includes('coder'))).toBe(true);
  expect(options.some((o) => o?.includes('Someone else'))).toBe(false);
});
