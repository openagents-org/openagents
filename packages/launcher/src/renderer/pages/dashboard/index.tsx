import React, { useEffect, useMemo, useRef, useCallback, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { ArrowRight } from "lucide-react"
import { useAgentsStore } from "../../store/agents"
import { useUiStore } from "../../store/ui"
import { useInstallStore } from "../../store/install"
import { useConnectionsStore } from "../../store/connections"
import { useNotificationsStore } from "../../store/notifications"
import { Button } from "../../components/ui/Button"
import { TopBar } from "../../components/TopBar"
import { StatsOverview } from "../../components/dashboard/StatsOverview"
import { HealthMonitor } from "../../components/dashboard/HealthMonitor"
import { ActivityFeed } from "../../components/dashboard/ActivityFeed"
import { AgentCard } from "../../components/dashboard/AgentCard"
import { QuickActions } from "../../components/dashboard/QuickActions"
import type { Agent, AgentUpdateInfo } from "../../types"
import { useUpdateDismissals } from "../../hooks/useUpdateDismissals"
import type { ToastType } from "../../hooks/useToast"

interface DashboardProps {
  showToast: (message: string, type?: ToastType) => void
  onOpenConfigure: (agentName: string, agentType: string) => void
  onOpenConnectWorkspace: (agentName: string) => void
}

function SkeletonCard(): React.JSX.Element {
  return (
    <div className="flex flex-col h-full p-4 bg-(--bg-card) border border-(--border) rounded-(--radius)">
      <div className="skeleton-shimmer rounded-full h-2.5 w-[62%] mb-2.5" />
      <div className="skeleton-shimmer rounded-full h-2.5 w-[42%] mb-2.5" />
      <div className="skeleton-shimmer rounded-full h-2.5 w-[26%]" />
    </div>
  )
}

export default function Dashboard({
  showToast,
}: DashboardProps): React.JSX.Element {
  const {
    agents,
    setAgents,
    pendingAgentActions,
    addPendingAction,
    removePendingAction,
    setCoreVersion,
    setLauncherVersion,
  } = useAgentsStore(
    useShallow((s) => ({
      agents: s.agents,
      setAgents: s.setAgents,
      pendingAgentActions: s.pendingAgentActions,
      addPendingAction: s.addPendingAction,
      removePendingAction: s.removePendingAction,
      setCoreVersion: s.setCoreVersion,
      setLauncherVersion: s.setLauncherVersion,
    })),
  )
  const {
    activityLog,
    setCurrentTab,
    setInstallFocusAgent,
    goToInstallList,
  } = useUiStore(
    useShallow((s) => ({
      activityLog: s.activityLog,
      setCurrentTab: s.setCurrentTab,
      setInstallFocusAgent: s.setInstallFocusAgent,
      goToInstallList: s.goToInstallList,
    })),
  )
  const { updates, setUpdates } = useInstallStore(
    useShallow((s) => ({ updates: s.updates, setUpdates: s.setUpdates })),
  )
  const { connections, refresh: refreshConnections } = useConnectionsStore(
    useShallow((s) => ({ connections: s.connections, refresh: s.refresh })),
  )
  const notifItems = useNotificationsStore((s) => s.items)
  const { isDismissed, ignore: ignoreUpdate, later: snoozeUpdate } =
    useUpdateDismissals()

  const inFlight = useRef(false)
  const queued = useRef(false)
  const mounted = useRef(true)
  const [loading, setLoading] = useState(agents.length === 0)
  const [workspaceCount, setWorkspaceCount] = useState(0)
  const [todayMessageCount, setTodayMessageCount] = useState(0)
  const [todayByAgent, setTodayByAgent] = useState<Record<string, number>>({})
  const [installedCount, setInstalledCount] = useState<number | undefined>(
    undefined,
  )

  const pendingUpdates = updates.filter(
    (u: AgentUpdateInfo) =>
      u.current &&
      u.latest &&
      u.current !== u.latest &&
      !isDismissed(u.name, u.latest),
  )

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

      const status = await window.api.pythonStatus()
      if (!mounted.current) return
      setCoreVersion(status.sdkVersion)
      setLauncherVersion(`v${status.launcherVersion}`)
    } catch (err) {
      console.error("Dashboard refresh error:", err)
    } finally {
      inFlight.current = false
      if (queued.current) {
        queued.current = false
        refresh()
      }
    }
  }, [setAgents, setCoreVersion, setLauncherVersion])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    return () => clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    void refreshConnections()
  }, [refreshConnections])

  const loadAggregates = useCallback(async () => {
    try {
      const wsList = await window.api.listWorkspaces()
      if (mounted.current) setWorkspaceCount(wsList.length)
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayMs = today.getTime()
      let total = 0
      const byAgent: Record<string, number> = {}
      await Promise.all(
        wsList.slice(0, 10).map(async (w) => {
          try {
            const msgs = await window.api.chatGetMessages(w.id, undefined, 100)
            for (const m of msgs) {
              const t = m.createdAt ? new Date(m.createdAt).getTime() : 0
              if (t >= todayMs) {
                total += 1
                const sender = (m as unknown as { sender?: string }).sender
                if (sender) byAgent[sender] = (byAgent[sender] || 0) + 1
              }
            }
          } catch {}
        }),
      )
      if (mounted.current) {
        setTodayMessageCount(total)
        setTodayByAgent(byAgent)
      }
      try {
        const installed = await window.api.getInstalledAgents()
        if (mounted.current) setInstalledCount(installed.length)
      } catch {}
    } catch {}
  }, [])

  useEffect(() => {
    void loadAggregates()
    const id = setInterval(loadAggregates, 60_000)
    return () => clearInterval(id)
  }, [loadAggregates])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const u = await window.api.checkAgentUpdates()
        if (!cancelled) setUpdates(u)
      } catch {}
    }
    load()
    const id = setInterval(load, 60 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [setUpdates])

  const toggleAgent = async (agent: Agent): Promise<void> => {
    if (pendingAgentActions.has(agent.name)) return
    addPendingAction(agent.name)
    refresh()
    try {
      const isRunning = ["online", "running", "idle"].includes(agent.state)
      if (isRunning) {
        await window.api.stopAgent(agent.name)
        showToast(`Stopping ${agent.name}...`, "info")
        const stopWaits = [400, 800, 1500, 2500, 3000, 3000]
        for (const w of stopWaits) {
          await new Promise((r) => setTimeout(r, w))
          const status = await window.api.agentStatus()
          const a = status[agent.name]
          if (!a || a.state === "stopped") {
            showToast(`${agent.name} stopped`, "success")
            break
          }
          refresh()
        }
      } else {
        await window.api.startAgent(agent.name)
        showToast(`Starting ${agent.name}...`, "info")
        const startWaits = [
          500, 1000, 1500, 2500, 3000, 3000, 3000, 3000, 3000, 3000,
        ]
        for (const w of startWaits) {
          await new Promise((r) => setTimeout(r, w))
          const status = await window.api.agentStatus()
          const a = status[agent.name]
          if (a && ["running", "online"].includes(a.state)) {
            showToast(`${agent.name} is now running`, "success")
            break
          }
          refresh()
        }
      }
    } catch (err: unknown) {
      showToast(`Error: ${(err as Error).message}`, "error")
    } finally {
      removePendingAction(agent.name)
      refresh()
    }
  }

  const openChatForAgent = (agent: Agent): void => {
    setInstallFocusAgent(agent.name)
    setCurrentTab("chat")
  }

  const stopAllRunning = async (): Promise<void> => {
    try {
      await window.api.stopAll()
      showToast("Stopping all agents…", "info")
      refresh()
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  const startAllIdle = async (): Promise<void> => {
    try {
      await window.api.startAll()
      showToast("Starting all agents…", "info")
      refresh()
    } catch (err) {
      showToast(`Error: ${(err as Error).message}`, "error")
    }
  }

  const hasRunning = useMemo(
    () => agents.some((a) => ["online", "running", "idle"].includes(a.state)),
    [agents],
  )
  const hasIdle = useMemo(
    () =>
      agents.some(
        (a) => !["online", "running", "idle", "starting"].includes(a.state),
      ),
    [agents],
  )

  // Surface "Active Agents" first — running ones, then idle. Cap at 6 to keep the
  // dashboard grid tight; "View all →" leads to the Agents page.
  const sortedAgents = useMemo(() => {
    const score = (a: Agent): number =>
      ["online", "running"].includes(a.state) ? 0 : a.state === "idle" ? 1 : 2
    return [...agents].sort((a, b) => score(a) - score(b))
  }, [agents])
  const visibleAgents = sortedAgents.slice(0, 6)

  return (
    <section className="flex flex-col h-full">
      <TopBar title="Dashboard" showSearch />

      <div className="flex-1 overflow-y-auto px-9 py-6">
      <StatsOverview
        agents={agents}
        workspaceCount={workspaceCount}
        connections={connections}
        todayMessageCount={todayMessageCount}
        installedCount={installedCount}
        pendingUpdateCount={pendingUpdates.length}
        pendingUpdates={pendingUpdates}
        className="mb-4"
        onClickUpdates={() => {
          if (pendingUpdates.length === 1) {
            setInstallFocusAgent(pendingUpdates[0].name)
          }
          setCurrentTab("install")
        }}
      />

      <div className="mb-5">
        <QuickActions
          hasRunning={hasRunning}
          hasIdle={hasIdle}
          onStartAll={() => void startAllIdle()}
          onStopAll={() => void stopAllRunning()}
          onOpenChat={() => setCurrentTab("chat")}
          onNewWorkspace={() => setCurrentTab("workspaces")}
          onAddConnection={() => setCurrentTab("connections")}
          onNewAgent={() => goToInstallList()}
        />
      </div>

      {pendingUpdates.length > 0 && (
        <div className="mb-5 flex items-center gap-3 px-4 py-3 text-xs bg-(--accent-bg) border border-(--accent-border) rounded-(--radius)">
          <span className="text-lg">↑</span>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-(--text-primary)">
              {pendingUpdates.length === 1
                ? `Update available for ${pendingUpdates[0].name}`
                : `${pendingUpdates.length} agent updates available`}
            </div>
            <div className="text-(--text-secondary) truncate">
              {pendingUpdates
                .slice(0, 3)
                .map((u) => `${u.name} v${u.current} → v${u.latest}`)
                .join(" · ")}
            </div>
          </div>
          {pendingUpdates.length === 1 && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const u = pendingUpdates[0]
                  if (u.latest) ignoreUpdate(u.name, u.latest)
                }}
              >
                Ignore
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const u = pendingUpdates[0]
                  if (u.latest) snoozeUpdate(u.name, u.latest)
                }}
              >
                Later
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (pendingUpdates.length === 1) {
                setInstallFocusAgent(pendingUpdates[0].name)
              }
              setCurrentTab("install")
            }}
          >
            {pendingUpdates.length === 1 ? "Update now" : "View"}
          </Button>
        </div>
      )}

      {/* Active agents */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-semibold text-(--text-primary) m-0">
          Active Agents
        </h2>
        <button
          type="button"
          onClick={() => setCurrentTab("agents")}
          className="text-[12px] text-(--accent) hover:underline bg-transparent border-0 cursor-pointer p-0 flex items-center gap-1"
        >
          View all
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : agents.length === 0 ? (
        <div className="bg-(--bg-card) border border-(--border) rounded-(--radius) p-8 text-center mb-6">
          <p className="text-[13px] text-(--text-secondary) mb-3 m-0">
            No agents configured yet.
          </p>
          <Button variant="primary" onClick={() => goToInstallList()}>
            Install your first agent
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-6">
          {visibleAgents.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              isPending={pendingAgentActions.has(agent.name)}
              todayMessages={todayByAgent[agent.name]}
              onToggle={() => toggleAgent(agent)}
              onOpenChat={() => openChatForAgent(agent)}
            />
          ))}
        </div>
      )}

      {/* Health + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mb-6 min-h-70 items-stretch">
        <HealthMonitor
          agents={agents}
          onSelect={(name) => {
            setInstallFocusAgent(name)
            setCurrentTab("agents")
          }}
        />
        <ActivityFeed uiActivity={activityLog} notifications={notifItems} />
      </div>
      </div>
    </section>
  )
}
