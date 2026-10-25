// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { NewThreadDialog } from './new-thread-dialog';
import { workspaceApi } from '@/lib/api';
import type { TeamMember, WorkspaceAgent } from '@/lib/types';

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
const teammates = [{ email: 'priya@example.com', displayName: 'Priya Nair' }] as TeamMember[];
const agent = { agentName: 'helper', status: 'online' } as WorkspaceAgent;
async function render(agents: WorkspaceAgent[], onCreateThread: React.ComponentProps<typeof NewThreadDialog>['onCreateThread'], people = teammates) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const onOpenChange = vi.fn();
  await act(async () => root.render(React.createElement(NewThreadDialog, { open: true, onOpenChange, agents, teammates: people, onCreateThread })));
  return onOpenChange;
}
function button(text: string) {
  const element = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes(text));
  if (!element) throw new Error(`Missing button: ${text}`);
  return element;
}
it.each([true, false])('creates a thread with the selected teammate, with agents=%s', async (withAgent) => {
  const send = vi.spyOn(workspaceApi, 'sendEvent').mockResolvedValue({ id: 'created', type: 'network.channel.create', source: 'human:user', target: 'core', payload: null, visibility: 'private', timestamp: Date.now(), metadata: { channel_name: 'new-thread' } });
  const close = await render(withAgent ? [agent] : [], async (opts) => { await workspaceApi.createChannel(opts); });
  if (!withAgent) expect(button('newThread.start').disabled).toBe(true);
  await act(async () => button('Priya Nair').click());
  expect(button('Priya Nair').getAttribute('aria-checked')).toBe('true');
  expect(button('newThread.start').disabled).toBe(false);
  expect(document.body.textContent).not.toContain('threadAccess.shareWithGroups');
  await act(async () => button('newThread.start').click());
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    type: 'network.channel.create',
    payload: { participants: withAgent ? ['helper'] : [], human_participants: ['priya@example.com'], visibility: 'private' },
  }));
  expect(close).toHaveBeenCalledWith(false);
});
it('keeps selections available to retry if creation fails', async () => {
  const create = vi.fn().mockRejectedValue(new Error('unavailable'));
  const close = await render([], create);
  await act(async () => button('Priya Nair').click());
  await act(async () => button('newThread.start').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('newThread.createError');
  expect(button('Priya Nair').getAttribute('aria-checked')).toBe('true');
  expect(button('newThread.start').disabled).toBe(false);
  expect(close).not.toHaveBeenCalled();
});

it('searches a large roster and preserves selections across filters', async () => {
  const people = Array.from({ length: 30 }, (_, i) => ({ email: `person${i}@example.com`, displayName: `Person ${i}` })) as TeamMember[];
  const agents = Array.from({ length: 15 }, (_, i) => ({ agentName: `agent-${i}`, status: 'online' })) as WorkspaceAgent[];
  const create = vi.fn().mockResolvedValue(undefined);
  await render(agents, create, people);
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(45);
  const search = async (value: string) => {
    const input = document.querySelector('input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  await search('person29@example.com');
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
  await act(async () => button('Person 29').click());
  await search('');
  await act(async () => button('newThread.agents').click());
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(15);
  await search('agent-14');
  await act(async () => button('agent-14').click());
  await search('');
  await act(async () => button('newThread.selected').click());
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(2);
  await act(async () => button('Person 29').click());
  expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(1);
  await act(async () => button('newThread.start').click());
  expect(create).toHaveBeenCalledWith({ participants: ['agent-14'], humanParticipants: [], resumeFrom: undefined, visibility: 'private', asChannel: false });
});

vi.mock('@/hooks/use-team-roster', () => ({ useTeamRoster: () => [] }));
