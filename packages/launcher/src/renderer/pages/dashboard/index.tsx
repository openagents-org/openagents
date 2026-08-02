import React, { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { ArrowRight } from "lucide-react"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/shadcn/button"
import { Card } from "@renderer/components/shadcn/card"
import { Skeleton } from "@renderer/components/shadcn/skeleton"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@renderer/components/shadcn/empty"
import { StatsOverview } from "@renderer/components/dashboard/StatsOverview"
import { HealthMonitor } from "@renderer/components/dashboard/HealthMonitor"
import { ActivityFeed } from "@renderer/components/dashboard/ActivityFeed"
import { AgentCard } from "@renderer/components/dashboard/AgentCard"
import { QuickActions } from "@renderer/components/dashboard/QuickActions"
import { useAgentsStore } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import { useInstallStore } from "@renderer/store/install"
import { useConnectionsStore } from "@renderer/store/connections"
import { useNotificationsStore } from "@renderer/store/notifications"
import { useUpdateDismissals } from "@renderer/hooks/useUpdateDismissals"
import { isUpgradeAvailable } from "../../../shared/version-compare"
import type { Agent } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import { useDashboardData } from "./use-dashboard-data"
import { useAgentActions } from "./use-agent-actions"
import { PendingUpdatesBanner } from "./components/pending-updates-banner"

interface DashboardProps {
  showToast: (message: string, type?: ToastType) => void
  onOpenConfigure: (agentName: string, agentType: string) => void
  onOpenConnectWorkspace: (agentName: string) => void
}

const RUNNING_STATES = ["online", "running", "idle"]
/** Keep the grid tight; "View all →" leads to the Agents page. */
const MAX_VISIBLE_AGENTS = 6

function SkeletonCard(): React.JSX.Element {
  return (
    <Card className="h-full gap-2.5 p-4">
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-4 w-2/5" />
      <Skeleton className="h-4 w-1/4" />
    </Card>
  )
}

export default function Dashboard({ showToast }: DashboardProps): React.JSX.Element {
  const { t } = useTranslation()
  const { agents, pendingAgentActions } = useAgentsStore(
    useShallow((s) => ({
      agents: s.agents,
      pendingAgentActions: s.pendingAgentActions,
    })),
  )
  const { activityLog, setCurrentTab, setInstallFocusAgent, goToInstallList } =
    useUiStore(
      useShallow((s) => ({
        activityLog: s.activityLog,
        setCurrentTab: s.setCurrentTab,
        setInstallFocusAgent: s.setInstallFocusAgent,
        goToInstallList: s.goToInstallList,
      })),
    )
  const updates = useInstallStore((s) => s.updates)
  const connections = useConnectionsStore((s) => s.connections)
  const notifItems = useNotificationsStore((s) => s.items)
  const { isDismissed, ignore, later } = useUpdateDismissals()

  const data = useDashboardData()
  const actions = useAgentActions(data.refresh, showToast)

  const pendingUpdates = updates.filter(
    (u) => isUpgradeAvailable(u.current, u.latest) && !isDismissed(u.name, u.latest!),
  )

  const openInstall = (): void => {
    if (pendingUpdates.length === 1) setInstallFocusAgent(pendingUpdates[0].name)
    setCurrentTab("install")
  }

  const hasRunning = useMemo(
    () => agents.some((a) => RUNNING_STATES.includes(a.state)),
    [agents],
  )
  const hasIdle = useMemo(
    () => agents.some((a) => ![...RUNNING_STATES, "starting"].includes(a.state)),
    [agents],
  )

  // Surface "Active Agents" first — running ones, then idle.
  const visibleAgents = useMemo(() => {
    const score = (a: Agent): number =>
      ["online", "running"].includes(a.state) ? 0 : a.state === "idle" ? 1 : 2
    return [...agents].sort((a, b) => score(a) - score(b)).slice(0, MAX_VISIBLE_AGENTS)
  }, [agents])

  return (
    <section className="flex h-full flex-col">
      <PageHeader title={t("dashboard.title")} showSearch />

      <div className="flex-1 overflow-y-auto px-9 py-6">
        <StatsOverview
          agents={agents}
          workspaceCount={data.workspaceCount}
          connections={connections}
          todayMessageCount={data.todayMessageCount}
          installedCount={data.installedCount}
          pendingUpdateCount={pendingUpdates.length}
          pendingUpdates={pendingUpdates}
          className="mb-4"
          onClickUpdates={openInstall}
        />

        <div className="mb-5">
          <QuickActions
            hasRunning={hasRunning}
            hasIdle={hasIdle}
            onStartAll={() => void actions.startAll()}
            onStopAll={() => void actions.stopAll()}
            onNewWorkspace={() => setCurrentTab("workspaces")}
            onAddConnection={() => setCurrentTab("connections")}
            onNewAgent={() => goToInstallList()}
          />
        </div>

        <PendingUpdatesBanner
          updates={pendingUpdates}
          onIgnore={(u) => u.latest && ignore(u.name, u.latest)}
          onSnooze={(u) => u.latest && later(u.name, u.latest)}
          onView={openInstall}
        />

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {t("dashboard.activeAgents.title")}
          </h2>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => setCurrentTab("agents")}
          >
            {t("dashboard.activeAgents.viewAll")}
            <ArrowRight />
          </Button>
        </div>

        {data.loading ? (
          <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : agents.length === 0 ? (
          <Empty className="mb-6">
            <EmptyHeader>
              <EmptyDescription>{t("dashboard.activeAgents.empty")}</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => goToInstallList()}>
                {t("dashboard.activeAgents.installFirst")}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visibleAgents.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                isPending={pendingAgentActions.has(agent.name)}
                todayMessages={data.todayByAgent[agent.name]}
                onToggle={() => actions.toggle(agent)}
                onOpenChat={() => actions.openTerminal(agent)}
              />
            ))}
          </div>
        )}

        <div className="mb-6 grid min-h-70 grid-cols-1 items-stretch gap-3.5 lg:grid-cols-2">
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
