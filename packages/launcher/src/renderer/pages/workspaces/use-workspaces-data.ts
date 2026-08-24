import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import { useAgentsStore } from "@renderer/store/agents"
import { useConnectionsStore } from "@renderer/store/connections"
import { useWorkspacePrefs } from "@renderer/store/workspace-prefs"
import type { WorkspaceCardData } from "@renderer/components/workspaces/WorkspaceCard"
import type { WorkspaceHealthState } from "@renderer/components/workspaces/WorkspaceHealth"
import type { Agent, ChatSessionMeta, Workspace } from "@renderer/types"

/** How often the list re-polls the daemon for workspace/agent state. */
const POLL_MS = 8000

/**
 * `device` is this machine being paired to the workspace as a node: the
 * connection is real even with no agent bound here yet (agents get installed
 * from the workspace side afterwards), so it must not read as "disconnected".
 */
function deriveHealth(
  agents: Agent[],
  device: boolean,
  revoked: boolean,
): WorkspaceHealthState {
  // A revoked pairing outranks agent health: the workspace kicked this device,
  // so whatever the agents report locally, the connection needs re-pairing.
  if (revoked) return "revoked"
  if (agents.length === 0) return device ? "device" : "disconnected"
  if (agents.some((a) => a.state === "error" || a.lastError)) return "error"
  if (agents.some((a) => a.state === "starting" || a.state === "reconnecting"))
    return "warning"
  if (agents.some((a) => ["online", "running", "idle"].includes(a.state)))
    return "healthy"
  return "warning"
}

export interface WorkspaceStats {
  healthy: number
  warning: number
  error: number
  disconnected: number
  total: number
}

/** Toolbar filter. "problem" folds warning and error together. */
export const WORKSPACE_FILTERS = ["all", "healthy", "problem", "disconnected"] as const
export type WorkspaceFilter = (typeof WORKSPACE_FILTERS)[number]

export const WORKSPACE_SORTS = ["recent", "name", "agents"] as const
export type WorkspaceSort = (typeof WORKSPACE_SORTS)[number]

