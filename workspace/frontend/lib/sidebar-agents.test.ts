import { expect, it } from 'vitest';
import { sidebarAgents, sidebarAgentGroups, isOwnedAgent } from './sidebar-agents';
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

it('bounds each category to five, sorts by DM recency and excludes offline agents from the picker', () => {
  const agents = Array.from({ length: 16 }, (_, i) => ({ agentName: `agent-${i}`, ownerEmail: i < 7 ? 'me@example.com' : 'other@example.com', status: i === 15 ? 'offline' : 'online', canStartThread: true })) as WorkspaceAgent[];
  const conversations = [{ agents: ['human:me@example.com', 'openagents:agent-6'], lastMessage: { timestamp: 10 } }, { agents: ['human:me@example.com', 'openagents:agent-14'], lastMessage: { timestamp: 20 } }] as import('./types').DMConversation[];
  const [mine, shared] = sidebarAgentGroups(agents, 'me@example.com', conversations);
  expect(mine.shown).toHaveLength(5); expect(shared.shown).toHaveLength(5);
  expect(mine.shown[0].agentName).toBe('agent-6'); expect(shared.shown[0].agentName).toBe('agent-14');
  expect(mine.moreOnline).toBe(2); expect(shared.moreOnline).toBe(3);
  expect(shared.all.some(agent => agent.agentName === 'agent-15')).toBe(false);
});

it('groups built-in Yumi with my agents without granting ownership', () => {
  const yumi = { agentName: 'yumi', builtin: true, ownerEmail: null, status: 'online', canStartThread: true } as WorkspaceAgent;
  const shared = { agentName: 'shared', ownerEmail: 'other@example.com', status: 'online', canStartThread: true } as WorkspaceAgent;
  const [mine, others] = sidebarAgentGroups([shared, yumi], 'me@example.com');
  expect(mine.shown.map(agent => agent.agentName)).toEqual(['yumi']);
  expect(others.shown.map(agent => agent.agentName)).toEqual(['shared']);
  expect(isOwnedAgent(yumi, 'me@example.com')).toBe(false);
});

it('keeps Yumi in view ahead of five of the viewer\'s own online agents', () => {
  const agents = [
    ...Array.from({ length: 6 }, (_, i) => ({ agentName: `a-${i}`, ownerEmail: 'me@example.com', status: 'online' })),
    { agentName: 'yumi', ownerEmail: null, status: 'online', builtin: true, canStartThread: true },
  ] as WorkspaceAgent[];
  const conversations = [{ agents: ['human:me@example.com', 'openagents:a-3'], lastMessage: { timestamp: 10 } }] as import('./types').DMConversation[];
  const [mine] = sidebarAgentGroups(agents, 'me@example.com', conversations);
  expect(mine.shown[0].agentName).toBe('yumi');
  expect(mine.shown[1].agentName).toBe('a-3');
});
