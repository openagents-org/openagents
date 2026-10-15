import type { WorkspaceAgent } from './types';

/** Owned agents and agents the server permits this viewer to contact directly. */
export function sidebarAgents(agents: WorkspaceAgent[], email: string) {
  const viewer = email.trim().toLowerCase();
  if (!viewer) return [];
  return agents.filter((agent) => agent.status !== 'removed' && (
    agent.ownerEmail?.trim().toLowerCase() === viewer || agent.canStartThread === true
  ));
}
