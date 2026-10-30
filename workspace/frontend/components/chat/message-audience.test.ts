// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageAudience, messageAudience } from './message-audience';
import type { WorkspaceMessage } from '@/lib/types';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const message = { messageId: 'm1', sessionId: 'thread', senderType: 'human', messageType: 'chat', metadata: {}, targetAgents: ['__no_response__'] } as WorkspaceMessage;
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; });
it('distinguishes classification in progress from a recorded pending choice', () => {
  expect(messageAudience(message)).toBe('human');
  expect(messageAudience({ ...message, targetAgents: ['helper'] })).toBe('agent');
  expect(messageAudience({ ...message, targetAgents: null })).toBeNull();
  expect(messageAudience({ ...message, messageId: 'optimistic-1' })).toBeNull();
  expect(messageAudience({ ...message, messageId: 'optimistic-user-1', metadata: { _routingPending: true } })).toBe('routing');
  expect(messageAudience({ ...message, metadata: { approval_id: 'approval' } })).toBeNull();
  expect(messageAudience({ ...message, metadata: { routing_choice: { status: 'pending' } } })).toBe('pending');
  expect(messageAudience({ ...message, metadata: { routing_choice: { status: 'assigned' } } })).toBe('agent');
  expect(messageAudience({ ...message, metadata: { recalled: true } })).toBeNull();
});
it('shows the flow badge only on an optimistic classification, then the recipient', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(MessageAudience, { message: { ...message, messageId: 'optimistic-user-1', metadata: { _routingPending: true } }, isSender: true })));
  expect(host.textContent).toBe('routing.routing'); expect(host.querySelector('.routing-flow')).not.toBeNull();
  await act(async () => root.render(React.createElement(MessageAudience, { message: { ...message, targetAgents: ['helper'] }, isSender: true })));
  expect(host.textContent).toBe('helper'); expect(host.querySelector('.routing-flow')).toBeNull(); expect(host.querySelector('button')).toBeNull();
});
it('shows a noninteractive conversation badge to other people', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(MessageAudience, { message, isSender: false })));
  expect(host.textContent).toBe('routing.conversation'); expect(host.querySelector('button')).toBeNull();
});
it('uses the canonical assigned recipient when the original event has no target agents', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(MessageAudience, {
    message: { ...message, metadata: { routing_choice: { status: 'assigned', agent: 'helper' } } }, isSender: true,
  })));
  expect(host.textContent).toBe('helper'); expect(host.querySelector('button')).toBeNull();
});

it.each(['wait', 'stop'])('labels a final agent turn as conversation for %s', async action => {
  const { CompletionAudience } = await import('./message-audience');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(CompletionAudience, {
    message: { ...message, senderType: 'agent', metadata: { orchestration: { action, reason: 'The human must log in.' } } },
  })));
  expect(host.textContent).toBe('routing.conversation');
  expect(host.querySelector('button')).toBeNull();
});

it('does not offer an agent for a historical completion-router error with no task', async () => {
  const { CompletionAudience } = await import('./message-audience');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(CompletionAudience, {
    message: { ...message, senderType: 'agent', metadata: {
      orchestration: { action: 'ask', reason: 'Could not confidently choose the next agent.' },
      routing_choice: { continuation: true, task: '', reason: 'Could not confidently choose the next agent.' },
    } },
  })));
  expect(host.textContent).toBe('routing.conversation'); expect(host.querySelector('button')).toBeNull();
});
