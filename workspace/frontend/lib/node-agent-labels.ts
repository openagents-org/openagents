import type { WorkspaceNode } from './types';

/**
 * Copy each agent's workspace display name onto the node roster.
 *
 * The daemon reports agents by handle only, while a rename in the workspace
 * changes the member's display name. Without this merge the device view keeps
 * showing the old handle after a rename. Nodes whose agents need no change are
 * returned as-is so memoized children do not re-render.
 */
export function withAgentDisplayNames(
  nodes: readonly WorkspaceNode[],
  agents: readonly { agentName: string; displayName?: string | null }[],
): WorkspaceNode[] {
  const labels = new Map(agents.map((a) => [a.agentName, a.displayName?.trim() || null]));
  return nodes.map((node) => {
    let changed = false;
    const roster = (node.agents || []).map((a) => {
      if (!labels.has(a.name)) return a;
      const displayName = labels.get(a.name) ?? null;
      if ((a.displayName ?? null) === displayName) return a;
      changed = true;
      return { ...a, displayName };
    });
    return changed ? { ...node, agents: roster } : node;
  });
}
