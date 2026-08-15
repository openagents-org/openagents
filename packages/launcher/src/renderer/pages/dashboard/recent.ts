import { lastActiveOf } from "@renderer/lib/relative-time"
import type { Agent, Workspace } from "@renderer/types"

/**
 * When each agent was last active: its newest message if it ever posted one,
 * otherwise whatever the daemon knows (start time). Both are approximations,
 * and either beats showing nothing.
 */
export function mergeActivity(
  agents: Agent[],
  byMessage: Record<string, string>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const a of agents) out[a.name] = byMessage[a.name] ?? lastActiveOf(a)
  return out
}

/** The few most recently active agents, newest first. */
export function pickRecentAgents(
  agents: Agent[],
  activity: Record<string, string | undefined>,
  limit: number,
): Agent[] {
  const at = (a: Agent): number => {
    const ts = new Date(activity[a.name] ?? 0).getTime()
    return Number.isNaN(ts) ? 0 : ts
  }
  // Agents that have never been active tie at 0, so name keeps the order stable
  // rather than letting it shuffle on every poll.
  return [...agents]
    .sort((a, b) => at(b) - at(a) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** Display name for a workspace, in the order the rest of the app prefers. */
export function workspaceName(ws: Workspace): string {
  return ws.name || ws.slug || ws.id
}

/**
 * The few workspaces the user opened most recently. "Used" is what the
 * launcher itself recorded when the user opened one — the daemon has no notion
 * of it — so workspaces never opened from here fall to the end, by name.
 */
export function pickRecentWorkspaces(
  workspaces: Workspace[],
  lastUsedAt: Record<string, string>,
  limit: number,
): Workspace[] {
  const at = (ws: Workspace): number => {
    const ts = new Date(lastUsedAt[ws.id] ?? 0).getTime()
    return Number.isNaN(ts) ? 0 : ts
  }
  return [...workspaces]
    .sort((a, b) => at(b) - at(a) || workspaceName(a).localeCompare(workspaceName(b)))
    .slice(0, limit)
}
