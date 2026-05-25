import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { Plus, Check, RefreshCw, Link as LinkIcon } from "lucide-react"
import { TopBar } from "../../components/TopBar"
import { Button } from "../../components/ui/Button"
import { SearchInput } from "../../components/ui/SearchInput"
import { ConfirmDialog } from "../../components/ui/ConfirmDialog"
import { WorkspaceCard } from "../../components/workspaces/WorkspaceCard"
import { WorkspaceQuickConnect } from "../../components/workspaces/WorkspaceQuickConnect"
import { WorkspaceRenameDialog } from "../../components/workspaces/WorkspaceRenameDialog"
import type { WorkspaceCardData } from "../../components/workspaces/WorkspaceCard"
import type { WorkspaceHealthState } from "../../components/workspaces/WorkspaceHealth"
import { useAgentsStore } from "../../store/agents"
import { useConnectionsStore } from "../../store/connections"
import { useWorkspacePrefs } from "../../store/workspace-prefs"
import { useUiStore } from "../../store/ui"
import type { Agent, ChatSessionMeta, Workspace } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { workspaceWebBaseUrl } from "../../lib/workspace-urls"

interface Props {
  showToast: (msg: string, type?: ToastType) => void
}

function deriveHealth(agents: Agent[]): WorkspaceHealthState {
  if (agents.length === 0) return "disconnected"
  if (agents.some((a) => a.state === "error" || a.lastError)) return "error"
  if (agents.some((a) => a.state === "starting" || a.state === "reconnecting"))
    return "warning"
  if (agents.some((a) => ["online", "running", "idle"].includes(a.state)))
    return "healthy"
  return "warning"
}

