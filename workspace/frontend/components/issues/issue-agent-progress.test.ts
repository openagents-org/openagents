// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { WorkspaceMessage, WorkspaceAgent, IssueThread } from '@/lib/types';
import { IssueAgentProgress, latestIssueProgress } from './issue-agent-progress';

const state = vi.hoisted(() => ({ messages: [] as WorkspaceMessage[], openView: vi.fn(), selectThread: vi.fn() }));
vi.mock('@/hooks/use-polling', () => ({ useMessagePolling: () => ({ messages: state.messages }) }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ setCurrentSessionId: state.selectThread }) }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ openView: state.openView }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: ({ name }: { name: string }) => React.createElement('span', { 'data-avatar': name }) }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const message = (agent: string, type: string, content: string) => ({ senderType: 'agent', senderAddress: `openagents:${agent}`, messageType: type, content }) as WorkspaceMessage;

it('replaces live progress and removes it on each agent final answer, even while busy status is stale', async () => {
  state.messages = [message('alpha', 'thinking', 'Checking the slow query'), message('beta', 'status', 'Reading the index')];
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const props = { thread: { channel_name: 'work-thread', title: 'Investigation' } as IssueThread,
    agents: [{ agentName: 'alpha', displayName: 'Alpha' }, { agentName: 'beta', displayName: 'Beta' }] as WorkspaceAgent[] };
  const render = () => act(async () => root.render(React.createElement(IssueAgentProgress, props)));
  try {
    await render();
    expect(host.textContent).toContain('Checking the slow query');
    expect(host.querySelector('[data-avatar="alpha"]')).not.toBeNull();
    await act(async () => host.querySelector('button')!.click());
    expect(state.selectThread).toHaveBeenCalledWith('work-thread');
    expect(state.openView).toHaveBeenCalledWith('threads');
    state.messages = [...state.messages, message('alpha', 'thinking', 'Comparing the query plans')];
    await render();
    expect(host.textContent).not.toContain('Checking the slow query');
    expect(host.textContent).toContain('Comparing the query plans');
    state.messages = [...state.messages, message('alpha', 'chat', 'Investigation finished')];
    await render();
    expect(host.textContent).not.toContain('Comparing the query plans');
    expect(host.querySelector('[data-avatar="alpha"]')).toBeNull();
    expect(host.textContent).toContain('Reading the index');
    state.messages = [...state.messages, message('alpha', 'thinking', 'A late background note')];
    await render();
    expect(host.textContent).not.toContain('A late background note');
    state.messages = [...state.messages, message('beta', 'chat', 'Done')];
    await render();
    expect(host.textContent).toBe('');
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('does not reuse a previous answer as completion of a new user request', () => {
  const messages = [message('alpha', 'chat', 'Previous result'), { senderType: 'human', content: 'Check this next' } as WorkspaceMessage];
  expect(latestIssueProgress(messages, 'alpha')).toEqual({ finished: false, step: null });
});
