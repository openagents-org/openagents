import React, { useMemo, useState } from "react"
import { useShallow } from "zustand/react/shallow"

import { useAgentsStore } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import { useInstallStore } from "@renderer/store/install"
import { useNotificationsStore } from "@renderer/store/notifications"
import { useUpdateDismissals } from "@renderer/hooks/useUpdateDismissals"
import { useWorkspacePrefs } from "@renderer/store/workspace-prefs"
import { isRunning } from "@renderer/lib/agent-state"
import { workspacePageUrl } from "@renderer/lib/workspace-urls"
import { isUpgradeAvailable } from "../../../shared/version-compare"
import type { ToastType } from "@renderer/hooks/useToast"
import type { Workspace } from "@renderer/types"
import { useDashboardData } from "./use-dashboard-data"
import { useAgentActions } from "./use-agent-actions"
import { mergeActivity, pickRecentAgents, pickRecentWorkspaces } from "./recent"
import { PendingUpdatesBanner } from "./components/pending-updates-banner"
import { WelcomeHero } from "./components/welcome-hero"
import { ConnectWorkspaceDialog } from "../agents/components/connect-workspace-dialog"
import { AgentsCard } from "./components/agents-card"
import { WorkspacesCard } from "./components/workspaces-card"
import { HealthCard } from "./components/health-card"
import { QuickActionsCard } from "./components/quick-actions-card"
import { ActivityCard } from "./components/activity-card"

/** A glance, not a list — the rest are one click away on their own page. */
const MAX_RECENT = 5

interface DashboardProps {
  showToast: (message: string, type?: ToastType) => void
}

export default function Dashboard({
  showToast,
}: DashboardProps): React.JSX.Element {
  const { agents, pendingAgentActions } = useAgentsStore(
    useShallow((s) => ({
      agents: s.agents,
      pendingAgentActions: s.pendingAgentActions,
    })),
  )
  const {
    activityLog,
    setCurrentTab,
    setInstallFocusAgent,
    requestCreate,
  } = useUiStore(
    useShallow((s) => ({
      activityLog: s.activityLog,
      setCurrentTab: s.setCurrentTab,
      setInstallFocusAgent: s.setInstallFocusAgent,
      requestCreate: s.requestCreate,
    })),
  )
  const updates = useInstallStore((s) => s.updates)
  const notifItems = useNotificationsStore((s) => s.items)
  const { isDismissed, ignore, later } = useUpdateDismissals()
  const { lastUsedAt, markUsed } = useWorkspacePrefs(
    useShallow((s) => ({ lastUsedAt: s.lastUsedAt, markUsed: s.markUsed })),
  )

  const data = useDashboardData()
  const actions = useAgentActions(data.refresh, showToast)

  const activity = useMemo(
    () => mergeActivity(agents, data.lastActiveByAgent),
    [agents, data.lastActiveByAgent],
  )
  const recentAgents = useMemo(
    () => pickRecentAgents(agents, activity, MAX_RECENT),
    [agents, activity],
  )
  const recentWorkspaces = useMemo(
    () => pickRecentWorkspaces(data.workspaces, lastUsedAt, MAX_RECENT),
    [data.workspaces, lastUsedAt],
  )

  const runningCount = agents.filter(isRunning).length
  const attentionCount = agents.filter(
    (a) => a.state === "error" || !!a.lastError,
  ).length

  const pendingUpdates = updates.filter(
    (u) =>
      isUpgradeAvailable(u.current, u.latest) && !isDismissed(u.name, u.latest!),
  )

  const openInstall = (): void => {
    if (pendingUpdates.length === 1) setInstallFocusAgent(pendingUpdates[0].name)
    setCurrentTab("install")
  }

  // Takes no agent, because there is nothing to do with one: the Agents page
  // has no per-agent deep-link. It used to be handed the name and call
  // `setInstallFocusAgent`, but that flag is only ever read by the marketplace
  // — so the request sat unconsumed in the store and fired on some later,
  // unrelated visit there, opening an agent nobody had asked for.
  const manageAgent = (): void => setCurrentTab("agents")

  // Joining a workspace is offered here as well as on the agents list, so the
  // dashboard opens the same dialog rather than dropping the user on a page
  // and leaving them to find it.
  const [connectAgent, setConnectAgent] = useState<string>("")

  // Same as the workspaces page: opening one is what marks it as used, which is
  // what this card orders by.
  const openWorkspace = (ws: Workspace): void => {
    markUsed(ws.id)
    window.api.openExternal(workspacePageUrl(ws))
  }

  return (
    // No PageHeader: the welcome banner is this page's header, and the rail
    // already says which screen the user is on.
    <section className="h-full overflow-y-auto px-9 py-6">
      {/* Full-width bands rather than a content column beside a sidebar: on a
          wide monitor the sidebar's three low-density cards were claiming a
          third of the width while the tables were squeezed into the rest. */}
      <div className="flex flex-col gap-4">
        <WelcomeHero
          runningCount={runningCount}
          activeWorkspaceCount={data.activeWorkspaceCount}
          todayMessageCount={data.todayMessageCount}
          attentionCount={attentionCount}
          onNewAgent={() => requestCreate("agent")}
          onNewWorkspace={() => requestCreate("workspace")}
        />

        <PendingUpdatesBanner
          updates={pendingUpdates}
          onIgnore={(u) => u.latest && ignore(u.name, u.latest)}
          onSnooze={(u) => u.latest && later(u.name, u.latest)}
          onView={openInstall}
        />

        {/* Side by side only past 1920px — below that a five-column table in
            half the window starts scrolling sideways. Both cards stretch to the
            taller of the two so the band has one bottom edge. */}
        <div className="grid grid-cols-1 gap-4 3xl:grid-cols-2">
          <AgentsCard
            agents={recentAgents}
            total={agents.length}
            lastActive={activity}
            loading={data.loading}
            pending={pendingAgentActions}
            onToggle={(a) => void actions.toggle(a)}
            onOpenTerminal={(a) => actions.openTerminal(a)}
            onConnect={(a) => setConnectAgent(a.name)}
            onManage={() => manageAgent()}
            onViewAll={() => setCurrentTab("agents")}
            onNewAgent={() => requestCreate("agent")}
          />

          <WorkspacesCard
            workspaces={recentWorkspaces}
            total={data.workspaces.length}
            agents={agents}
            lastUsedAt={lastUsedAt}
            onOpen={openWorkspace}
            onViewAll={() => setCurrentTab("workspaces")}
            onCreateFirst={() => requestCreate("workspace")}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <HealthCard agents={agents} />
          <QuickActionsCard onNavigate={setCurrentTab} />
          <ActivityCard uiActivity={activityLog} notifications={notifItems} />
        </div>
      </div>

      <ConnectWorkspaceDialog
        open={!!connectAgent}
        agentName={connectAgent}
        onClose={() => setConnectAgent("")}
        showToast={showToast}
        onConnected={data.refresh}
      />
    </section>
  )
}
