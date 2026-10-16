import type { WorkspaceAgent } from './types';

export function isOwnedAgent(agent: WorkspaceAgent, email: string): boolean {
  const viewer = email.trim().toLowerCase();
  return !!viewer && agent.ownerEmail?.trim().toLowerCase() === viewer;
}

/** Owned agents and agents the server permits this viewer to contact directly. */
export function sidebarAgents(agents: WorkspaceAgent[], email: string) {
  const viewer = email.trim().toLowerCase();
  if (!viewer) return [];
  return agents.filter((agent) => agent.status !== 'removed' && (
    isOwnedAgent(agent, viewer) || agent.canStartThread === true
  )).sort((a, b) => Number(isOwnedAgent(b, viewer)) - Number(isOwnedAgent(a, viewer)));
}

/** Presence first, then the viewer's latest DM; each category has its own budget. */
export function sidebarAgentGroups(agents: WorkspaceAgent[], email: string, conversations: import('./types').DMConversation[] = []) {
  const recency = new Map<string, number>();
  for (const conversation of conversations) {
    if (!conversation.agents.includes(`human:${email.trim().toLowerCase()}`)) continue;
    for (const address of conversation.agents) {
      if (address.startsWith('openagents:')) {
        const name = address.slice('openagents:'.length);
        recency.set(name, Math.max(recency.get(name) || 0, conversation.lastMessage.timestamp));
      }
    }
  }
  const permitted = sidebarAgents(agents, email).sort((a, b) =>
    Number(b.status === 'online') - Number(a.status === 'online') ||
    (recency.get(b.agentName) || 0) - (recency.get(a.agentName) || 0) || a.agentName.localeCompare(b.agentName));
  return [true, false].map(owned => {
    const all = permitted.filter(agent => isOwnedAgent(agent, email) === owned);
    const shown = all.filter(agent => agent.status === 'online').slice(0, 5);
    return { owned, all, shown, moreOnline: all.filter(agent => agent.status === 'online').length - shown.length };
  });
}
