// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '@/lib/types';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
const mocks = vi.hoisted(() => ({ currentUser: { id: 'ann@example.com' }, resolve: vi.fn() }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ currentUser: mocks.currentUser }) }));
vi.mock('@/lib/api', () => ({ workspaceApi: { resolveRoutingChoice: mocks.resolve } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => translate(messages, messages, 'en-US', key) }));
import { RoutingChoiceCard } from './routing-choice-card';
let root: Root;
let host: HTMLDivElement;
const message = { messageId: 'event-1', metadata: { routing_choice: { status: 'pending', requester_email: 'ann@example.com', candidates: ['writer', 'reviewer'] } } } as unknown as WorkspaceMessage;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.currentUser.id = 'ann@example.com';
  mocks.resolve.mockReset();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(value = message) { await act(async () => root.render(createElement(RoutingChoiceCard, { message: value, agents: [] }))); }
const button = (name: string) => Array.from(host.querySelectorAll('button')).find(b => b.textContent === name)!;
it('shows choices only to the original sender', async () => {
  mocks.currentUser.id = 'someone-else@example.com';
  await render(); expect(host.textContent).toBe('');
  mocks.currentUser.id = 'ann@example.com';
  await render(); expect(host.textContent).toContain('Who should work on this?');
  expect(host.textContent).toContain('writer');
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it('assigns the original message once and hides the prompt after success', async () => {
  let finish!: (v: unknown) => void;
  mocks.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => { button('writer').click(); button('writer').click(); });
  expect(mocks.resolve).toHaveBeenCalledTimes(1);
  expect(mocks.resolve).toHaveBeenCalledWith('event-1', 'writer');
  expect(button('reviewer').disabled).toBe(true);
  await act(async () => finish({ status: 'assigned' }));
  expect(host.textContent).toBe('');
});
it('dismisses without requesting an agent', async () => {
  mocks.resolve.mockResolvedValue({ status: 'dismissed' });
  await render();
  await act(async () => button('Just chatting').click());
  expect(mocks.resolve).toHaveBeenCalledWith('event-1', null);
  expect(host.textContent).toBe('');
});
it('keeps the choice available after a permission or network failure', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('Sharing changed'));
  await render();
  await act(async () => button('writer').click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Sharing changed');
  expect(button('writer').disabled).toBe(false);
  mocks.resolve.mockResolvedValueOnce({ status: 'assigned' });
  await act(async () => button('reviewer').click());
  expect(host.textContent).toBe('');
});
