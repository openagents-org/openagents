import { MessagesSquare, Monitor } from "lucide-react"
import { useTranslation } from "react-i18next"
import { LauncherUpdateBanner } from "@renderer/components/LauncherUpdateBanner"
import { BrandMark } from "@renderer/components/ui-kit"
import { useAccountStore } from "@renderer/store/account"
import { useWorkspaceTabsStore } from "@renderer/store/workspace-tabs"
import { cn } from "@renderer/lib/utils"
import { WorkspaceTabs } from "./workspace-tabs"
import { LocalNav } from "./local-nav"
import { TopSearch } from "./top-search"
import { ThemeMenu } from "./theme-menu"
import { NotificationBell } from "./notification-bell"
import { DeviceStatus } from "./device-status"
import { AccountChip } from "./account-chip"
import { WORKSPACE_HOME_TAB } from "../../../shared/workspace-view"

function ModeTab({ active, onClick, icon: Icon, label, testId }: {
  active: boolean
  onClick: () => void
  icon: typeof Monitor
  label: string
  testId: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded px-3 text-sm transition-colors",
        // Raised, so the side the window is on reads at a glance.
        active
          ? "bg-background font-medium text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4", active && "text-primary")} />{label}
    </button>
  )
}

/**
 * The window's top edge, in two rows.
 *
 * The first is the native title bar: the product, the switch between the two
 * halves of the window — Workspace, for working with people and agents; This
 * Computer, for the device the agents run on — and, on This Computer, search
 * and the global tools. It is the window's drag handle and carries the OS
 * buttons' clearance on whichever side they are drawn.
 *
 * The second row navigates the half that is showing: This Computer's pages and
 * the open workspaces, or, on the Workspace side, the workspace tabs. Those
 * stay open (only out of sight) while This Computer is showing.
 */
export function ModeBar(): React.JSX.Element {
  const { t } = useTranslation()
  const mode = useAccountStore((s) => s.mode)
  const account = useAccountStore((s) => s.account)
  const local = mode === "launcher"
  const secondRow = local || !!account
  const onHome = useWorkspaceTabsStore((s) => s.active === WORKSPACE_HOME_TAB)

  return (
    <header className="relative z-20 shrink-0 border-b bg-background">
      <div className="titlebar-drag flex h-(--mode-bar-h) items-center gap-4 pr-(--window-controls-w) pl-(--traffic-lights-w)">
        <div className="flex min-w-0 flex-1 items-center gap-2 pl-4">
          <BrandMark className="size-6 shrink-0" />
          <span className="truncate text-base font-semibold tracking-tight">OpenAgents</span>
        </div>
        <div role="tablist" aria-label={t("nav.modeSwitch")} className="titlebar-no-drag flex shrink-0 items-center rounded-md bg-muted p-0.5">
          <ModeTab active={mode === "workspace"} onClick={() => useAccountStore.getState().enterWorkspaceMode()}
            icon={MessagesSquare} label={t("nav.modeWorkspace")} testId="mode-workspace" />
          <ModeTab active={local} onClick={() => useAccountStore.getState().exitWorkspace()}
            icon={Monitor} label={t("nav.modeLauncher")} testId="mode-launcher" />
        </div>
        {/* Popovers from here would open under the Workspace's native view, so
            its side keeps only what cannot wait: the update notice, and on All
            Workspaces the account, whose page drops its own header here. */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 pr-4">
          {local ? (
            <div className="titlebar-no-drag flex min-w-0 items-center gap-1">
              <TopSearch />
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
              <ThemeMenu />
              <NotificationBell />
              <span aria-hidden className="mx-1 h-5 w-px bg-border" />
              <DeviceStatus />
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <div className="titlebar-no-drag flex shrink-0 justify-center">
                <LauncherUpdateBanner inline />
              </div>
              {onHome && <AccountChip />}
            </div>
          )}
        </div>
      </div>
      {secondRow && (
        <div className="flex h-11 items-center border-t px-4">
          {local ? <div className="flex min-w-0 flex-1 items-stretch self-stretch px-5"><LocalNav /></div> : <WorkspaceTabs />}
        </div>
      )}
    </header>
  )
}
