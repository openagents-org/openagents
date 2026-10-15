// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ workspaceApi: { getChannelParticipants: mocks.get } }));
vi.mock('@/lib/workspace-context', () => ({ useWorkspace: () => ({ workspace: { workspaceId: 'w' }, currentUser: { id: 'me@example.com' } }) }));
import { useThreadMentionParticipants } from './use-thread-mention-emails';
function Harness({ channel }: { channel: string }) { return createElement('div', null, JSON.stringify(useThreadMentionParticipants(channel, true))); }
it('offers only current participants with request access, and clears stale suggestions when switching', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); const root = createRoot(host);
  mocks.get.mockResolvedValueOnce({ humans: [{ email: 'SAM@example.com' }], agents: [
    { agent_name: 'shared', request_access: 'yes' }, { agent_name: 'approval', request_access: 'approval' },
    { agent_name: 'private', request_access: 'no' }, { agent_name: 'unknown' },
  ] });
  await act(async () => root.render(createElement(Harness, { channel: 'one' })));
  expect(JSON.parse(host.textContent!)).toMatchObject({ emails: ['sam@example.com'], agents: ['shared', 'approval'] });
  let resolve!: (data: unknown) => void;
  mocks.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => root.render(createElement(Harness, { channel: 'two' })));
  expect(JSON.parse(host.textContent!)).toEqual({ emails: [], agents: [] });
  await act(async () => resolve({ humans: [], agents: [{ agent_name: 'second', request_access: 'yes' }] }));
  expect(JSON.parse(host.textContent!).agents).toEqual(['second']);
  await act(async () => root.render(createElement(Harness, { channel: 'dm:human:me@example.com,openagents:direct-agent' })));
  expect(JSON.parse(host.textContent!).agents).toEqual(['direct-agent']);
  await act(async () => root.unmount());
});
