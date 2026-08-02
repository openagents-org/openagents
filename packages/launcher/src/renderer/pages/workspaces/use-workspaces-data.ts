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

function deriveHealth(agents: Agent[]): WorkspaceHealthState {
  if (agents.length === 0) return "disconnected"
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
  total: number
}

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
export function useWorkspacesData(search: string): WorkspacesData {
  const agents = useAgentsStore((s) => s.agents)
  const connections = useConnectionsStore((s) => s.connections)
  const { favorites, lastUsedAt } = useWorkspacePrefs(
    useShallow((s) => ({ favorites: s.favorites, lastUsedAt: s.lastUsedAt })),
  )

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
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
      return {
        ws: aliasName ? { ...ws, name: aliasName } : ws,
        agents: linkedAgents,
        health: deriveHealth(linkedAgents),
        lastActiveAt: topSession?.lastMessageAt || lastUsedAt[ws.id] || null,
        lastMessageAt: topSession?.lastMessageAt || null,
        lastMessagePreview: topSession?.lastMessagePreview || null,
        sessionCount: wsSessions.length,
        connectedPlatforms: platformsByWorkspace.get(ws.id) || [],
      }
    })
  }, [workspaces, agents, sessions, aliases, lastUsedAt, platformsByWorkspace])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const arr = cards.filter((c) => {
      if (!q) return true
      const slug = c.ws.slug || c.ws.id
      return (
        (c.ws.name || "").toLowerCase().includes(q) ||
        slug.toLowerCase().includes(q) ||
        c.agents.some((a) => a.name.toLowerCase().includes(q))
      )
    })
    arr.sort((a, b) => {
      const aFav = favorites.has(a.ws.id) ? 0 : 1
      const bFav = favorites.has(b.ws.id) ? 0 : 1
      if (aFav !== bFav) return aFav - bFav
      // Then by last-used desc.
      const aTs = new Date(lastUsedAt[a.ws.id] || a.lastActiveAt || 0).getTime()
      const bTs = new Date(lastUsedAt[b.ws.id] || b.lastActiveAt || 0).getTime()
      if (aTs !== bTs) return bTs - aTs
      return (a.ws.name || a.ws.slug || a.ws.id).localeCompare(
        b.ws.name || b.ws.slug || b.ws.id,
      )
    })
    return arr
  }, [cards, search, favorites, lastUsedAt])

  const stats = useMemo<WorkspaceStats>(() => {
    let healthy = 0
    let warning = 0
    let error = 0
    for (const c of cards) {
      if (c.health === "healthy") healthy++
      else if (c.health === "warning") warning++
      else if (c.health === "error") error++
    }
    return { healthy, warning, error, total: cards.length }
  }, [cards])

  return { workspaces, aliases, setAliases, filtered, stats, loading, reload }
}
