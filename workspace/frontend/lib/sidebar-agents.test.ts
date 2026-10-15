import { expect, it } from 'vitest';
import { ownedSidebarAgents } from './sidebar-agents';
import type { WorkspaceAgent } from './types';
it('shows only owned agents including offline ones, not shared or unclaimed agents', () => {
  const agents = [
    { agentName: 'mine', ownerEmail: ' ME@EXAMPLE.COM ', status: 'offline' },
    { agentName: 'shared', ownerEmail: 'other@example.com', status: 'online', visibility: 'workspace' },
    { agentName: 'unclaimed', ownerEmail: null, status: 'online' },
  ] as WorkspaceAgent[];
  expect(ownedSidebarAgents(agents, 'me@example.com').map((a) => a.agentName)).toEqual(['mine']);
  expect(ownedSidebarAgents(agents, '')).toEqual([]);
});
