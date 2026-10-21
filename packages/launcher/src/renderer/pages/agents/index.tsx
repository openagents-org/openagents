import React, { useEffect, useRef, useCallback, useState } from "react"
import { useAgentsStore } from "../../store/agents"
import { useUiStore } from "../../store/ui"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { RenameAgentDialog } from "./components/rename-agent-dialog"
import { Card } from "../../components/ui/card"
import { Skeleton } from "../../components/ui/skeleton"
import { PageHeader } from "../../components/layout/page-header"
import type { ToastType } from "../../hooks/useToast"
import { MarketplaceStats } from "../install/components/marketplace-stats"
import { useAgentCatalog } from "./use-agent-catalog"
import { RecommendedAgents } from "./components/recommended-agents"
import { AgentsEmpty } from "./components/agents-empty"
import { RemoveAgentDialog } from "./components/remove-agent-dialog"
const LocalAgentSetup = React.lazy(() => import("./local-agent-setup").then((module) => ({ default: module.LocalAgentSetup })))
import { ConnectWorkspaceDialog } from "./components/connect-workspace-dialog"
import { AgentsToolbar } from "./components/agents-toolbar"
import { AgentsTable } from "./components/agents-table"
import { AgentsPagination } from "./components/agents-pagination"
import { useAgentsView, type AgentFilter } from "./use-agents-view"
import { useAgentActions } from "./use-agent-actions"
import type { AgentActionHandlers } from "./components/agent-actions"
import type { Agent } from "@renderer/types"

export { formatHealthLabel } from "./format-health-label"

interface AgentsProps {
  overview?: boolean
  showToast: (msg: string, type?: ToastType) => void
}

function SkeletonListItem(): React.JSX.Element {
  return (
    <Card className="gap-2.5 px-4 py-4">
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-4 w-2/5" />
    </Card>
  )
}

