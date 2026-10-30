// @vitest-environment jsdom
import React, { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '@/lib/types';
import { messages } from '@/lib/i18n/messages/en-US';
import { translate } from '@/lib/i18n/translate';
const mocks = vi.hoisted(() => ({ currentUser: { id: 'ann@example.com' }, resolve: vi.fn(), discover: vi.fn(), participants: vi.fn() }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ currentUser: mocks.currentUser }) }));
vi.mock('@/lib/api', () => ({ workspaceApi: { resolveRoutingChoice: mocks.resolve, discover: mocks.discover, getChannelParticipants: mocks.participants } }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => translate(messages, messages, 'en-US', key) }));
import { RoutingChoiceCard } from './routing-choice-card';
let root: Root;
let host: HTMLDivElement;
const message = { messageId: 'event-1', sessionId: 'thread', metadata: { routing_choice: { status: 'pending', requester_email: 'ann@example.com', candidates: ['writer', 'reviewer'] } } } as unknown as WorkspaceMessage;
beforeEach(() => {
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  mocks.currentUser.id = 'ann@example.com';
  mocks.resolve.mockReset(); mocks.discover.mockReset(); mocks.participants.mockReset();
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(value = message, conversation = false) { await act(async () => root.render(createElement(RoutingChoiceCard, { message: value, agents: [], conversation }))); }
const button = (name: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === name || b.getAttribute('aria-label') === name)!;
async function open() { await act(async () => button('Choose agent').click()); }
it('shows the compact picker only to the requester', async () => {
  mocks.currentUser.id = 'someone-else@example.com'; await render(); expect(host.textContent).toBe('');
  mocks.currentUser.id = 'ann@example.com'; await render(); expect(host.textContent).toContain('Choose agent');
  expect(document.body.textContent).not.toContain('writer');
  await open(); expect(document.body.textContent).toContain('writer'); expect(mocks.resolve).not.toHaveBeenCalled();
});
it('assigns once and immediately replaces the picker with a read-only recipient badge', async () => {
  let finish!: (v: unknown) => void;
  mocks.resolve.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(); await open();
  await act(async () => { button('writer').click(); button('writer').click(); });
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('event-1', 'writer');
  expect(button('reviewer').disabled).toBe(true);
  await act(async () => finish({ status: 'assigned', agent: 'writer' }));
  expect(host.textContent).toContain('writer'); expect(host.querySelector('button')).toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('keeps conversation without starting work', async () => {
  mocks.resolve.mockResolvedValue({ status: 'dismissed' }); await render();
  await act(async () => button('Keep as conversation').click());
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('event-1', null);
  expect(host.textContent).toContain('Conversation'); expect(host.textContent).toContain('Ask an agent');
});
it('retains selection and allows retry after a permission failure', async () => {
  mocks.resolve.mockRejectedValueOnce(new Error('Sharing changed')); await render(); await open();
  await act(async () => button('writer').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Sharing changed');
  expect(button('writer').disabled).toBe(false);
  mocks.resolve.mockResolvedValueOnce({ status: 'assigned', agent: 'reviewer' });
  await act(async () => button('reviewer').click()); expect(host.textContent).toContain('reviewer');
  expect(host.querySelector('button')).toBeNull();
});
it('searches ten candidates by name and supports keyboard selection', async () => {
  const candidates = Array.from({ length: 10 }, (_, i) => `agent-${i}`);
  await render({ ...message, metadata: { routing_choice: { ...message.metadata.routing_choice as object, candidates } } });
  await open(); const search = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'agent-9'); search.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(document.body.textContent).toContain('agent-9'); expect(document.body.textContent).not.toContain('agent-0');
  await act(async () => search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(document.activeElement).toBe(button('agent-9'));
});
it('preserves remaining task context for agent continuation choices', async () => {
  await render({ ...message, senderType: 'agent', metadata: { routing_choice: { ...message.metadata.routing_choice as object,
    continuation: true, reason: 'Review is still needed.', task: 'Check OAuth state validation.' } } });
  expect(host.textContent).toContain('Review is still needed.'); expect(host.textContent).toContain('Check OAuth state validation.');
  await open(); expect(button('reviewer')).toBeTruthy();
});
it('loads only online thread members when asking an agent from a conversation', async () => {
  mocks.participants.mockResolvedValue({ agents: [{ agent_name: 'helper' }, { agent_name: 'offline' }] });
  mocks.discover.mockResolvedValue({ agents: [
    { address: 'openagents:helper', status: 'online' }, { address: 'openagents:offline', status: 'offline' },
    { address: 'openagents:outsider', status: 'online' },
  ] });
  await render({ ...message, metadata: {} }, true);
  await act(async () => button('Ask an agent').click());
  expect(document.body.textContent).toContain('helper'); expect(document.body.textContent).not.toContain('offline'); expect(document.body.textContent).not.toContain('outsider');
  mocks.resolve.mockResolvedValue({ status: 'assigned', agent: 'helper' });
  await act(async () => button('helper').click());
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith('event-1', 'helper', true);
  expect(host.querySelector('button')).toBeNull(); expect(host.textContent).toContain('helper');
});
it('distinguishes router failure from an ordinary uncertain choice', async () => {
  await render(); expect(host.textContent).not.toContain('Routing unavailable');
  await render({ ...message, metadata: { ...message.metadata, router_unavailable: true } });
  expect(host.textContent).toContain('Routing unavailable');
  await open(); expect(button('writer')).toBeTruthy();
});
