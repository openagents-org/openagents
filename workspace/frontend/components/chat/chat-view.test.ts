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
  send: null as null | ((text: string) => Promise<void>),
  mounted: null as null | { sessionId: string | null; setMessages: (msgs: unknown[]) => void },
}));

vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => h.ws }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
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
    sendMessage: async () => ({}),
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
  ChatMessages: ({ messages }: { messages: unknown[] }) => { h.seen.push(messages); return null; },
}));
vi.mock('./chat-input', () => ({
  ChatInput: ({ onSend }: { onSend: (text: string) => Promise<void> }) => { h.send = onSend; return null; },
}));
vi.mock('./yumi-guide', () => ({ YumiGuide: () => null }));
vi.mock('./yumi-dm-intro', () => ({ YumiDmIntro: () => null }));
vi.mock('./thread-status-bar', () => ({ ThreadStatusBar: () => null }));
vi.mock('./empty-state', () => ({ EmptyState: () => null }));
vi.mock('./share-dialog', () => ({ ShareDialog: () => null }));
vi.mock('./orchestration-control', () => ({ OrchestrationControl: () => null }));
vi.mock('@/components/layout/app-header', () => ({ DetailHeader: () => null }));
vi.mock('@/components/agents/agent-avatar', () => ({ AgentAvatar: () => null }));
vi.mock('@/components/routines/create-routine-dialog', () => ({ CreateRoutineDialog: () => null }));

import { ChatView } from './chat-view';

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
  h.seen = [];
  h.threads = {
    'thread-a': [msg('a1', 'thread-a'), step('a2', 'thread-a')],
    'thread-b': [msg('b1', 'thread-b'), step('b2', 'thread-b')],
  };
  h.ws = {
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
