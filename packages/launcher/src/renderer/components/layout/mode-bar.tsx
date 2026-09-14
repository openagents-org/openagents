import { Grid2X2, MessagesSquare, Monitor } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@renderer/components/ui/button"
import { LauncherUpdateBanner } from "@renderer/components/LauncherUpdateBanner"
import { useAccountStore } from "@renderer/store/account"
import { cn } from "@renderer/lib/utils"

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
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />{label}
    </button>
  )
}

/**
 * Native window chrome. The two halves of the window always sit in the same
 * place — Workspace, for working with people and agents; This Computer, for the
 * device the agents run on. Workspace owns all navigation inside its web UI.
 */
export function ModeBar(): React.JSX.Element {
  const { t } = useTranslation()
  const mode = useAccountStore((s) => s.mode)
  const account = useAccountStore((s) => s.account)
  return (
    <header className="titlebar-drag relative z-20 flex h-(--mode-bar-h) shrink-0 items-center gap-3 border-b bg-sidebar pr-(--window-controls-w) pl-(--traffic-lights-w)">
      <div className="titlebar-no-drag ml-2 flex min-w-0 items-center gap-2">
        <div role="tablist" aria-label={t("nav.modeSwitch")} className="flex items-center rounded-md bg-muted p-0.5">
          <ModeTab active={mode === "workspace"} onClick={() => useAccountStore.getState().enterWorkspaceMode()}
            icon={MessagesSquare} label={t("nav.modeWorkspace")} testId="mode-workspace" />
          <ModeTab active={mode === "launcher"} onClick={() => useAccountStore.getState().exitWorkspace()}
            icon={Monitor} label={t("nav.modeLauncher")} testId="mode-launcher" />
        </div>
        {mode === "workspace" && account && (
          <Button variant="ghost" size="sm" onClick={() => useAccountStore.getState().openWorkspaces()} data-testid="all-workspaces">
            <Grid2X2 className="size-3.5" />{t("account.workspaces.title")}
          </Button>
        )}
      </div>
      {/* The Workspace's native view covers everything below this bar. */}
      {mode === "workspace" && (
        <div className="titlebar-no-drag mx-auto flex min-w-0 justify-center">
          <LauncherUpdateBanner inline />
        </div>
      )}
    </header>
  )
}
