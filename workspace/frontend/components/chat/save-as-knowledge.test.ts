// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ currentUser: { id: 'me@example.com' }, agents: [] }) }));
vi.mock('./markdown-content', () => ({ MarkdownContent: () => null }));
vi.mock('./copy-message-link', () => ({ CopyMessageLink: () => null }));
vi.mock('./agent-message-access', () => ({ AgentOwnershipBadge: () => null, AgentSharingAction: () => null }));
vi.mock('./message-audience', () => ({ CompletionAudience: () => null }));
vi.mock('@/components/artifacts/message-artifacts', () => ({ MessageArtifacts: () => null }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));
import { AgentMessageRow, type AgentMessageRowProps } from './agent-message-row';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const message = { messageId: 'evt-1', senderType: 'agent', senderName: 'coder', senderAddress: 'openagents:coder',
  messageType: 'chat', content: 'The pool made p95 worse.', sessionId: 'thread', metadata: {} } as never;
const props = (over: Partial<AgentMessageRowProps> = {}): AgentMessageRowProps => ({
  message, agents: [], agentNames: [], agentLabels: {}, humanNames: {}, timestamp: null, attachments: [],
  approval: null, handoff: null, displayContent: 'The pool made p95 worse.', yumiWelcome: false, isLast: false, ...over,
});
const saveButton = () => Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'reactions.saveKnowledge');

it('asks the agent to save its own message', async () => {
  const save = vi.fn();
  await act(async () => root.render(React.createElement(AgentMessageRow, props({ onSaveKnowledge: save }))));
  await act(async () => saveButton()!.click());
  expect(save).toHaveBeenCalledWith(message);
});

it('offers no save for an empty, pending or read-only message', async () => {
  await act(async () => root.render(React.createElement(AgentMessageRow, props())));
  expect(saveButton()).toBeUndefined();
  await act(async () => root.render(React.createElement(AgentMessageRow, props({ onSaveKnowledge: vi.fn(), displayContent: ' ' }))));
  expect(saveButton()).toBeUndefined();
  await act(async () => root.render(React.createElement(AgentMessageRow, props({
    onSaveKnowledge: vi.fn(), message: { ...(message as object), messageId: 'optimistic-1' } as never,
  }))));
  expect(saveButton()).toBeUndefined();
});
