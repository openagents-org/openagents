import { expect, it } from 'vitest';
import { hasCollapsedSteps } from './intermediate-steps';
import type { WorkspaceMessage } from '@/lib/types';

let seq = 0;
const msg = (messageType: string, content: string, senderName = 'kimi'): WorkspaceMessage => ({
  messageId: `m${++seq}`, sessionId: 'dm', senderType: senderName === 'You' ? 'human' : 'agent', senderName, content, messageType,
} as WorkspaceMessage);

it('has nothing to show while the agent has only said "thinking..."', () => {
  // The reported case: the toggle appeared, and clicking it changed nothing.
  expect(hasCollapsedSteps([msg('chat', 'hi', 'You'), msg('status', 'thinking...')])).toBe(false);
});

it('ignores thinking and todos, which show either way', () => {
  expect(hasCollapsedSteps([
    msg('chat', 'go', 'You'), msg('thinking', 'Planning the change'), msg('todos', '[]'), msg('chat', 'done'),
  ])).toBe(false);
});

it('does not count the one live status the latest-only view already shows', () => {
  expect(hasCollapsedSteps([msg('chat', 'go', 'You'), msg('status', '**Running:** `ls`')])).toBe(false);
});

it('offers earlier tool steps of a run still in progress', () => {
  expect(hasCollapsedSteps([
    msg('chat', 'go', 'You'), msg('status', '**Running:** `ls`'), msg('status', '**Editing:** `a.ts`'),
  ])).toBe(true);
});

it('offers the steps of a finished run, which the latest-only view hides', () => {
  expect(hasCollapsedSteps([msg('chat', 'go', 'You'), msg('status', '**Running:** `ls`'), msg('chat', 'done')])).toBe(true);
});
