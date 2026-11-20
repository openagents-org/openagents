import type { WorkspaceNode } from './types';

type MemberFields = { agentName: string; displayName?: string | null; model?: string | null };

/**
 * Copy what the workspace knows about each agent onto the node roster.
 *
 * The daemon reports agents by handle only, while a rename in the workspace
 * changes the member's display name. A model picked in the workspace (the
 * agent profile's model picker) outranks the model the device has configured:
 * the agent runs on it. Without this merge the device view kept showing the
 * old handle after a rename, and "auto" after a model was picked. Nodes whose
 * agents need no change are returned as-is so memoized children do not
 * re-render.
 */
export function withWorkspaceAgentInfo(
  nodes: readonly WorkspaceNode[],
  agents: readonly MemberFields[],
): WorkspaceNode[] {
  const members = new Map(agents.map((a) => [a.agentName, a]));
  return nodes.map((node) => {
    let changed = false;
    const roster = (node.agents || []).map((a) => {
      const member = members.get(a.name);
      if (!member) return a;
      const displayName = member.displayName?.trim() || null;
      const model = member.model?.trim() || a.model || null;
      if ((a.displayName ?? null) === displayName && (a.model ?? null) === model) return a;
      changed = true;
      return { ...a, displayName, model };
    });
    return changed ? { ...node, agents: roster } : node;
  });
}
