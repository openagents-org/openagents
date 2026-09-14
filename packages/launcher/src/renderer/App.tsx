import React, { useEffect } from "react"
import { useShallow } from "zustand/react/shallow"
import { useUiStore } from "./store/ui"
import { useAgentsStore } from "./store/agents"
import { useInstallStore } from "./store/install"
import { useThemeStore } from "./store/theme"
import { useAppearanceStore } from "./store/appearance"
import { useNotificationsStore } from "./store/notifications"
import { useAccountStore } from "./store/account"
import { AppShell } from "./components/layout/app-shell"
import { ModeBar } from "./components/layout/mode-bar"
import { SHORTCUT_TABS } from "./components/layout/nav-config"
import { Toaster } from "./components/ui/sonner"
import { CommandPalette } from "./components/command-palette"
import { GuidedTour } from "./components/onboarding/GuidedTour"
import Agents from "./pages/agents"
import Workspaces from "./pages/workspaces"
import WorkspacePage from "./pages/workspace"
import { Spinner } from "./components/ui/spinner"
import Connections from "./pages/connections"
import Credentials from "./pages/credentials"
import GitHubPage from "./pages/github"
import Install from "./pages/install"
import Logs from "./pages/logs"
import Settings from "./pages/settings"
import { WhatsNewDialog } from "./components/whats-new/whats-new-dialog"
import { useWhatsNew } from "./components/whats-new/use-whats-new"
import { InstallMiniBanner } from "./components/install-progress/install-mini-banner"
import { LauncherUpdateBanner } from "./components/LauncherUpdateBanner"
import { useToasts } from "./hooks/useToast"
import { useInstallProgress } from "./hooks/useInstallProgress"
import { useStartupPage } from "./hooks/useStartupPage"
import { useNotificationClicks } from "./hooks/useNotificationRouting"
import { useFullScreen } from "./hooks/useFullScreen"
import { capture } from "./lib/analytics"

export default function App(): React.JSX.Element {
  const currentTab = useUiStore((s) => s.currentTab)
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)
  const setCoreUpdateInfo = useAgentsStore((s) => s.setCoreUpdateInfo)
  const initTheme = useThemeStore((s) => s.init)
  const initAppearance = useAppearanceStore((s) => s.init)
  const initNotifications = useNotificationsStore((s) => s.init)
  const initAccount = useAccountStore((s) => s.init)
  const { showToast } = useToasts()
  const tourOpen = useUiStore((s) => s.tourOpen)
  const whatsNew = useWhatsNew()

  // Here rather than in AppShell: workspace mode returns before the shell is
  // ever rendered, so mounting it there left that half of the app believing it
  // was never full screen — and holding the window buttons' clearance open
  // across the top of a workspace that had no buttons to clear.
  useFullScreen()

  useEffect(() => {
    initTheme()
    initAppearance()
    void initNotifications()
    // Reads the stored session and subscribes to changes. Signed out is a
    // perfectly good outcome — the workspace half simply stays behind its gate.
    void initAccount()
    // The app entry replaces automatic machine-pairing onboarding. Existing
    // local tools and the optional guided tour remain available in This Computer.
    void window.api.consumeOnboardingReset().catch(() => false)
  }, [initTheme, initAppearance, initNotifications, initAccount])

  // Global install:progress + install:output subscription
  useInstallProgress()
  // Settings → General → "Open on launch"
  useStartupPage()
  // Clicks on OS notification toasts
  useNotificationClicks()

  const { jobs } = useInstallStore(useShallow((s) => ({ jobs: s.jobs })))
  const appMode = useAccountStore((s) => s.mode)
  const accountReady = useAccountStore((s) => s.ready)

  useEffect(() => {
    window.api.onCoreUpdate((info) => setCoreUpdateInfo(info))
    window.api.onAgentUpdatesChanged((updates) =>
      useInstallStore.getState().setUpdates(updates),
    )
    window.api.onNavigateToInstall((name?: string) => {
      useAccountStore.getState().exitWorkspace("install")
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
    const handler = (e: KeyboardEvent): void => {
      if (useAccountStore.getState().mode !== "launcher") return
      if (e.ctrlKey && e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key) - 1
        if (idx < SHORTCUT_TABS.length) {
          e.preventDefault()
          useUiStore.getState().setCurrentTab(SHORTCUT_TABS[idx])
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
    <>
      {/* Persistent desktop navigation above the welcome, Workspace, or local area. */}
      <div className="flex h-screen flex-col overflow-hidden">
        <ModeBar />
        <div className="min-h-0 flex-1">
          {!accountReady ? (
            <div className="flex h-full items-center justify-center"><Spinner className="size-5" /></div>
          ) : appMode === "workspace" ? (
            <WorkspacePage showToast={showToast} />
          ) : (
            <AppShell>
              {currentTab === "dashboard" && (
                <Agents overview showToast={showToast} />
              )}              {currentTab === "workspaces" && (
                <Workspaces showToast={showToast} />
              )}
              {currentTab === "connections" && (
                <Connections showToast={showToast} />
              )}
              {currentTab === "credentials" && (
                <Credentials showToast={showToast} />
              )}
              {currentTab === "github" && <GitHubPage showToast={showToast} />}
              {currentTab === "install" && <Install showToast={showToast} />}
              {currentTab === "logs" && <Logs showToast={showToast} />}
              {currentTab === "settings" && <Settings showToast={showToast} />}
            </AppShell>
          )}
        </div>
      </div>

      {activeJob && currentTab !== "install" && appMode === "launcher" && (
        <InstallMiniBanner
          job={activeJob}
          onOpen={() => setCurrentTab("install")}
        />
      )}

      {/* In the Workspace the mode bar carries it; see ModeBar. */}
      {appMode !== "workspace" && <LauncherUpdateBanner />}
      <Toaster position="bottom-right" />
      {appMode === "launcher" && <CommandPalette />}
      {appMode === "launcher" && <GuidedTour />}

      {accountReady && appMode === "launcher" && !tourOpen && (
        <WhatsNewDialog
          open={whatsNew.open}
          releases={whatsNew.releases}
          onClose={whatsNew.close}
        />
      )}
    </>
  )
}
