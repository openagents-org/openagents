// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AddThreadParticipants } from './add-thread-participants';
import { workspaceApi } from '@/lib/api';

const state = vi.hoisted(() => ({ access: { can_add_people: true, can_add_agents: true }, t: (key: string) => key, refreshAgents: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/hooks/use-thread-access', () => ({ useThreadAccess: () => state.access }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/i18n', () => ({ useT: () => state.t }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ refreshAgents: state.refreshAgents }) }));
vi.mock('@/lib/api', () => ({ workspaceApi: {
  getChannelParticipants: vi.fn(), getTeam: vi.fn(), discover: vi.fn(),
  inviteHumanToChannel: vi.fn(), addChannelParticipant: vi.fn(),
} }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  state.access = { can_add_people: true, can_add_agents: true };
  vi.mocked(workspaceApi.getChannelParticipants).mockResolvedValue({ humans: [{ email: 'joined@example.com' }], agents: [{ agent_name: 'existing-bot' }] } as Awaited<ReturnType<typeof workspaceApi.getChannelParticipants>>);
  vi.mocked(workspaceApi.getTeam).mockResolvedValue([
    { email: 'joined@example.com', displayName: 'Already Joined' },
    { email: 'sam@example.com', displayName: 'Sam' },
  ] as Awaited<ReturnType<typeof workspaceApi.getTeam>>);
  vi.mocked(workspaceApi.discover).mockResolvedValue({ agents: [
    { address: 'openagents:existing-bot', status: 'online' },
    { address: 'openagents:helper', status: 'online' },
    { address: 'openagents:yumi', status: 'online', builtin: true },
    { address: 'openagents:offline-bot', status: 'offline' },
    { address: 'openagents:unknown-bot' },
  ] } as Awaited<ReturnType<typeof workspaceApi.discover>>);
  vi.mocked(workspaceApi.inviteHumanToChannel).mockResolvedValue({ added: true, email: 'sam@example.com' });
  vi.mocked(workspaceApi.addChannelParticipant).mockResolvedValue();
});
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; });
function button(text: string) {
  const node = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
  if (!node) throw new Error(`Missing ${text}`);
  return node;
}
async function open() {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(AddThreadParticipants, { channelName: 'thread-1' })));
  await act(async () => (document.querySelector('button[aria-label="threadAccess.addParticipants"]') as HTMLButtonElement).click());
}
it('shows the roster immediately, excludes existing members, and adds selected people and agents', async () => {
  await open();
  expect(document.querySelector('input[aria-label="newThread.search"]')).not.toBeNull();
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
  expect(document.body.textContent).not.toContain('Already Joined');
  expect(document.body.textContent).not.toContain('existing-bot');
  expect(document.body.textContent).not.toContain('offline-bot');
  expect(document.body.textContent).not.toContain('yumi');
  expect(document.body.textContent).not.toContain('unknown-bot');
  expect(button('newThread.agents').textContent).toBe('newThread.agents 1');
  await act(async () => button('Sam').click());
  await act(async () => button('helper').click());
  await act(async () => button('newThread.selected').click());
  expect(document.querySelectorAll('[role="checkbox"][aria-checked="true"]')).toHaveLength(2);
  await act(async () => button('threadAccess.addParticipantsButton').click());
  expect(workspaceApi.inviteHumanToChannel).toHaveBeenCalledWith('thread-1', 'sam@example.com');
  expect(workspaceApi.addChannelParticipant).toHaveBeenCalledWith('thread-1', 'helper');
});
it('only offers agents when the member cannot add people', async () => {
  state.access.can_add_people = false;
  await open();
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
  expect(document.body.textContent).not.toContain('Sam');
  await act(async () => button('helper').click());
  await act(async () => button('threadAccess.addParticipantsButton').click());
  expect(workspaceApi.inviteHumanToChannel).not.toHaveBeenCalled();
});
it('does not offer stale selections when the roster fails to load', async () => {
  vi.mocked(workspaceApi.getTeam).mockRejectedValueOnce(new Error('offline'));
  await open();
  expect(document.body.textContent).toContain('collab.participantsLoadFailed');
  expect(button('threadAccess.addParticipantsButton').disabled).toBe(true);
  await act(async () => button('common.retry').click());
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
});
