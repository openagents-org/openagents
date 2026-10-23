// @vitest-environment jsdom
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({ openAgent: vi.fn() }));
const state = vi.hoisted(() => ({
  workspace: { workspaceId: 'test' },
  currentUser: { id: 'person@example.com', name: 'Person', isAuthenticated: true },
  currentSessionId: 'alpha',
  sessions: ['alpha', 'beta'].map(sessionId => ({ sessionId, title: sessionId, participants: [], responseMode: 'proactive' })),
  agents: [], knowledge: [], files: [], browserTabs: [], activeSessionIds: new Set(), stoppingSessionIds: new Set(),
  consumeSkipFocus: () => false, updateLastMessage: () => {}, setSessionActive: () => {},
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => state }));
vi.mock('@/components/layout/layout-context', () => ({ useLayout: () => ({ isMobile: false, setSelectedAgentName: profile.openAgent }) }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('@/lib/api', () => ({ workspaceApi: { listNodes: async () => [] } }));
vi.mock('@/lib/analytics', () => ({ capture: vi.fn() }));
vi.mock('@/hooks/use-polling', () => ({ useMessagePolling: () => ({ messages: [], generation: 0 }) }));
vi.mock('@/hooks/use-composing-signal', () => ({ useComposingSignal: () => ({}) }));
vi.mock('@/hooks/use-me', () => ({ useMe: () => null }));
vi.mock('@/hooks/use-team-roster', () => ({ useHumanNames: () => ({}), useTeamRoster: () => [] }));
vi.mock('./work-brief', () => ({ WorkBrief: () => null, useBrief: () => ({}) }));
vi.mock('./chat-messages', () => ({ ChatMessages: () => null }));
vi.mock('./chat-input', () => ({ ChatInput: () => null }));
vi.mock('./human-profile', () => ({ HumanProfile: ({ email }: { email: string | null }) => email ? createElement('div', { 'data-human-profile': email }) : null }));
vi.mock('./thread-status-bar', () => ({ ThreadStatusBar: () => null }));
vi.mock('./empty-state', () => ({ EmptyState: () => null, EmptyConversation: () => null }));
vi.mock('./yumi-guide', () => ({ YumiGuide: () => null }));
vi.mock('./yumi-dm-intro', () => ({ YumiDmIntro: () => null }));
vi.mock('./share-dialog', () => ({ ShareDialog: () => null }));
vi.mock('@/components/routines/routine-dialog', () => ({ RoutineDialog: () => null }));
vi.mock('./thread-participant-count', () => ({ ThreadParticipantCount: () => null }));
vi.mock('./thread-privacy-control', () => ({ threadPrivacyApplies: () => true, ThreadPrivacyControl: () => null }));
vi.mock('@/hooks/use-thread-access', () => ({ useThreadAccess: () => null }));
vi.mock('./response-mode-control', () => ({
  ResponseModeControl: () => createElement('button', { 'data-control': 'response-mode' }, 'Proactive'),
}));
vi.mock('./add-thread-participants', () => ({
  AddThreadParticipants: () => createElement('button', { 'data-control': 'add-participants' }, 'Add people or agents'),
}));

import { ChatView } from './chat-view';
import { DialogsProvider } from '@/components/ui/dialogs-provider';

// Next uses the automatic JSX runtime; Vitest needs React for TSX modules.
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

it('keeps exactly one mode and participant control after repeated thread switches', async () => {
  document.body.innerHTML = '<div id="root"></div><div id="app-header-actions"></div>';
  const root = createRoot(document.getElementById('root')!);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const sessionId of ['alpha', 'beta', 'alpha', 'beta', 'alpha']) {
      state.currentSessionId = sessionId;
      await act(async () => { root.render(createElement(DialogsProvider, null, createElement(ChatView))); });
      const header = document.getElementById('app-header-actions')!;
      expect(header.querySelectorAll('[data-control="response-mode"]')).toHaveLength(1);
      expect(header.querySelectorAll('[data-control="add-participants"]')).toHaveLength(1);
    }
    expect(errors.mock.calls.filter(call => call.some(value => String(value).includes('same key')))).toEqual([]);
  } finally {
    await act(async () => root.unmount());
  }
});

it('opens DM profiles only after clicking the name in the header', async () => {
  document.body.innerHTML = '<div id="root"></div><div id="app-header-actions"></div><div id="app-header-title"></div>';
  profile.openAgent.mockClear();
  const root = createRoot(document.getElementById('root')!);
  try {
    state.currentSessionId = 'dm:human:person@example.com,openagents:scout';
    await act(async () => { root.render(createElement(DialogsProvider, null, createElement(ChatView))); });
    expect(profile.openAgent).not.toHaveBeenCalled();
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('#app-header-title button')).find(b => b.textContent === 'scout');
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(profile.openAgent).toHaveBeenCalledWith('scout');
    state.currentSessionId = 'dm:human:person@example.com,human:sam@example.com';
    await act(async () => { root.render(createElement(DialogsProvider, null, createElement(ChatView))); });
    expect(document.querySelector('[data-human-profile]')).toBeNull();
    const person = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'sam@example.com');
    expect(person).toBeDefined();
    await act(async () => person!.click());
    expect(document.querySelector('[data-human-profile]')?.getAttribute('data-human-profile')).toBe('sam@example.com');
  } finally { await act(async () => root.unmount()); }
});