interface WorkspacesData {
  workspaces: Workspace[]
  aliases: Record<string, string>
  setAliases: React.Dispatch<React.SetStateAction<Record<string, string>>>
  filtered: WorkspaceCardData[]
  stats: WorkspaceStats
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Loads workspaces, their agents and chat sessions, then derives the card list
 * (health, last activity, connected platforms) and the header counters.
 */
export function useWorkspacesData(
  search: string,
  filter: WorkspaceFilter = "all",
  sort: WorkspaceSort = "recent",
): WorkspacesData {
  const agents = useAgentsStore((s) => s.agents)
  const connections = useConnectionsStore((s) => s.connections)
  const { favorites, lastUsedAt } = useWorkspacePrefs(
    useShallow((s) => ({ favorites: s.favorites, lastUsedAt: s.lastUsedAt })),
  )

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
  /**
   * Workspaces this device is paired to as a node, by slug AND id (either can
   * be what a workspace record is keyed by locally). A device can be a node in
   * several workspaces at once, so this is a set rather than one value.
   */
  const [nodeWorkspaces, setNodeWorkspaces] = useState<Set<string>>(
    () => new Set(),
  )
  /** Workspaces whose pairing the server revoked — card shows re-pair. */
  const [revokedWorkspaces, setRevokedWorkspaces] = useState<Set<string>>(
    () => new Set(),
  )
  const [loading, setLoading] = useState(true)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadAliases = useCallback(async (wsList: Workspace[]) => {
    const next: Record<string, string> = {}
    await Promise.all(
      wsList.map(async (w) => {
        try {
          const v = (await window.api.getSetting(`workspace-aliases:${w.id}`)) as
            | string
            | undefined
          if (typeof v === "string" && v) next[w.id] = v
        } catch {}
      }),
    )
    if (mounted.current) setAliases(next)
  }, [])

  const reload = useCallback(async () => {
    try {
      const [ws, ag] = await Promise.all([
        window.api.listWorkspaces(),
        window.api.listAgents(),
      ])
      if (!mounted.current) return
      setWorkspaces(ws)
      useAgentsStore.getState().setAgents(ag)
      setLoading(false)
      try {
        // Verified against the workspace (throttled main-side to once a
        // minute), so a device the workspace has unpaired stops showing here.
        const node = await window.api.refreshNodeStatus()
        if (!mounted.current) return
        const keys = new Set<string>()
        for (const w of node.workspaces || []) {
          if (w.workspaceSlug) keys.add(w.workspaceSlug)
          if (w.workspaceId) keys.add(w.workspaceId)
        }
        setNodeWorkspaces(keys)
        const revoked = new Set<string>()
        for (const r of node.revoked || []) {
          if (r.workspaceSlug) revoked.add(r.workspaceSlug)
          if (r.workspaceId) revoked.add(r.workspaceId)
        }
        setRevokedWorkspaces(revoked)
      } catch {}
      // Pull session metadata across all workspaces in parallel so we can
      // show "Last message" + previews on each card.
      try {
        const allSessions = await window.api.sessionList()
        if (mounted.current) setSessions(allSessions)
      } catch {}
      loadAliases(ws)
    } catch (err) {
      console.error(err)
      setLoading(false)
    }
  }, [loadAliases])

  useEffect(() => {
    reload()
    const id = setInterval(reload, POLL_MS)
    return () => clearInterval(id)
  }, [reload])

  /**
   * Per-workspace connected platforms. We resolve via the agent set:
   * a workspace's agent → that agent type's saved env file may carry a
   * credential we previously applied; we then list distinct providers
   * from the credentials store that name those agent types in
   * `usedByAgents`. This stays accurate as long as users use the
   * "Apply to agent" flow from the Credentials tab.
   *
   * Limitation: connections that haven't been applied to any agent (just
   * sitting in the Connections tab) won't show on a workspace card —
   * that's correct behavior since the workspace's agents can't use them.
   */
  const platformsByWorkspace = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const ws of workspaces) {
      const slug = ws.slug || ws.id
      const wsAgentTypes = new Set(
        agents
          .filter((a) => a.network === slug || a.network === ws.id)
          .map((a) => a.type),
      )
      const platforms = new Set<string>()
      for (const conn of connections) {
        if (conn.status !== "connected") continue
        if (!conn.credentialId) continue
        // Currently we don't know which agent types each credential was
        // applied to from the renderer side, so fall back to platforms
        // that match any installed agent type by name (e.g. agent type
        // 'openai-chat' → 'openai'). This is a heuristic until the main
        // process exposes credential.usedByAgents directly.
        for (const t of wsAgentTypes) {
          if (t.toLowerCase().includes(conn.platform)) {
            platforms.add(conn.platform)
            break
          }
        }
      }
      m.set(ws.id, Array.from(platforms))
    }
    return m
  }, [workspaces, agents, connections])

  const cards = useMemo<WorkspaceCardData[]>(() => {
    return workspaces.map((ws) => {
      const slug = ws.slug || ws.id
      const linkedAgents = agents.filter(
        (a) => a.network === slug || a.network === ws.id,
      )
      const wsSessions = sessions.filter(
        (s) => s.workspaceId === ws.id || s.workspaceSlug === slug,
      )
      wsSessions.sort(
        (a, b) =>
          new Date(b.lastMessageAt || b.createdAt).getTime() -
          new Date(a.lastMessageAt || a.createdAt).getTime(),
      )
      const topSession = wsSessions[0] || null
      const aliasName = aliases[ws.id]
      // The device relationship is its own fact, kept beside health rather
      // than folded into it: once an agent binds here, health becomes
      // "healthy" and the card would otherwise stop saying that this machine
      // is the node behind it.
      const device = nodeWorkspaces.has(slug) || nodeWorkspaces.has(ws.id)
      const revoked =
        revokedWorkspaces.has(slug) || revokedWorkspaces.has(ws.id)
      return {
        ws: aliasName ? { ...ws, name: aliasName } : ws,
        agents: linkedAgents,
        health: deriveHealth(linkedAgents, device, revoked),
        device,
        lastActiveAt: topSession?.lastMessageAt || lastUsedAt[ws.id] || null,
        lastMessageAt: topSession?.lastMessageAt || null,
        lastMessagePreview: topSession?.lastMessagePreview || null,
        sessionCount: wsSessions.length,
        connectedPlatforms: platformsByWorkspace.get(ws.id) || [],
      }
    })
  }, [
    workspaces,
    agents,
    sessions,
    aliases,
    lastUsedAt,
    platformsByWorkspace,
    nodeWorkspaces,
    revokedWorkspaces,
  ])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const arr = cards.filter((c) => {
      if (filter === "healthy" && c.health !== "healthy") return false
      if (
        filter === "problem" &&
        c.health !== "warning" &&
        c.health !== "error" &&
        c.health !== "revoked"
      )
        return false
      if (filter === "disconnected" && c.health !== "disconnected") return false
      if (!q) return true
      const slug = c.ws.slug || c.ws.id
      return (
        (c.ws.name || "").toLowerCase().includes(q) ||
        slug.toLowerCase().includes(q) ||
        c.agents.some((a) => a.name.toLowerCase().includes(q))
      )
    })
    const byName = (a: WorkspaceCardData, b: WorkspaceCardData): number =>
      (a.ws.name || a.ws.slug || a.ws.id).localeCompare(
        b.ws.name || b.ws.slug || b.ws.id,
      )
    arr.sort((a, b) => {
      // Favourites stay pinned whatever the sort — that is what starring one
      // is for; the selected order applies within each group.
      const aFav = favorites.has(a.ws.id) ? 0 : 1
      const bFav = favorites.has(b.ws.id) ? 0 : 1
      if (aFav !== bFav) return aFav - bFav
      if (sort === "name") return byName(a, b)
      if (sort === "agents" && a.agents.length !== b.agents.length)
        return b.agents.length - a.agents.length
      if (sort === "recent") {
        const aTs = new Date(lastUsedAt[a.ws.id] || a.lastActiveAt || 0).getTime()
        const bTs = new Date(lastUsedAt[b.ws.id] || b.lastActiveAt || 0).getTime()
        if (aTs !== bTs) return bTs - aTs
      }
      return byName(a, b)
    })
    return arr
  }, [cards, search, filter, sort, favorites, lastUsedAt])

  const stats = useMemo<WorkspaceStats>(() => {
    let healthy = 0
    let warning = 0
    let error = 0
    let disconnected = 0
    for (const c of cards) {
      if (c.health === "healthy") healthy++
      else if (c.health === "warning") warning++
      else if (c.health === "error" || c.health === "revoked") error++
      else if (c.health === "disconnected") disconnected++
    }
    return { healthy, warning, error, disconnected, total: cards.length }
  }, [cards])

  return { workspaces, aliases, setAliases, filtered, stats, loading, reload }
}
