// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ enqueue: vi.fn(), get: vi.fn() }));
const ws = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), open: vi.fn() }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));
vi.mock('@/lib/api', () => ({ workspaceApi: { enqueueNodeCommand: api.enqueue, getNodeCommand: api.get } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({
  agents: [
    { agentName: 'coder', displayName: null, role: 'member', ownerEmail: 'me@x.com' },
    { agentName: 'theirs', displayName: 'Someone else’s agent', role: 'member', ownerEmail: 'other@x.com' },
  ],
  sessions: [{ sessionId: 'channel-s1', status: 'active' }, { sessionId: 'channel-s2', status: 'archived' }],
  refreshAgents: ws.refresh, setCurrentSessionId: ws.open, currentUser: { id: 'me@x.com' },
}) }));
const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key);
const formatters = { timeAgo: () => '2d ago' };
vi.mock('@/lib/i18n', () => ({ useT: () => t, useFormatters: () => formatters }));

import { ImportSessionsDialog } from './import-sessions-dialog';
import { LayoutProvider, useLayout } from '@/components/layout/layout-context';

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
  api.enqueue.mockReset(); api.get.mockReset(); ws.open.mockReset(); ws.refresh.mockClear();
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
function DevicePage({ onClose }: { onClose: (open: boolean) => void }) {
  const { openView, setThreadFilter, viewMode, mobilePane, threadFilter } = useLayout();
  const [open, setOpen] = React.useState(false);
  return React.createElement(React.Fragment, null,
    React.createElement('button', { id: 'devices', onClick: () => { openView('connect'); setThreadFilter('dms'); setOpen(true); } }, 'Devices'),
    React.createElement('output', { id: 'route' }, [viewMode, mobilePane, threadFilter].join('/')),
    React.createElement(ImportSessionsDialog, { open, onOpenChange: (v) => { setOpen(v); onClose(v); }, node, type: 'codex', agentName: 'coder' }));
}
const render = async (onClose = vi.fn()) => {
  await act(async () => root.render(React.createElement(LayoutProvider, { children: React.createElement(DevicePage, { onClose }) })));
  await act(async () => document.querySelector<HTMLButtonElement>('#devices')!.click());
  await tick();
};
const q = (sel: string) => document.body.querySelector(sel);

it('lists the device\'s sessions for the tool and imports the picked ones into the chosen agent', async () => {
  await render();
  expect(q('#route')!.textContent).toBe('connect/list/dms');
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
  expect(q('#route')!.textContent).toBe('threads/detail/all');
});

it('keeps batch results in the dialog until every import and the thread list refresh finish', async () => {
  const close = vi.fn();
  let finishRefresh!: () => void;
  ws.refresh.mockImplementationOnce(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
  let secondDone = false;
  api.get.mockImplementation(async (_node: string, id: string) => {
    const command = commands.find((c) => c.commandId === id);
    if (id !== 'c3') return command;
    return secondDone
      ? { status: 'done', result: { ok: true, data: { channel: 'channel-s2', existing: true } } }
      : { status: 'running' };
  });
  await render(close);
  for (const title of ['Add pagination', 'Fix login']) {
    await act(async () => (q(`[aria-label="${title}"]`) as HTMLButtonElement).click());
  }
  await act(async () => (q('[data-testid="import-sessions-submit"]') as HTMLButtonElement).click());
  await tick();
  const resultButtons = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="import-sessions-done"] button'));
  expect(resultButtons()).toHaveLength(1);
  expect(resultButtons()[0].disabled).toBe(true);
  await act(async () => resultButtons()[0].click());
  expect(close).not.toHaveBeenCalled();
  expect(ws.open).not.toHaveBeenCalled();
  expect(ws.refresh).not.toHaveBeenCalled();
  secondDone = true;
  await tick();
  expect(resultButtons()).toHaveLength(2);
  expect(resultButtons().every((b) => b.disabled)).toBe(true);
  await act(async () => finishRefresh());
  const reused = resultButtons()[1];
  expect(reused.disabled).toBe(false);
  expect(reused.textContent).toContain('importSessions.alreadyImported');
  await act(async () => reused.click());
  expect(close).toHaveBeenCalledWith(false);
  expect(ws.open).toHaveBeenCalledWith('channel-s2');
  expect(q('#route')!.textContent).toBe('threads/detail/archived');
});

it.each(['close', 'open result'])('can %s after a mixed batch when thread refresh never settles', async (action) => {
  const close = vi.fn();
  ws.refresh.mockImplementationOnce(() => new Promise<void>(() => {}));
  api.get.mockImplementation(async (_node: string, id: string) => id === 'c3'
    ? { status: 'done', result: { ok: false, message: 'Could not read this session' } }
    : commands.find(c => c.commandId === id));
  await render(close);
  for (const title of ['Add pagination', 'Fix login']) {
    await act(async () => (q(`[aria-label="${title}"]`) as HTMLButtonElement).click());
  }
  await act(async () => (q('[data-testid="import-sessions-submit"]') as HTMLButtonElement).click());
  await tick();
  const result = q('[data-testid="import-sessions-done"] button') as HTMLButtonElement;
  expect(result.textContent).toContain('Add pagination');
  expect(q('[data-testid="import-sessions-list"]')!.textContent).toContain('Could not read this session');
  if (action === 'close') {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'common.close')!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
  } else {
    await tick(5000);
    expect(result.disabled).toBe(false);
    await act(async () => result.click());
    expect(ws.open).toHaveBeenCalledWith('channel-s1');
  }
  expect(close).toHaveBeenCalledWith(false);
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
