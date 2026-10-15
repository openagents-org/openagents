import { expect, it } from 'vitest';
import { sidebarAgents } from './sidebar-agents';
import type { WorkspaceAgent } from './types';

it('includes owned and directly usable shared agents, including offline agents', () => {
  const agents = [
    { agentName: 'mine', ownerEmail: ' ME@EXAMPLE.COM ', status: 'offline' },
    { agentName: 'shared-person', ownerEmail: 'other@example.com', status: 'online', canStartThread: true },
    { agentName: 'shared-group', ownerEmail: 'other@example.com', status: 'offline', canStartThread: true },
    { agentName: 'shared-everyone', ownerEmail: null, status: 'online', canStartThread: true },
    { agentName: 'private', ownerEmail: 'other@example.com', status: 'online', canStartThread: false },
    { agentName: 'thread-only', ownerEmail: 'other@example.com', status: 'online', isShared: true, canStartThread: false },
    { agentName: 'legacy-team-flag', ownerEmail: null, status: 'online', visibility: 'team' },
    { agentName: 'removed', ownerEmail: 'me@example.com', status: 'removed', canStartThread: true },
  ] as WorkspaceAgent[];
  expect(sidebarAgents(agents, 'me@example.com').map((a) => a.agentName))
    .toEqual(['mine', 'shared-person', 'shared-group', 'shared-everyone']);
  expect(sidebarAgents(agents, '')).toEqual([]);
});

it('removes a shared agent when its access is revoked without removing owned agents', () => {
  const agents = [
    { agentName: 'mine', ownerEmail: 'me@example.com', status: 'online', canStartThread: true },
    { agentName: 'shared', ownerEmail: 'other@example.com', status: 'online', canStartThread: true },
  ] as WorkspaceAgent[];
  expect(sidebarAgents(agents, 'me@example.com')).toHaveLength(2);
  expect(sidebarAgents(agents.map((agent) => ({ ...agent, canStartThread: false })), 'me@example.com')
    .map((agent) => agent.agentName)).toEqual(['mine']);
});
