// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  roster: { humans: [], agents: [], can_add_people: true, can_add_agents: true },
  workspace: { workspaceId: 'ws' }, sessions: [{ sessionId: 'thread-1', participants: [] }],
  t: (key: string) => key,
}));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => state }));
vi.mock('@/lib/api', () => ({ workspaceApi: { getChannelParticipants: async () => state.roster } }));
vi.mock('@/lib/i18n', () => ({ useT: () => state.t }));
vi.mock('./thread-privacy-control', () => ({ threadPrivacyApplies: () => true }));
vi.mock('./add-thread-participants', () => ({ AddThreadParticipants: ({ kind, channelName, onOpenChange }: { kind: string; channelName: string; onOpenChange: (open: boolean) => void }) => React.createElement('button', { 'data-picker': kind, 'data-channel': channelName, onClick: () => onOpenChange(false) }, 'Close picker') }));
import { ThreadParticipantCount } from './thread-participant-count';
let root: Root;
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.roster.can_add_people = true; state.roster.can_add_agents = true;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ''; });
it.each([
  ['header.viewPeople', 'threadAccess.addMember', 'human'],
  ['header.viewAgents', 'threadAccess.addAgent', 'agent'],
])('opens the matching picker from %s and closes the roster popup', async (trigger, label, kind) => {
  await act(async () => root.render(React.createElement(ThreadParticipantCount, { channelName: 'thread-1' })));
  await act(async () => (document.querySelector(`button[aria-label="${trigger}"]`) as HTMLElement).click());
  const add = [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
  expect(add).toBeDefined();
  await act(async () => add.click());
  expect(document.querySelector('[data-picker]')?.getAttribute('data-picker')).toBe(kind);
  expect(document.querySelector('[data-picker]')?.getAttribute('data-channel')).toBe('thread-1');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => (document.querySelector('[data-picker]') as HTMLElement).click());
  expect(document.querySelector('[data-picker]')).toBeNull();
});
it('hides add actions when the viewer lacks permission', async () => {
  state.roster.can_add_people = false; state.roster.can_add_agents = false;
  await act(async () => root.render(React.createElement(ThreadParticipantCount, { channelName: 'thread-1' })));
  for (const trigger of ['header.viewPeople', 'header.viewAgents']) {
    await act(async () => (document.querySelector(`button[aria-label="${trigger}"]`) as HTMLElement).click());
    expect(document.body.textContent).not.toContain('threadAccess.addMember');
    expect(document.body.textContent).not.toContain('threadAccess.addAgent');
  }
});
