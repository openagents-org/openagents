// @vitest-environment jsdom
/**
 * "Bring your memory": the dialog scans the device, lets the user pick, copies
 * the picked items and shows what came over — and the thread banner's "Not
 * now" tells the device so the offer does not come back in every thread.
 */
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
import type { MemoryScan, NodeCommand } from '@/lib/types';
import { MemoryImportBanner, MemoryImportDialog, type MemoryImportApi } from './memory-import';

const t = (key: string, params?: Record<string, string | number>) => translate(messages, messages, 'en-US', key, params);
vi.mock('@/lib/i18n', () => ({ useT: () => t }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/dialogs-provider', () => ({ useConfirm: () => async () => true }));
vi.mock('@/components/ui/responsive-dialog', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => createElement('div', null, children);
  return {
  Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) => (open ? createElement('div', null, children) : null),
  DialogContent: passthrough, DialogHeader: passthrough, DialogBody: passthrough, DialogFooter: passthrough,
  DialogTitle: passthrough, DialogDescription: passthrough,
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  host?.remove();
  vi.useRealTimers();
});

const scan: MemoryScan = {
  agent: 'claude', type: 'claude', tool: 'Claude Code', supported: true, importedAt: null, dismissedAt: null,
  items: [
    { id: 'claude:global', tool: 'claude', kind: 'instructions', label: 'Global instructions (CLAUDE.md)', source: '~/.claude/CLAUDE.md', files: ['~/.claude/CLAUDE.md'], fileCount: 1, bytes: 120, status: 'loaded', secret: false, selected: false, note: 'Claude Code loads this for the agent already.' },
    { id: 'claude:project:a', tool: 'claude', kind: 'memory', label: 'Project memory: shop', source: '~/code/shop', files: ['~/code/shop/CLAUDE.md'], fileCount: 3, bytes: 2048, status: 'importable', secret: false, selected: true },
    { id: 'claude:project:b', tool: 'claude', kind: 'memory', label: 'Project memory: api', source: '~/code/api', files: ['~/code/api/CLAUDE.md'], fileCount: 1, bytes: 300, status: 'importable', secret: true, selected: false },
  ],
};

/** A fake device: every queued command finishes on the next poll. */
function fakeApi(results: Record<string, unknown>) {
  const queued: NodeCommand[] = [];
  const api = {
    enqueueNodeCommand: vi.fn(async (_node: string, action: string) => {
      const cmd: NodeCommand = {
        commandId: `c${queued.length + 1}`, action, status: 'done',
        result: { ok: true, message: 'ok', data: results[action] }, agentName: 'claude', createdAt: null, finishedAt: null,
      };
      queued.push(cmd);
      return cmd;
    }),
    listNodeCommands: vi.fn(async () => queued),
  };
  return api as typeof api & MemoryImportApi;
}

async function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(el));
}
const poll = () => act(async () => { await vi.advanceTimersByTimeAsync(1600); });
const button = (label: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);

it('scans, preselects what is safe, imports the pick and shows a receipt', async () => {
  const api = fakeApi({
    memory_scan: scan,
    memory_import: { receipt: { at: '2026-11-14T00:00:00Z', tool: 'Claude Code', files: 3, counts: { memory: 1 }, items: [{ id: 'claude:project:a', label: 'Project memory: shop', kind: 'memory', tool: 'claude', source: '~/code/shop', files: 3 }] } },
  });
  const onChanged = vi.fn();
  await mount(createElement(MemoryImportDialog, {
    api, nodeId: 'n1', deviceName: 'LAPTOP', agentName: 'claude', agentType: 'claude', open: true, onOpenChange: () => {}, onChanged,
  }));
  expect(host.textContent).toContain(t('memoryImport.scanning', { tool: 'Claude Code', device: 'LAPTOP' }));
  await poll();

  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'memory_scan', { name: 'claude' });
  expect(host.textContent).toContain(messages.memoryImport.groupImportable);
  expect(host.textContent).toContain(messages.memoryImport.groupLoaded);
  expect(host.textContent).toContain(messages.memoryImport.secretWarning);
  const boxes = [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  expect(boxes.map((b) => b.checked)).toEqual([true, false]);

  await act(async () => button(t('memoryImport.importButton', { count: 1 }))!.click());
  await poll();
  expect(api.enqueueNodeCommand).toHaveBeenLastCalledWith('n1', 'memory_import', { name: 'claude', ids: ['claude:project:a'] });
  expect(host.textContent).toContain(messages.memoryImport.receiptTitle);
  expect(host.textContent).toContain(t('memoryImport.receiptBody', { agent: 'claude', count: 1, tool: 'Claude Code', files: 3 }));
  expect(button(messages.memoryImport.undo)).toBeTruthy();
  expect(onChanged).toHaveBeenCalled();
});

it('says so when the device runs a launcher without memory import', async () => {
  const api = fakeApi({});
  api.listNodeCommands.mockImplementation(async () => [{
    commandId: 'c1', action: 'memory_scan', status: 'error', result: { ok: false, message: "Unknown action 'memory_scan'" },
    agentName: 'claude', createdAt: null, finishedAt: null,
  }]);
  await mount(createElement(MemoryImportDialog, {
    api, nodeId: 'n1', agentName: 'claude', agentType: 'claude', open: true, onOpenChange: () => {},
  }));
  await poll();
  expect(host.textContent).toContain(messages.memoryImport.olderLauncher);
});

it('banner: "Not now" hides it and tells the device', async () => {
  const api = fakeApi({ memory_dismiss: { dismissedAt: 'now' } });
  await mount(createElement(MemoryImportBanner, {
    api, nodeId: 'n1', agentName: 'claude', agentType: 'claude',
    summary: { status: 'available', found: 2, loaded: 1, imported: 0, counts: { memory: 2 }, importedCounts: {}, importedAt: null, tool: 'Claude Code' },
  }));
  expect(host.textContent).toContain(t('memoryImport.bannerBody', { count: 2, tool: 'Claude Code' }));
  await act(async () => button(messages.memoryImport.notNow)!.click());
  expect(api.enqueueNodeCommand).toHaveBeenCalledWith('n1', 'memory_dismiss', { name: 'claude' });
  expect(host.textContent).toBe('');
});
