import React, { useEffect, useMemo, useRef, useCallback, useState } from "react"
import { useAgentsStore } from "../../store/agents"
import { useShallow } from "zustand/react/shallow"
import { Trans, useTranslation } from "react-i18next"
import AgentIcon from "../../components/AgentIcon"
import { ConfirmDialog } from "../../components/ui-kit"
import { Plus } from "lucide-react"
import { Button } from "../../components/ui/button"
import { Card } from "../../components/ui/card"
import { Skeleton } from "../../components/ui/skeleton"
import { Empty, EmptyDescription, EmptyHeader } from "../../components/ui/empty"
import { PageHeader } from "../../components/layout/page-header"
import type { ToastType } from "../../hooks/useToast"
import { NewAgentDialog } from "./components/new-agent-dialog"
import { ConfigureDialog } from "./components/configure-dialog"
import { ConnectWorkspaceDialog } from "./components/connect-workspace-dialog"
import { AgentCard } from "./components/agent-card"
import { AgentsToolbar, type AgentFilter } from "./components/agents-toolbar"
import { useAgentActions } from "./use-agent-actions"

export { formatHealthLabel } from "./format-health-label"

interface AgentsProps {
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

export default function Agents({ showToast }: AgentsProps): React.JSX.Element {
  const { t } = useTranslation()
  const { agents, setAgents, pendingAgentActions } = useAgentsStore(
    useShallow((s) => ({
      agents: s.agents,
      setAgents: s.setAgents,
      pendingAgentActions: s.pendingAgentActions,
    })),
  )
  const [loading, setLoading] = useState(agents.length === 0)
  const inFlight = useRef(false)
  const queued = useRef(false)
  const mounted = useRef(true)

  const [newAgentOpen, setNewAgentOpen] = useState(false)
  const [configureOpen, setConfigureOpen] = useState(false)
  const [configureAgent, setConfigureAgent] = useState<{
    name: string
    type: string
  } | null>(null)
  const [connectWsOpen, setConnectWsOpen] = useState(false)
  const [connectWsAgent, setConnectWsAgent] = useState<string>("")
  // When a brand-new agent is created we walk the user from Configure straight
  // into Connect Workspace. This flag distinguishes that flow from configuring
  // an existing agent (where closing Configure should not prompt to connect).
  const [connectAfterConfigure, setConnectAfterConfigure] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [filter, setFilter] = useState<AgentFilter>("all")

  const visibleAgents = useMemo(() => {
    const q = search.trim().toLowerCase()
    return agents.filter((a) => {
      if (filter === "connected" && !a.network) return false
      if (filter === "disconnected" && a.network) return false
      if (!q) return true
      return (
        a.name.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        (a.networkName || a.network || "").toLowerCase().includes(q)
      )
    })
  }, [agents, filter, search])

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
    disconnectAgent,
    openWorkspace,
    openAgentChat,
  } = useAgentActions(refresh, showToast, () => setRemoveTarget(null))

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  return (
    <section className="flex flex-col h-full">
      <PageHeader
        title={t("agents.list.title")}
        subtitle={t("agents.list.subtitle")}
        actions={
          <Button variant="default" data-testid="new-agent-open" onClick={() => setNewAgentOpen(true)}>
            <Plus className="w-3.5 h-3.5" />
            {t("agents.list.newAgent")}
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">
        <AgentsToolbar
          search={search}
          onSearch={setSearch}
          filter={filter}
          onFilter={setFilter}
        />

        {loading ? (
          <div className="flex flex-col gap-2.5">
            <SkeletonListItem />
            <SkeletonListItem />
            <SkeletonListItem />
          </div>
        ) : visibleAgents.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>
                {agents.length === 0
                  ? t("agents.list.empty")
                  : t("agents.list.emptyNoMatch")}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2.5">
            {visibleAgents.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                pending={pendingAgentActions.has(agent.name)}
                onToggle={() => toggleAgent(agent)}
                onOpenTerminal={() => void openAgentChat(agent)}
                onConfigure={() => {
                  setConfigureAgent({ name: agent.name, type: agent.type })
                  setConfigureOpen(true)
                }}
                onConnect={() => {
                  setConnectWsAgent(agent.name)
                  setConnectWsOpen(true)
                }}
                onDisconnect={() => disconnectAgent(agent.name)}
                onOpenWorkspace={() => openWorkspace(agent)}
                onRemove={() => setRemoveTarget(agent.name)}
              />
            ))}
          </div>
        )}
      </div>


      <NewAgentDialog
        open={newAgentOpen}
        onClose={() => setNewAgentOpen(false)}
        showToast={showToast}
        onCreated={(name, type) => {
          setNewAgentOpen(false)
          refresh()
          setConfigureAgent({ name, type })
          setConfigureOpen(true)
          setConnectAfterConfigure(true)
        }}
      />

      {configureAgent && (
        <ConfigureDialog
          open={configureOpen}
          agentName={configureAgent.name}
          agentType={configureAgent.type}
          onClose={() => {
            setConfigureOpen(false)
            // For a freshly created agent, guide the user to connect it to a
            // workspace. This step is skippable (Cancel) so local-only usage
            // still works.
            if (connectAfterConfigure) {
              setConnectAfterConfigure(false)
              setConnectWsAgent(configureAgent.name)
              setConnectWsOpen(true)
            }
          }}
          showToast={showToast}
          onSaved={refresh}
        />
      )}

      <ConnectWorkspaceDialog
        open={connectWsOpen}
        agentName={connectWsAgent}
        onClose={() => setConnectWsOpen(false)}
        showToast={showToast}
        onConnected={refresh}
      />

      <ConfirmDialog
        open={!!removeTarget}
        icon={
          <AgentIcon
            type={agents.find((a) => a.name === removeTarget)?.type || ""}
            size={40}
          />
        }
        title={t("agents.list.removeTitle", { name: removeTarget })}
        description={
          <Trans
            i18nKey="agents.list.removeBody"
            values={{ name: removeTarget }}
            components={{ 1: <strong className="text-foreground" /> }}
          />
        }
        confirmLabel={t("agents.list.remove")}
        cancelLabel={t("agents.list.cancel")}
        onConfirm={() => {
          if (removeTarget) removeAgent(removeTarget)
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </section>
  )
}
