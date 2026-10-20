import { MessagesSquare, Monitor } from "lucide-react"
import { useTranslation } from "react-i18next"
import { LauncherUpdateBanner } from "@renderer/components/LauncherUpdateBanner"
import { useAccountStore } from "@renderer/store/account"
import { cn } from "@renderer/lib/utils"
import { WorkspaceTabs } from "./workspace-tabs"

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
        "flex h-6 items-center gap-1.5 rounded px-2.5 text-xs font-medium transition-colors",
        // Raised, outlined and bold, so the side the window is on reads at a
        // glance against the grey bar.
        active
          ? "bg-background font-semibold text-foreground shadow-sm ring-1 ring-border"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-3.5", active && "text-primary")} />{label}
    </button>
  )
}

/**
 * Native window chrome. The two halves of the window always sit in the same
 * place — Workspace, for working with people and agents; This Computer, for the
 * device the agents run on. Workspace owns all navigation inside its web UI;
 * the open workspaces show here as tabs on the Workspace side, and stay open
 * (only out of sight) while This Computer is showing.
 */
export function ModeBar(): React.JSX.Element {
  const { t } = useTranslation()
  const mode = useAccountStore((s) => s.mode)
  const account = useAccountStore((s) => s.account)
  return (
    <header className="titlebar-drag relative z-20 flex h-(--mode-bar-h) shrink-0 items-center gap-3 border-b bg-sidebar pr-(--window-controls-w) pl-(--traffic-lights-w)">
      <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch pl-2">
        <div role="tablist" aria-label={t("nav.modeSwitch")} className="titlebar-no-drag flex shrink-0 items-center rounded-md bg-muted p-0.5">
          <ModeTab active={mode === "workspace"} onClick={() => useAccountStore.getState().enterWorkspaceMode()}
            icon={MessagesSquare} label={t("nav.modeWorkspace")} testId="mode-workspace" />
          <ModeTab active={mode === "launcher"} onClick={() => useAccountStore.getState().exitWorkspace()}
            icon={Monitor} label={t("nav.modeLauncher")} testId="mode-launcher" />
        </div>
        {/* Not draggable as a whole: the empty bar beside the tabs still moves the window. */}
        {mode === "workspace" && account && <WorkspaceTabs />}
      </div>
      {/* The Workspace's native view covers everything below this bar. */}
      {mode === "workspace" && (
        <div className="titlebar-no-drag flex shrink-0 justify-center">
          <LauncherUpdateBanner inline />
        </div>
      )}
    </header>
  )
}
