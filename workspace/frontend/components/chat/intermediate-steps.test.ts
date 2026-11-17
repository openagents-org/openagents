// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';

vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, args?: Record<string, unknown>) => key + (args ? ' ' + Object.values(args).join(' ') : '') }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));
vi.mock('./working-bubble', () => ({ WorkingBubble: ({ status }: { status?: string }) => React.createElement('div', { 'data-testid': 'bubble' }, status ?? '') }));

const { IntermediateSteps } = await import('./intermediate-steps');

let seq = 0;
const msg = (messageType: string, content: string, senderName = 'kimi', metadata: Record<string, unknown> = {}): WorkspaceMessage => ({
  messageId: `m${++seq}`, sessionId: 's', senderType: 'agent', senderName, content, messageType, metadata,
} as WorkspaceMessage);
const agents = [{ agentName: 'kimi' }, { agentName: 'codex' }] as WorkspaceAgent[];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const render = (steps: WorkspaceMessage[], isActive: boolean) => act(() => root.render(React.createElement(IntermediateSteps, { steps, agents, isActive })));
const summaries = () => Array.from(host.querySelectorAll('[data-slot="trace-collapsible-trigger"]')).map((el) => el.textContent);

it('folds a finished run into one summary line', () => {
  render([msg('status', '**Running:** `ls`'), msg('status', '**Editing:** `a.ts`')], false);
  expect(summaries()).toEqual(['chat.stepsDone 2']);
  expect(host.querySelector('[data-slot="trace-collapsible-trigger"]')!.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('[data-testid="bubble"]')).toBeNull();
});

it('marks only the agent still working as running, and hands its live step to the bubble', () => {
  render([
    msg('status', '**Running:** `ls`', 'kimi'), msg('status', '**Running:** `pwd`', 'kimi'),
    msg('status', '**Running:** `make`', 'codex'), msg('status', '**Editing:** `b.ts`', 'codex'),
  ], true);
  expect(summaries()).toEqual(['chat.stepsDone 2', 'chat.stepsRunning']);
  expect(host.querySelector('[data-testid="bubble"]')!.textContent).toBe('Edit › b.ts');
});

it('shows only the latest to-do snapshot, split into what is left and what is done', () => {
  const todos = (list: { content: string; status: string }[]) => msg('todos', 'todos', 'kimi', { todos: list });
  render([
    todos([{ content: 'Old plan', status: 'pending' }]),
    todos([{ content: 'Write code', status: 'in_progress' }, { content: 'Plan', status: 'completed' }]),
  ], false);
  expect(host.textContent).not.toContain('Old plan');
  expect(summaries()).toEqual(['chat.todoLeft 1', 'chat.todoDone 1']);
});
