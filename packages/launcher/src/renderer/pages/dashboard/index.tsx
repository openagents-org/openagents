import React, { useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { Plus, RefreshCw } from "lucide-react"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { StatsOverview } from "@renderer/components/dashboard/StatsOverview"
import { HealthMonitor } from "@renderer/components/dashboard/HealthMonitor"
import { ActivityFeed } from "@renderer/components/dashboard/ActivityFeed"
import { useAgentsStore } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import { useInstallStore } from "@renderer/store/install"
import { useNotificationsStore } from "@renderer/store/notifications"
import { useUpdateDismissals } from "@renderer/hooks/useUpdateDismissals"
import { cn } from "@renderer/lib/utils"
import { isUpgradeAvailable } from "../../../shared/version-compare"
import type { ToastType } from "@renderer/hooks/useToast"
import { useDashboardData } from "./use-dashboard-data"
import { useAgentActions } from "./use-agent-actions"
import { PendingUpdatesBanner } from "./components/pending-updates-banner"
import { AgentsPanel } from "./components/agents-panel"

interface DashboardProps {
  showToast: (message: string, type?: ToastType) => void
  onOpenConfigure: (agentName: string, agentType: string) => void
  onOpenConnectWorkspace: (agentName: string) => void
}

export default function Dashboard({
  showToast,
}: DashboardProps): React.JSX.Element {
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
  const notifItems = useNotificationsStore((s) => s.items)
  const { isDismissed, ignore, later } = useUpdateDismissals()

  const data = useDashboardData()
  const actions = useAgentActions(data.refresh, showToast)
  const [refreshing, setRefreshing] = useState(false)

  const pendingUpdates = updates.filter(
    (u) =>
      isUpgradeAvailable(u.current, u.latest) && !isDismissed(u.name, u.latest!),
  )

  const openInstall = (): void => {
    if (pendingUpdates.length === 1) setInstallFocusAgent(pendingUpdates[0].name)
    setCurrentTab("install")
  }

  // The attention tile covers both updates and broken agents; send the user to
  // whichever surface actually resolves what it is counting.
  const openAttention = (): void => {
    if (pendingUpdates.length > 0) openInstall()
    else setCurrentTab("agents")
  }

  const manageAgent = (name: string): void => {
    setInstallFocusAgent(name)
    setCurrentTab("agents")
  }

  const runRefresh = (): void => {
    setRefreshing(true)
    void data.refreshAll().finally(() => setRefreshing(false))
  }

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("dashboard.title")}
        subtitle={t("dashboard.subtitle")}
        actions={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("dashboard.refresh")}
              disabled={refreshing}
              onClick={runRefresh}
            >
              <RefreshCw className={cn(refreshing && "animate-spin")} />
            </Button>
            <Button onClick={() => goToInstallList()}>
              <Plus />
              {t("dashboard.quickActions.newAgent")}
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto px-9 py-6">
        <StatsOverview
          agents={agents}
          workspaceCount={data.workspaceCount}
          todayMessageCount={data.todayMessageCount}
          pendingUpdateCount={pendingUpdates.length}
          className="mb-4"
          onClickAttention={openAttention}
        />

        <PendingUpdatesBanner
          updates={pendingUpdates}
          onIgnore={(u) => u.latest && ignore(u.name, u.latest)}
          onSnooze={(u) => u.latest && later(u.name, u.latest)}
          onView={openInstall}
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <AgentsPanel
              agents={agents}
              loading={data.loading}
              pendingAgentActions={pendingAgentActions}
              todayByAgent={data.todayByAgent}
              onToggle={(a) => void actions.toggle(a)}
              onOpenChat={(a) => actions.openTerminal(a)}
              onManage={(a) => manageAgent(a.name)}
              onStartAll={() => void actions.startAll()}
              onStopAll={() => void actions.stopAll()}
              onNewWorkspace={() => setCurrentTab("workspaces")}
              onAddConnection={() => setCurrentTab("connections")}
              onViewAll={() => setCurrentTab("agents")}
              onInstallFirst={() => goToInstallList()}
            />
          </div>

          <div className="flex min-h-full flex-col gap-4">
            <HealthMonitor agents={agents} />
            <ActivityFeed uiActivity={activityLog} notifications={notifItems} />
          </div>
        </div>
      </div>
    </section>
  )
}
