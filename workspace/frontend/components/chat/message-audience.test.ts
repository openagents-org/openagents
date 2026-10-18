// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MessageAudience, messageAudience } from './message-audience';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceMessage } from '@/lib/types';
const t = (key: string) => key;
vi.mock('@/lib/i18n', () => ({ useT: () => t }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
vi.mock('@/lib/api', () => ({ workspaceApi: { getChannelParticipants: vi.fn(), discover: vi.fn(), resolveRoutingChoice: vi.fn() } }));
vi.stubGlobal('React', React);
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const message = { messageId: 'm1', sessionId: 'thread', senderType: 'human', messageType: 'chat', metadata: {}, targetAgents: ['__no_response__'] } as WorkspaceMessage;
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ''; vi.clearAllMocks(); });
it('uses recorded routing and does not label uncertain, optimistic, or approval messages as human', () => {
  expect(messageAudience(message)).toBe('human');
  expect(messageAudience({ ...message, targetAgents: ['helper'] })).toBe('agent');
  expect(messageAudience({ ...message, targetAgents: null })).toBeNull();
  expect(messageAudience({ ...message, messageId: 'optimistic-1' })).toBeNull();
  expect(messageAudience({ ...message, metadata: { approval_id: 'approval' } })).toBeNull();
  expect(messageAudience({ ...message, metadata: { routing_choice: { status: 'pending' } } })).toBe('pending');
  expect(messageAudience({ ...message, metadata: { routing_choice: { status: 'assigned' } } })).toBe('agent');
  expect(messageAudience({ ...message, metadata: { recalled: true } })).toBeNull();
});
it('offers only online thread members and reassigns the original message once', async () => {
  vi.mocked(workspaceApi.getChannelParticipants).mockResolvedValue({ agents: [{ agent_name: 'helper' }, { agent_name: 'offline' }], humans: [] } as never);
  vi.mocked(workspaceApi.discover).mockResolvedValue({ agents: [
    { address: 'openagents:helper', status: 'online' },
    { address: 'openagents:offline', status: 'offline' },
    { address: 'openagents:outsider', status: 'online' },
  ] } as never);
  vi.mocked(workspaceApi.resolveRoutingChoice).mockResolvedValue({ status: 'assigned', agent: 'helper' });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(MessageAudience, { message, isSender: true })));
  await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
  expect(document.body.textContent).not.toContain('offline');
  expect(document.body.textContent).not.toContain('outsider');
  const helper = [...document.querySelectorAll('button')].find(button => button.textContent === 'helper')!;
  await act(async () => { helper.click(); helper.click(); });
  expect(workspaceApi.resolveRoutingChoice).toHaveBeenCalledExactlyOnceWith('m1', 'helper', true);
  expect(host.textContent).toBe('routing.toAgent');
});
it('shows other senders a noninteractive label', async () => {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(React.createElement(MessageAudience, { message, isSender: false })));
  expect(host.textContent).toBe('routing.toHuman');
  expect(host.querySelector('button')).toBeNull();
});
