// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceAgent, WorkspaceMessage } from '@/lib/types';

vi.mock('@/lib/i18n', () => ({ useT: () => (key: string, args?: Record<string, unknown>) => key + (args ? ' ' + Object.values(args).join(' ') : '') }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));

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
  expect(summaries()).toHaveLength(1);
  expect(summaries()[0]).toContain('chat.activity');
  expect(summaries()[0]).toContain('chat.activitySteps 2');
  expect(host.querySelector('[data-slot="trace-collapsible-trigger"]')!.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('.working-bubble')).toBeNull();
});

it('shows the current tool while keeping arguments inside the activity disclosure', () => {
  render([
    msg('status', '**Running:** `ls`', 'kimi'), msg('status', '**Running:** `pwd`', 'kimi'),
    msg('status', '**Running:** `make`', 'codex'), msg('status', '**Editing:** `b.ts`', 'codex'),
  ], true);
  expect(summaries()).toHaveLength(1);
  expect(summaries()[0]).toContain('chat.stepsRunning');
  expect(host.querySelector('.working-bubble')?.textContent).toContain('chat.usingTool Edit');
  expect(host.textContent).not.toContain('b.ts');
  act(() => (host.querySelector('[data-slot="trace-collapsible-trigger"]') as HTMLButtonElement).click());
  expect(host.textContent).toContain('b.ts');
});

it('keeps the current task and action visible across a to-do update and folds them after the run', () => {
  const steps = [
    msg('todos', 'todos', 'kimi', { todos: [{ content: 'Other agent task', status: 'in_progress' }] }),
    msg('status', 'Bash › npm run test', 'codex'),
    msg('todos', 'todos', 'codex', { todos: [{ content: 'Verify the changes', status: 'in_progress' }] }),
  ];
  render(steps, true);
  expect(host.querySelector('.working-bubble')?.textContent).toContain('Verify the changes');
  expect(host.querySelector('.working-bubble')?.textContent).toContain('chat.usingTool Bash');
  expect(host.textContent).not.toContain('Other agent task');
  expect(host.textContent).not.toContain('npm run test');

  render(steps, false);
  expect(host.querySelector('.working-bubble')).toBeNull();
  expect(summaries()[0]).toContain('chat.activity');
});

it('shows tools that report a name without arguments', () => {
  render([msg('status', '**Using tool:** `Read`')], true);
  expect(host.querySelector('.working-bubble')?.textContent).toContain('chat.usingTool Read');
});

it('shows a longer excerpt of the active agent’s latest thought and lets the user read the rest', () => {
  const steps = [
    msg('thinking', 'An older idea.', 'codex'),
    msg('thinking', `**Checking the layout.**\n\n- Compare card widths.\n- Check how headings wrap.\n\n${'Verify the spacing. '.repeat(35)}\n\n\`\`\`sh\nnpm run test\n\`\`\`\n\nEnd of the thought.`, 'codex'),
    msg('thinking', 'Another agent’s thought.', 'kimi'),
    msg('status', 'thinking...', 'codex'),
    msg('status', '**Running:** `npm run test`', 'codex'),
  ];
  render(steps, true);
  const bubble = host.querySelector('.working-bubble')?.textContent;
  expect(bubble).toContain('chat.latestThought');
  expect(bubble).toContain('Check how headings wrap.');
  expect(host.querySelector('.working-bubble strong')?.textContent).toBe('Checking the layout.');
  expect(host.querySelectorAll('.working-bubble li')).toHaveLength(2);
  expect(bubble).toContain('…');
  expect(bubble).not.toContain('End of the thought.');
  expect(bubble).not.toContain('An older idea.');
  expect(bubble).not.toContain('Another agent’s thought.');

  const toggle = host.querySelector<HTMLButtonElement>('.working-bubble button')!;
  act(() => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('End of the thought.');
  expect(host.querySelector('.working-bubble [data-language="sh"]')).not.toBeNull();
  act(() => toggle.click());
  expect(host.textContent).not.toContain('End of the thought.');

  render(steps, false);
  expect(host.textContent).not.toContain('chat.latestThought');
});

it('shows only the latest to-do snapshot, split into what is left and what is done', () => {
  const todos = (list: { content: string; status: string }[]) => msg('todos', 'todos', 'kimi', { todos: list });
  render([
    todos([{ content: 'Old plan', status: 'pending' }]),
    todos([{ content: 'Write code', status: 'in_progress' }, { content: 'Plan', status: 'completed' }]),
  ], false);
  expect(summaries()).toHaveLength(1);
  expect(summaries()[0]).toContain('chat.activityTasks 2');
  act(() => (host.querySelector('[data-slot="trace-collapsible-trigger"]') as HTMLButtonElement).click());
  expect(host.textContent).not.toContain('Old plan');
  expect(summaries().slice(1)).toEqual(['chat.todoLeft 1', 'chat.todoDone 1']);
  expect(host.textContent).toContain('Write code');
});

it('puts reasoning and tools behind one closed disclosure', () => {
  render([msg('thinking', 'Private working notes'), msg('status', '**Running:** `ls`'), msg('thinking', 'More notes')], false);
  expect(summaries()).toHaveLength(1);
  expect(host.textContent).not.toContain('Private working notes');
  act(() => (host.querySelector('[data-slot="trace-collapsible-trigger"]') as HTMLButtonElement).click());
  expect(summaries()).toHaveLength(3); // activity plus two reasoning disclosures
  expect(host.textContent).toContain('Bash');
});

it('keeps only the newest task snapshot for each author across interleaving agents', () => {
  render([
    msg('todos', 'todos', 'kimi', { todos: [{ content: 'Old plan', status: 'pending' }] }),
    msg('status', '**Running:** `make`', 'codex'),
    msg('todos', 'todos', 'kimi', { todos: [{ content: 'Current plan', status: 'pending' }] }),
  ], false);
  act(() => (host.querySelector('[data-slot="trace-collapsible-trigger"]') as HTMLButtonElement).click());
  expect(host.textContent).not.toContain('Old plan');
  expect(host.textContent).toContain('Current plan');
});
