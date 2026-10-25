import type { WorkspaceAgent } from './types';

export function isOwnedAgent(agent: WorkspaceAgent, email: string): boolean {
  const viewer = email.trim().toLowerCase();
  return !!viewer && agent.ownerEmail?.trim().toLowerCase() === viewer;
}

/** Yumi belongs in everyone's own sidebar group, without changing ownership permissions. */
export function isMySidebarAgent(agent: WorkspaceAgent, email: string): boolean {
  return agent.builtin === true || isOwnedAgent(agent, email);
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
  // Yumi leads its group: with five of the viewer's own agents online it
  // otherwise sorted past the cut-off and the help it offers went out of sight.
  const permitted = sidebarAgents(agents, email).filter(agent => agent.status === 'online').sort((a, b) =>
    Number(b.builtin === true) - Number(a.builtin === true) ||
    Number(b.status === 'online') - Number(a.status === 'online') ||
    (recency.get(b.agentName) || 0) - (recency.get(a.agentName) || 0) || a.agentName.localeCompare(b.agentName));
  return [true, false].map(owned => {
    const all = permitted.filter(agent => isMySidebarAgent(agent, email) === owned);
    const shown = all.slice(0, 5);
    return { owned, all, shown, moreOnline: all.length - shown.length };
  });
}
