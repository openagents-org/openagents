import type { WorkspaceAgent } from './types';

/** The personal roster never includes other people's or unclaimed agents. */
export function ownedSidebarAgents(agents: WorkspaceAgent[], email: string) {
  const owner = email.trim().toLowerCase();
  return owner ? agents.filter((agent) => agent.ownerEmail?.trim().toLowerCase() === owner && agent.status !== 'removed') : [];
}
