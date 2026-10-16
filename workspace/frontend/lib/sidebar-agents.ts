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
