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
        "flex h-8 min-w-32 items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-colors",
        // Filled in the accent: these two decide everything below them, so
        // the side the window is on has to read at a glance.
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background hover:text-foreground",
      )}
    >
      <Icon className="size-4" />{label}
    </button>
  )
}

/**
 * The window's top edge.
 *
 * The first row is the native title bar, read left to right: the product, the
 * switch between the two halves of the window — Workspace, for working with
 * people and agents; This Computer, for the device the agents run on — and
 * then what belongs to the half that is showing. On the Workspace side that is
 * the workspace tabs, All Workspaces first, in the same row; on This Computer,
 * the way into search, with theme and notifications in the status footer. It
 * is the window's drag handle and carries the OS buttons' clearance on
 * whichever side they are drawn.
 *
 * Only This Computer has a second row, for its pages. The workspace tabs stay
 * open (only out of sight) while This Computer is showing.
 */
export function ModeBar(): React.JSX.Element {
  const { t } = useTranslation()
  const mode = useAccountStore((s) => s.mode)
  const account = useAccountStore((s) => s.account)
  const local = mode === "launcher"
  const onHome = useWorkspaceTabsStore((s) => s.active === WORKSPACE_HOME_TAB)

  return (
    <header className="relative z-20 shrink-0 border-b bg-background">
      <div className="titlebar-drag flex h-(--mode-bar-h) items-center gap-4 pr-(--window-controls-w) pl-(--traffic-lights-w)">
        <div className="flex shrink-0 items-center gap-2 pl-4">
          <BrandMark className="size-6 shrink-0" />
          <span className="text-base font-semibold tracking-tight">OpenAgents</span>
        </div>
        <div role="tablist" aria-label={t("nav.modeSwitch")} className="titlebar-no-drag flex shrink-0 items-center gap-1 rounded-lg bg-muted p-1">
          <ModeTab active={mode === "workspace"} onClick={() => useAccountStore.getState().enterWorkspaceMode()}
            icon={MessagesSquare} label={t("nav.modeWorkspace")} testId="mode-workspace" />
          <ModeTab active={local} onClick={() => useAccountStore.getState().exitWorkspace()}
            icon={Monitor} label={t("nav.modeLauncher")} testId="mode-launcher" />
        </div>
        {local ? (
          <div className="flex min-w-0 flex-1 items-center justify-end pr-4">
            <div className="titlebar-no-drag flex items-center">
              <TopSearch />
            </div>
          </div>
        ) : (
          <>
            {account && (
              <>
                <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
                <div className="flex min-w-0 flex-1 items-center self-stretch">
                  <WorkspaceTabs />
                </div>
              </>
            )}
            {/* Popovers from here would open under the Workspace's native view,
                so this side keeps only what cannot wait: the update notice, and
                on All Workspaces the account, whose page drops its own header
                here. */}
            <div className={cn("flex items-center justify-end gap-3 pr-4", account ? "shrink-0" : "min-w-0 flex-1")}>
              <div className="titlebar-no-drag flex shrink-0 justify-center">
                <LauncherUpdateBanner inline />
              </div>
              {onHome && <AccountChip />}
            </div>
          </>
        )}
      </div>
      {local && (
        <div className="flex h-11 items-center border-t px-4">
          <div className="flex min-w-0 flex-1 items-stretch self-stretch px-5"><LocalNav /></div>
        </div>
      )}
    </header>
  )
}
