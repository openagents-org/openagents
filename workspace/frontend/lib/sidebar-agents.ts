import type { WorkspaceAgent } from './types';

/** The personal roster never includes other people's or unclaimed agents. */
export function ownedSidebarAgents(agents: WorkspaceAgent[], email: string) {
  const owner = email.trim().toLowerCase();
  return owner
    ? agents
        .filter((agent) => agent.ownerEmail?.trim().toLowerCase() === owner && agent.status !== 'removed')
        .sort((a, b) => {
          const aJoinedAt = a.joinedAt ? Date.parse(a.joinedAt) : Number.NaN;
          const bJoinedAt = b.joinedAt ? Date.parse(b.joinedAt) : Number.NaN;
          const aHasJoinedAt = Number.isFinite(aJoinedAt);
          const bHasJoinedAt = Number.isFinite(bJoinedAt);

          if (aHasJoinedAt && bHasJoinedAt && aJoinedAt !== bJoinedAt) {
            return aJoinedAt - bJoinedAt;
          }
          if (aHasJoinedAt !== bHasJoinedAt) return aHasJoinedAt ? -1 : 1;
          return a.agentName.localeCompare(b.agentName);
        })
    : [];
}
