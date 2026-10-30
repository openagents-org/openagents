// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ShareDialog } from './share-dialog';
import { workspaceApi } from '@/lib/api';

const state = vi.hoisted(() => ({ copy: vi.fn(), close: vi.fn() }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ workspace: { slug: 'team', workspaceId: 'workspace-id' } }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ workspaceApi: { createShare: vi.fn(), getThreadLink: vi.fn() } }));
vi.mock('@/lib/share-origin', () => ({ shareOrigin: () => 'https://workspace-preview.openagents.org' }));
vi.mock('@/hooks/use-copy-to-clipboard', () => ({ useCopyToClipboard: () => ({ isCopied: false, copyToClipboard: state.copy }) }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(workspaceApi.getThreadLink).mockImplementation(async sessionId => ({ id: sessionId === 'second' ? '7ad7e88c-7ebc-4ee8-bd5e-ce1ec245e6b3' : '6ad7e88c-7ebc-4ee8-bd5e-ce1ec245e6b3', session_id: sessionId }));
  vi.mocked(workspaceApi.createShare).mockResolvedValue({ shareToken: 'snapshot-token' } as Awaited<ReturnType<typeof workspaceApi.createShare>>);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
async function render(sessionId = 'thread/one', open = true) {
  await act(async () => root.render(React.createElement(ShareDialog, { open, sessionId, onOpenChange: state.close })));
}
function button(text: string) { return [...document.querySelectorAll('button')].find(b => b.textContent === text)!; }
async function snapshotTab() { await act(async () => { button('share.snapshot').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })); }); }

it('defaults to a live link that can be copied without publishing a snapshot', async () => {
  await render();
  expect(document.querySelector('button[role="tab"][data-state="active"]')?.textContent).toBe('share.threadLink');
  await act(async () => button('share.copyThreadLink').click());
  expect(state.copy).toHaveBeenCalledWith('https://workspace-preview.openagents.org/team/threads/6ad7e88c-7ebc-4ee8-bd5e-ce1ec245e6b3');
  expect(workspaceApi.createShare).not.toHaveBeenCalled();
});
it('keeps snapshots as a separate explicit action', async () => {
  await render(); await snapshotTab();
  expect(workspaceApi.createShare).not.toHaveBeenCalled();
  await act(async () => button('share.createLink').click());
  expect(workspaceApi.createShare).toHaveBeenCalledWith('thread/one');
  await act(async () => button('share.copyLink').click());
  expect(state.copy).toHaveBeenCalledWith('https://workspace-preview.openagents.org/share/snapshot-token');
});
it('discards a stale snapshot response after switching threads', async () => {
  let finish!: (value: Awaited<ReturnType<typeof workspaceApi.createShare>>) => void;
  vi.mocked(workspaceApi.createShare).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); await snapshotTab();
  await act(async () => button('share.createLink').click());
  await render('second');
  await act(async () => finish({ shareToken: 'old' } as Awaited<ReturnType<typeof workspaceApi.createShare>>));
  expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('https://workspace-preview.openagents.org/team/threads/7ad7e88c-7ebc-4ee8-bd5e-ce1ec245e6b3');
  await snapshotTab();
  expect(document.querySelector('input')).toBeNull();
  expect(button('share.createLink').disabled).toBe(false);
});
