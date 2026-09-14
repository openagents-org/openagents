import { ArrowLeft, Grid2X2, Monitor } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@renderer/components/ui/button"
import { LauncherUpdateBanner } from "@renderer/components/LauncherUpdateBanner"
import { useAccountStore } from "@renderer/store/account"

/** Native window chrome. Workspace owns all navigation inside its web UI. */
export function ModeBar(): React.JSX.Element {
  const { t } = useTranslation()
  const mode = useAccountStore((s) => s.mode)
  const account = useAccountStore((s) => s.account)
  return (
    <header className="titlebar-drag relative z-20 flex h-(--mode-bar-h) shrink-0 items-center gap-3 border-b bg-sidebar pr-(--window-controls-w) pl-(--traffic-lights-w)">
      <div className="titlebar-no-drag flex min-w-0 items-center gap-2">
        {mode === "launcher" ? (
          <Button variant="ghost" size="sm" onClick={() => useAccountStore.getState().enterWorkspaceMode()} data-testid="mode-workspace">
            <ArrowLeft className="size-3.5" />{t("nav.modeWorkspace")}
          </Button>
        ) : mode === "workspace" && account ? (
          <Button variant="ghost" size="sm" onClick={() => useAccountStore.getState().openWorkspaces()} data-testid="all-workspaces">
            <Grid2X2 className="size-3.5" />{t("account.workspaces.title")}
          </Button>
        ) : mode === "workspace" ? (
          <Button variant="ghost" size="sm" onClick={() => useAccountStore.getState().showWelcome()}><ArrowLeft className="size-3.5" />{t("account.welcome.back")}</Button>
        ) : <span className="px-3 text-xs font-medium">OpenAgents</span>}
      </div>
      {/* The Workspace's native view covers everything below this bar. */}
      {mode === "workspace" && (
        <div className="titlebar-no-drag mx-auto flex min-w-0 justify-center">
          <LauncherUpdateBanner inline />
        </div>
      )}
      <div className="ml-auto mr-3 flex items-center titlebar-no-drag">
        {mode === "launcher" ? <span className="text-xs font-medium text-muted-foreground">{t("nav.modeLauncher")}</span> : mode === "workspace" ? (
          <Button variant="ghost" size="sm" onClick={() => useAccountStore.getState().exitWorkspace()} data-testid="mode-launcher"><Monitor className="size-3.5" />{t("nav.modeLauncher")}</Button>
        ) : null}
      </div>
    </header>
  )
}
