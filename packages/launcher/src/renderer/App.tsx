import React, { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { useUiStore } from "./store/ui"
import { useAgentsStore } from "./store/agents"
import { useInstallStore } from "./store/install"
import { useThemeStore } from "./store/theme"
import { useNotificationsStore } from "./store/notifications"
import Sidebar from "./components/Sidebar"
import { ToastContainer } from "./components/ui/Toast"
import { CommandPalette } from "./components/command-palette/CommandPalette"
import { OnboardingFlow, shouldShowOnboarding } from "./components/onboarding/OnboardingFlow"
import { GuidedTour, shouldShowGuidedTour } from "./components/onboarding/GuidedTour"
import Dashboard from "./pages/dashboard"
import Agents from "./pages/agents"
import Workspaces from "./pages/workspaces"
import Connections from "./pages/connections"
import Credentials from "./pages/credentials"
import GitHubPage from "./pages/github"
import Install from "./pages/install"
import Logs from "./pages/logs"
import Settings from "./pages/settings"
import { InstallMiniBanner } from "./components/install-progress/StagedProgress"
import { LauncherUpdateBanner } from "./components/LauncherUpdateBanner"
import { useToasts } from "./hooks/useToast"
import { useInstallProgress } from "./hooks/useInstallProgress"
import { cn } from "./lib/utils"
import { capture } from "./lib/analytics"

export default function App(): React.JSX.Element {
  const currentTab = useUiStore((s) => s.currentTab)
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const setCoreUpdateInfo = useAgentsStore((s) => s.setCoreUpdateInfo)
  const initTheme = useThemeStore((s) => s.init)
  const initNotifications = useNotificationsStore((s) => s.init)
  const { showToast } = useToasts()
  const startTour = useUiStore((s) => s.startTour)
  const [onboardingOpen, setOnboardingOpen] = React.useState(false)

  useEffect(() => {
    initTheme()
    void initNotifications()
    // After an upgrade the main process flags a one-time onboarding reset. We
    // MUST resolve that flag before deciding whether to show onboarding or to
    // auto-run the spotlight tour: otherwise a returning user (onboarding
    // already complete, tour never seen) would auto-start the tour
    // synchronously, and the async reset would then re-open the onboarding
    // wizard on top of it — showing both at once. Serializing the decision
    // against the final localStorage state avoids that race entirely.
    void window.api
      .consumeOnboardingReset()
      .catch(() => false)
      .then((reset) => {
        if (reset) {
          // Clear saved onboarding state so returning users walk through the
          // new key-based configuration steps from the top.
          try {
            localStorage.removeItem("onboarding_completed")
            localStorage.removeItem("onboarding_step")
            localStorage.removeItem("last_selected_agent")
          } catch {}
        }
        const showOnboarding = shouldShowOnboarding()
        setOnboardingOpen(showOnboarding)
        // Returning users who already finished onboarding but never saw the
        // spotlight tour get it once now. New users (and post-reset users) get
        // it only after the provisioning wizard closes — see OnboardingFlow's
        // onClose handler — so the tour never overlaps the wizard.
        if (!showOnboarding && shouldShowGuidedTour()) startTour()
      })
  }, [initTheme, initNotifications, startTour])

  // Global install:progress + install:output subscription
  useInstallProgress()

  const { jobs } = useInstallStore(useShallow((s) => ({ jobs: s.jobs })))

  useEffect(() => {
    window.api.onCoreUpdate((info) => setCoreUpdateInfo(info))
    window.api.onAgentUpdatesChanged((updates) =>
      useInstallStore.getState().setUpdates(updates),
    )
    window.api.onNavigateToInstall((name?: string) => {
      setCurrentTab("install")
      if (name) useUiStore.getState().setInstallFocusAgent(name)
    })
  }, [setCoreUpdateInfo, setCurrentTab])

  // Track in-app navigation as pageviews so the launcher's page flow shows up in
  // PostHog like website navigation does. currentTab is the single value that
  // every navigation path (sidebar, keyboard shortcuts, deep-links, notifications,
  // dashboard quick-actions) updates, so one effect covers them all. Fires on
  // mount too, recording the entry screen.
  useEffect(() => {
    capture("$pageview", {
      screen: currentTab,
      $current_url: `app://launcher/${currentTab}`,
    })
  }, [currentTab])

  useEffect(() => {
    const tabs = [
      "dashboard",
      "agents",
      "workspaces",
      "connections",
      "credentials",
      "github",
      "install",
      "logs",
      "settings",
    ]
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1
        if (idx < tabs.length) {
          e.preventDefault()
          useUiStore.getState().setCurrentTab(tabs[idx])
        }
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const activeJob = Object.values(jobs)
    .filter((j) => j.phase !== "done" && j.phase !== "error")
    .sort((a, b) => b.startedAt - a.startedAt)[0]

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--bg-primary)]">
      <Sidebar />

      <main
        className={cn(
          "flex-1 min-w-0 bg-(--bg-primary)",
          "overflow-hidden flex flex-col",
        )}
      >
        {currentTab === "dashboard" && (
          <Dashboard
            showToast={showToast}
            onOpenConfigure={() => {}}
            onOpenConnectWorkspace={() => {}}
          />
        )}

        {currentTab === "agents" && <Agents showToast={showToast} />}
        {currentTab === "workspaces" && <Workspaces showToast={showToast} />}
        {currentTab === "connections" && <Connections showToast={showToast} />}
        {currentTab === "credentials" && <Credentials showToast={showToast} />}
        {currentTab === "github" && <GitHubPage showToast={showToast} />}
        {currentTab === "install" && <Install showToast={showToast} />}
        {currentTab === "logs" && <Logs showToast={showToast} />}
        {currentTab === "settings" && <Settings showToast={showToast} />}
      </main>

      {activeJob && currentTab !== "install" && (
        <InstallMiniBanner
          job={activeJob}
          onOpen={() => setCurrentTab("install")}
        />
      )}

      <LauncherUpdateBanner />
      <ToastContainer />
      <CommandPalette />
      <OnboardingFlow
        open={onboardingOpen}
        onClose={() => {
          setOnboardingOpen(false)
          // Right after the wizard, run the spotlight tour once to show where
          // each step lives in the sidebar.
          if (shouldShowGuidedTour()) startTour()
        }}
        showToast={showToast}
      />
      {/* Never mount the tour while the onboarding wizard is open — they are
          mutually exclusive, and this guarantees the spotlight can never render
          on top of the wizard even if a stray startTour() slips through. */}
      {!onboardingOpen && <GuidedTour />}
    </div>
  )
}