export default function Agents({ showToast, overview = false }: AgentsProps): React.JSX.Element {
  const { t } = useTranslation()
  const { agents, setAgents, pendingAgentActions } = useAgentsStore(
    useShallow((s) => ({
      agents: s.agents,
      setAgents: s.setAgents,
      pendingAgentActions: s.pendingAgentActions,
    })),
  )
  const pendingCreate = useUiStore((s) => s.pendingCreate)
  const clearPendingCreate = useUiStore((s) => s.clearPendingCreate)
  const [loading, setLoading] = useState(agents.length === 0)
  const inFlight = useRef(false)
  const queued = useRef(false)
  const mounted = useRef(true)

  const [newAgentOpen, setNewAgentOpen] = useState(false)
  // The type a recommended card asked for; null opens the full type picker.
  const [setupType, setSetupType] = useState<string | null>(null)
  const startSetup = (type: string | null): void => {
    setSetupType(type)
    setNewAgentOpen(true)
  }
  const { catalog, counts: typeCounts, loading: catalogLoading } = useAgentCatalog()
  const [configureOpen, setConfigureOpen] = useState(false)
  const [configureAgent, setConfigureAgent] = useState<{
    name: string
    type: string
  } | null>(null)
  const [connectWsOpen, setConnectWsOpen] = useState(false)
  const [connectWsAgent, setConnectWsAgent] = useState<string>("")
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<Agent | null>(null)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<AgentFilter>("all")

  const {
    rows,
    pageRows,
    counts,
    page,
    pageCount,
    setPage,
    pageSize,
    setPageSize,
  } = useAgentsView(agents, search, filter, "recent")

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    if (inFlight.current) {
      queued.current = true
      return
    }
    inFlight.current = true
    try {
      const data = await window.api.listAgents()
      if (!mounted.current) return
      setAgents(data)
      setLoading(false)
    } catch {
    } finally {
      inFlight.current = false
      if (queued.current) {
        queued.current = false
        refresh()
      }
    }
  }, [setAgents])

  const {
    toggleAgent,
    removeAgent,
    renameAgent,
    disconnectAgent,
    openWorkspace,
    openAgentChat,
  } = useAgentActions(refresh, showToast, () => setRemoveTarget(null))

  // One set of row actions for both views.
  const handlers: AgentActionHandlers = {
    onToggle: (a) => toggleAgent(a),
    onOpenTerminal: (a) => void openAgentChat(a),
    onConfigure: (a) => {
      setConfigureAgent({ name: a.name, type: a.type })
      setConfigureOpen(true)
    },
    onConnect: (a) => {
      setConnectWsAgent(a.name)
      setConnectWsOpen(true)
    },
    onRename: (a) => setRenameTarget(a),
    onDisconnect: (a) => disconnectAgent(a.name),
    onOpenWorkspace: (a) => openWorkspace(a),
    onRemove: (a) => setRemoveTarget(a.name),
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  // The dashboard's "New agent" button lands here with the dialog requested.
  useEffect(() => {
    if (pendingCreate !== "agent") return
    startSetup(null)
    clearPendingCreate()
  }, [pendingCreate, clearPendingCreate])

  if (newAgentOpen || (configureOpen && configureAgent)) {
    return <React.Suspense fallback={<div className="p-8"><Skeleton className="h-48" /></div>}><LocalAgentSetup initialType={setupType ?? undefined} agent={configureOpen ? agents.find((a) => a.name === configureAgent?.name) : undefined}
      onManage={(agent) => { setNewAgentOpen(false); setConfigureAgent(agent); setConfigureOpen(true) }}
      onBack={() => { setNewAgentOpen(false); setSetupType(null); setConfigureOpen(false); void refresh() }}
      onCreated={(name) => { setConnectWsAgent(name); setConnectWsOpen(true) }} onChanged={() => void refresh()} /></React.Suspense>
  }

  return (
    <section className="flex flex-col h-full">
      <PageHeader
        title={t(overview ? "nav.items.dashboard.label" : "agents.list.title")}
        subtitle={t("agents.shared.overviewSubtitle")}
        actions={
          // Read-only here: the full list is reached through "Browse and
          // connect more agents", and only through it.
          catalogLoading ? null : <MarketplaceStats counts={typeCounts} />
        }
      />

      <div className="flex-1 overflow-y-auto px-9 pt-2 pb-6">
        <RecommendedAgents
          catalog={catalog}
          onInstall={(type) => startSetup(type)}
          onMore={() => startSetup(null)}
        />
        <AgentsToolbar
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
          counts={counts}
        />

        {loading ? (
          <div className="flex flex-col gap-2.5">
            <SkeletonListItem />
            <SkeletonListItem />
            <SkeletonListItem />
          </div>
        ) : rows.length === 0 ? (
          <AgentsEmpty
            hasAny={agents.length > 0}
            search={search}
            onClearSearch={() => setSearch("")}
            onShowAll={() => setFilter("all")}
          />
        ) : (
          <>
            <AgentsTable rows={pageRows} pending={pendingAgentActions} {...handlers} />
            <AgentsPagination
              total={rows.length}
              page={page}
              pageCount={pageCount}
              pageSize={pageSize}
              onPage={setPage}
              onPageSize={setPageSize}
            />
          </>
        )}
      </div>


      <ConnectWorkspaceDialog
        open={connectWsOpen}
        agentName={connectWsAgent}
        onClose={() => setConnectWsOpen(false)}
        showToast={showToast}
        onConnected={refresh}
      />

      <RemoveAgentDialog
        name={removeTarget}
        agent={agents.find((a) => a.name === removeTarget)}
        onConfirm={() => {
          if (removeTarget) removeAgent(removeTarget, { fromWorkspace: true })
        }}
        onCancel={() => setRemoveTarget(null)}
      />

      <RenameAgentDialog
        agent={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSubmit={async (displayName) => {
          if (!renameTarget) return
          await renameAgent(renameTarget.name, displayName)
          setRenameTarget(null)
        }}
      />
    </section>
  )
}