export default function Workspaces({ showToast }: Props): React.JSX.Element {
  const { agents, pendingAgentActions, addPendingAction, removePendingAction } =
    useAgentsStore(
      useShallow((s) => ({
        agents: s.agents,
        pendingAgentActions: s.pendingAgentActions,
        addPendingAction: s.addPendingAction,
        removePendingAction: s.removePendingAction,
      })),
    )
  const { connections, refresh: refreshConnections } = useConnectionsStore(
    useShallow((s) => ({ connections: s.connections, refresh: s.refresh })),
  )
  const { favorites, lastUsedAt, toggleFavorite, markUsed } = useWorkspacePrefs(
    useShallow((s) => ({
      favorites: s.favorites,
      lastUsedAt: s.lastUsedAt,
      toggleFavorite: s.toggleFavorite,
      markUsed: s.markUsed,
    })),
  )
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [sessions, setSessions] = useState<ChatSessionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [quickOpen, setQuickOpen] = useState(false)
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Workspace | null>(null)
  const [removing, setRemoving] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Workspace | null>(null)
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
    refreshConnections()
    const id = setInterval(reload, 8000)
    return () => clearInterval(id)
  }, [reload, refreshConnections])

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

  const handleCopyUrl = async (ws: Workspace): Promise<void> => {
    markUsed(ws.id)
    const slug = ws.slug || ws.id
    const baseUrl = workspaceWebBaseUrl(ws.endpoint)
    const url = `${baseUrl}/${slug}`
    const full = ws.token ? `${url}?token=${encodeURIComponent(ws.token)}` : url
    try {
      await navigator.clipboard.writeText(full)
      setCopiedSlug(slug)
      setTimeout(() => setCopiedSlug(null), 1500)
      showToast("URL copied", "success")
    } catch {
      showToast("Failed to copy", "error")
    }
  }

  const handleOpenBrowser = (ws: Workspace): void => {
    markUsed(ws.id)
    const slug = ws.slug || ws.id
    const baseUrl = workspaceWebBaseUrl(ws.endpoint)
    let url = `${baseUrl}/${slug}`
    if (ws.token) url += `?token=${encodeURIComponent(ws.token)}`
    window.api.openExternal(url)
  }

  const performRemove = async (): Promise<void> => {
    const ws = removeTarget
    if (!ws) return
    const slug = ws.slug || ws.id
    setRemoving(true)
    try {
      showToast("Removing workspace...", "info")
      await window.api.removeWorkspace(slug)
      await reload()
      showToast("Workspace removed", "success")
      setRemoveTarget(null)
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      setRemoving(false)
    }
  }

  const handleToggleAgent = async (a: Agent): Promise<void> => {
    if (pendingAgentActions.has(a.name)) return
    addPendingAction(a.name)
    try {
      const isRunning = ["online", "running", "idle"].includes(a.state)
      if (isRunning) await window.api.stopAgent(a.name)
      else await window.api.startAgent(a.name)
      setTimeout(reload, 1500)
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      setTimeout(() => removePendingAction(a.name), 1500)
    }
  }

  const handleOpenAgentLogs = (a: Agent): void => {
    // Jump to the Logs tab. The Logs page reads from agents store, and we
    // don't have a per-agent deep-link API, so this is the best we can do
    // without changing the logs page contract.
    void a
    setCurrentTab("logs")
  }

  const stats = useMemo(() => {
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

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title="Workspaces"
        subtitle="— Each workspace bundles its agents, activity, and connections"
        actions={
          <>
            <Button onClick={() => setQuickOpen(true)}>
              <LinkIcon className="w-3.5 h-3.5" />
              Join Workspace
            </Button>
            <Button variant="primary" onClick={() => setQuickOpen(true)}>
              <Plus className="w-3.5 h-3.5" />
              Create Workspace
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">

      <div className="flex items-center gap-3 mb-4 text-[11px] text-(--text-tertiary)">
        <span>
          <span className="text-(--success-text) font-semibold">{stats.healthy}</span> healthy
        </span>
        <span>·</span>
        <span>
          <span className="text-(--warning-text) font-semibold">{stats.warning}</span> warning
        </span>
        <span>·</span>
        <span>
          <span className="text-(--danger-text) font-semibold">{stats.error}</span> error
        </span>
        <span>·</span>
        <span>{stats.total} total</span>
        {favorites.size > 0 && (
          <>
            <span>·</span>
            <span>
              <span className="text-(--warning-text) font-semibold">{favorites.size}</span> starred
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 mb-5">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search workspaces or agents..."
          className="flex-1 max-w-[320px]"
        />
        <Button size="sm" variant="ghost" onClick={reload}>
          <RefreshCw className="w-3 h-3" />
          Refresh
        </Button>
      </div>

      <h2 className="text-[14px] font-semibold text-(--text-primary) m-0 mb-3">
        Active Workspaces
      </h2>

      {loading ? (
        <div className="card-legacy empty-state">
          <p>Loading workspaces…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card-legacy empty-state">
          <p>
            {workspaces.length === 0
              ? "No workspaces yet."
              : `No workspaces match "${search}".`}
          </p>
          {workspaces.length === 0 && (
            <Button variant="primary" onClick={() => setQuickOpen(true)}>
              Connect your first workspace
            </Button>
          )}
        </div>
      ) : (
        filtered.map((c) => (
          <WorkspaceCard
            key={c.ws.id}
            data={c}
            pendingNames={pendingAgentActions}
            favorite={favorites.has(c.ws.id)}
            onToggleFavorite={() => toggleFavorite(c.ws.id)}
            onCopyUrl={() => handleCopyUrl(c.ws)}
            onOpen={() => handleOpenBrowser(c.ws)}
            onRename={() => setRenameTarget(c.ws)}
            onRemove={() => setRemoveTarget(c.ws)}
            onToggleAgent={handleToggleAgent}
            onOpenAgentLogs={handleOpenAgentLogs}
          />
        ))
      )}
      </div>

      {copiedSlug && (
        <div className="fixed bottom-6 right-6 px-3 py-2 bg-(--success-bg) text-(--success-text) rounded-sm text-[11px] flex items-center gap-1.5 shadow-md">
          <Check className="w-3 h-3" />
          Copied
        </div>
      )}

      <WorkspaceQuickConnect
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onCreated={() => {
          reload()
        }}
        showToast={showToast}
      />

      <WorkspaceRenameDialog
        open={!!renameTarget}
        workspace={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSaved={(id, name) => {
          setAliases((a) => ({ ...a, [id]: name }))
          showToast("Workspace renamed", "success")
        }}
      />

      <ConfirmDialog
        open={!!removeTarget}
        title={
          removeTarget
            ? `Remove workspace "${aliases[removeTarget.id] || removeTarget.name || removeTarget.slug || removeTarget.id}"?`
            : ""
        }
        description={
          <>
            Connected agents will be disconnected and the workspace will be
            soft-deleted on the server. This cannot be undone.
          </>
        }
        confirmLabel="Remove"
        busy={removing}
        onConfirm={performRemove}
        onCancel={() => !removing && setRemoveTarget(null)}
      />
    </section>
  )
}
