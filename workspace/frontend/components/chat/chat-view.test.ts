// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { WorkspaceMessage } from '@/lib/types';

// What the thread's message list was last asked to show, the composer's send
// handler, and a stand-in for the server's copy of each thread.
const h = vi.hoisted(() => ({
  ws: {} as Record<string, unknown>,
  threads: {} as Record<string, unknown[]>,
  seen: [] as unknown[][],
  reply: null as null | ((message: WorkspaceMessage) => void),
  sent: [] as unknown[][],
  send: null as null | ((text: string) => Promise<void>),
  mounted: null as null | { sessionId: string | null; setMessages: (msgs: unknown[]) => void },
}));

vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => h.ws }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => ({ email: 'user@example.test', role: 'owner' }) }));
vi.mock('@/hooks/use-team-roster', () => ({ useHumanNames: () => ({}), useTeamRoster: () => [] }));
vi.mock('./work-brief', () => ({ useBrief: () => ({ brief: null }) }));
vi.mock('@/lib/analytics', () => ({ capture: () => {} }));
vi.mock('@/hooks/use-composing-signal', () => ({
  useComposingSignal: () => ({ notifyFocus: () => {}, notifyBlur: () => {}, notifyTyping: () => {} }),
}));
vi.mock('@/components/layout/layout-context', () => ({
  useLayout: () => ({ isMobile: false, viewMode: 'threads', splitBrowser: false, showBrowserPreview: false }),
}));
vi.mock('@/lib/api', () => ({
  workspaceApi: {
    listNodes: async () => [],
    sendMessage: async (sessionId: string, content: string, ...args: unknown[]) => { h.sent.push([sessionId, content, ...args]); return ({ id: 'a3', source: 'human:user-1', target: `channel/${sessionId}`, type: 'workspace.message.posted', timestamp: Date.now(), visibility: 'channel', payload: { content }, metadata: { target_agents: ['bot'] } }); },
    loadMessageHistory: async () => ({ events: [], has_more: false }),
    pollMessages: async () => ({ messages: [], hasMore: false }),
  },
}));
// Like the real hook, swaps in a thread's messages one render after the switch.
vi.mock('@/hooks/use-polling', async () => {
  const { useEffect, useState } = await import('react');
  return {
    useMessagePolling: ({ sessionId }: { sessionId: string | null }) => {
      const [messages, setMessages] = useState<unknown[]>([]);
      useEffect(() => {
        setMessages(sessionId ? (h.threads[sessionId] ?? []) : []);
      }, [sessionId]);
      h.mounted = { sessionId, setMessages };
      return {
        messages, loading: false, forceRefresh: () => {}, generation: 0,
        loadOlder: () => {}, hasOlder: false, loadingOlder: false,
      };
    },
  };
});
vi.mock('./chat-messages', () => ({
  ChatMessages: ({ messages, onReply }: { messages: unknown[]; onReply: (message: WorkspaceMessage) => void }) => { h.seen.push(messages); h.reply = onReply; return null; },
}));
vi.mock('./chat-input', () => ({
  ChatInput: ({ onSend }: { onSend: (text: string) => Promise<void> }) => { h.send = onSend; return null; },
}));
vi.mock('./yumi-guide', () => ({ YumiGuide: () => null }));
vi.mock('./yumi-dm-intro', () => ({ YumiDmIntro: () => null }));
vi.mock('./human-profile', () => ({ HumanProfile: () => null }));
vi.mock('./thread-live-browser', () => ({ ThreadLiveBrowser: () => null }));
vi.mock('./agent-message-access', () => ({ AgentMessageAccessProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./thread-resources', () => ({ ThreadResources: () => null }));
vi.mock('./thread-status-bar', () => ({ ThreadStatusBar: () => null }));
vi.mock('./empty-state', () => ({ EmptyState: () => null }));
vi.mock('./share-dialog', () => ({ ShareDialog: () => null }));
vi.mock('./orchestration-control', () => ({ OrchestrationControl: () => null }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: () => null }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));
vi.mock('@/components/routines/routine-dialog', () => ({ RoutineDialog: () => null }));

import { ChatView, resetOptimisticStoreForTests } from './chat-view';

function msg(messageId: string, sessionId: string, overrides: Partial<WorkspaceMessage> = {}): WorkspaceMessage {
  return {
    messageId,
    sessionId,
    senderId: 'user-1',
    senderName: 'User',
    senderType: 'human',
    content: messageId,
    messageType: 'chat',
    mentions: [],
    targetAgents: null,
    createdAt: null,
    metadata: {},
    ...overrides,
  } as WorkspaceMessage;
}
const step = (messageId: string, sessionId: string) =>
  msg(messageId, sessionId, { senderType: 'agent', senderName: 'bot', messageType: 'status' });

/** The server gains messages in a thread; the open thread receives them live. */
function deliver(sessionId: string, ...msgs: WorkspaceMessage[]) {
  h.threads[sessionId] = [...(h.threads[sessionId] ?? []), ...msgs];
  if (h.mounted?.sessionId === sessionId) h.mounted.setMessages(h.threads[sessionId]);
}

const shown = () => (h.seen[h.seen.length - 1] as WorkspaceMessage[]).map((m) => m.messageType);

let root: Root;
let container: HTMLDivElement;
const open = (sessionId: string) => act(async () => {
  h.ws = { ...h.ws, currentSessionId: sessionId };
  root.render(React.createElement(ChatView));
});

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  resetOptimisticStoreForTests();
  h.seen = []; h.sent = []; h.reply = null;
  h.threads = {
    'thread-a': [msg('a1', 'thread-a'), step('a2', 'thread-a')],
    'thread-b': [msg('b1', 'thread-b'), step('b2', 'thread-b')],
  };
  h.ws = {
    workspace: { workspaceId: 'ws-1' },
    agents: [{ agentName: 'bot', status: 'online', role: 'worker', description: 'helper' }],
    currentUser: { id: 'user-1', name: 'User' },
    currentSessionId: null,
    sessions: ['thread-a', 'thread-b'].map((sessionId) => ({
      sessionId, title: sessionId, status: 'active', participants: ['bot'],
    })),
    activeSessionIds: new Set(),
    stoppingSessionIds: new Set(),
    knowledge: [],
    updateLastMessage: () => {},
    setSessionActive: () => {},
    updateAgentMode: () => {},
    consumeSkipFocus: () => true,
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('still shows the waiting bubble after the user looks at another thread and comes back', async () => {
  // The agent is mid-task in thread A when the user writes again.
  await open('thread-a');
  await act(async () => { await h.send!('hurry up'); });
  await act(async () => deliver('thread-a', msg('a3', 'thread-a', { content: 'hurry up' })));
  expect(shown()).toEqual(['chat', 'status', 'chat', 'loading']);

  await open('thread-b');
  expect(shown()).toEqual(['chat', 'status']);

  h.seen = [];
  await open('thread-a');
  expect(shown()).toEqual(['chat', 'status', 'chat', 'loading']);
  // The bubble comes back together with the thread's own messages, never ahead of them.
  expect(h.seen.map((msgs) => (msgs[0] as WorkspaceMessage).messageId)).toEqual(h.seen.map(() => 'a1'));

  // The agent acknowledges the message: its own step takes over from the bubble.
  await act(async () => deliver('thread-a', step('a4', 'thread-a')));
  expect(shown()).toEqual(['chat', 'status', 'chat', 'status']);
});

it('shows no stale bubble when the agent answered while the thread was not open', async () => {
  await open('thread-a');
  await act(async () => { await h.send!('hurry up'); });
  await open('thread-b');
  deliver('thread-a', msg('a3', 'thread-a', { content: 'hurry up' }), step('a4', 'thread-a'));

  h.seen = [];
  await open('thread-a');
  expect(shown()).toEqual(['chat', 'status', 'chat', 'status']);
  expect(h.seen.flat().some((m) => (m as WorkspaceMessage).messageType === 'loading')).toBe(false);
});

it('still shows the waiting bubble after ChatView unmounts and remounts', async () => {
  // Mobile: going to the thread list pane unmounts ChatView; so does a detour
  // through Files or the shared browser on desktop.
  await open('thread-a');
  await act(async () => { await h.send!('hurry up'); });
  await act(async () => deliver('thread-a', msg('a3', 'thread-a', { content: 'hurry up' })));
  expect(shown()).toEqual(['chat', 'status', 'chat', 'loading']);

  act(() => root.unmount());
  root = createRoot(container);
  h.seen = [];
  await open('thread-a');
  expect(shown()).toEqual(['chat', 'status', 'chat', 'loading']);
  // Still lands together with the thread's own messages, never ahead of them.
  expect(h.seen.map((msgs) => (msgs[0] as WorkspaceMessage).messageId)).toEqual(h.seen.map(() => 'a1'));

  await act(async () => deliver('thread-a', step('a4', 'thread-a')));
  expect(shown()).toEqual(['chat', 'status', 'chat', 'status']);
});

it('keeps pending messages of one workspace out of another with the same thread id', async () => {
  await open('thread-a');
  await act(async () => { await h.send!('hurry up'); });
  act(() => root.unmount());
  root = createRoot(container);
  h.ws = { ...h.ws, workspace: { workspaceId: 'ws-2' } };
  await open('thread-a');
  expect(shown()).toEqual(['chat', 'status']);
});


it('replying to an agent preserves the citation and targets that agent even without a typed mention', async () => {
  await open('thread-a');
  await act(async () => h.reply!(msg('agent-answer', 'thread-a', { senderType: 'agent', senderName: 'Friendly Bot', senderAddress: 'openagents:bot', content: 'Original answer' })));
  await act(async () => h.send!('Please explain this part'));
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0][3]).toEqual(['bot']);
  expect(h.sent[0].at(-1)).toBe('agent-answer');
});
