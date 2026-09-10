import React from "react"
import { useShallow } from "zustand/react/shallow"
import { useTranslation } from "react-i18next"
import { ChevronLeft } from "lucide-react"

import { cn } from "@renderer/lib/utils"
import { useAccountStore } from "@renderer/store/account"

/**
 * The window's top strip: which half of the app you are in.
 *
 * The two halves are peers, not a page and a detour off it — one is this
 * machine, the other is the account — so the switch between them is a pair of
 * tabs that is always on screen, rather than a button on one side and a way
 * back on the other.
 *
 * "This machine" rather than "my agents": that half is everything this device
 * has — its runtimes, its agents, the workspaces it is paired into, its logs
 * and settings — and naming it after one of those made the rest look misfiled.
 * It also puts the two tabs on the same axis, device against account, which is
 * the actual difference between them.
 *
 * It also carries the window buttons' clearance for the whole window. That used
 * to be split per pane (the rail on macOS, the content area on Windows) because
 * only one pane ever had buttons over it; a full-width strip has both corners,
 * so both insets live here and the panes below start at its bottom edge.
 *
 * The strip's HEIGHT is its own token, not the button clearance: in full screen
 * the OS draws no buttons and the clearance collapses, but these tabs still
 * have to be reachable.
 */
export function ModeBar(): React.JSX.Element {
  const { t } = useTranslation()
  const {
    mode,
    active,
    account,
    enterWorkspaceMode,
    exitWorkspace,
    setActive,
  } = useAccountStore(
    useShallow((s) => ({
      mode: s.mode,
      active: s.active,
      account: s.account,
      enterWorkspaceMode: s.enterWorkspaceMode,
      exitWorkspace: s.exitWorkspace,
      setActive: s.setActive,
    })),
  )

  return (
    <header className="titlebar-drag relative z-20 flex h-(--mode-bar-h) shrink-0 items-center gap-3 border-b bg-sidebar pr-(--window-controls-w) pl-(--traffic-lights-w)">
      <div
        role="tablist"
        aria-label={t("nav.modeSwitch")}
        className="titlebar-no-drag flex items-center gap-0.5 rounded-md bg-sidebar-accent/60 p-0.5"
      >
        <ModeTab
          selected={mode === "launcher"}
          onSelect={exitWorkspace}
          testId="mode-launcher"
        >
          {t("nav.modeLauncher")}
        </ModeTab>
        <ModeTab
          selected={mode === "workspace"}
          onSelect={enterWorkspaceMode}
          testId="mode-workspace"
        >
          {t("nav.modeWorkspace")}
        </ModeTab>
      </div>

      {/* Which workspace is open, and the way back out of it. The list is the
          Workspace side's own first screen, so leaving one is just clearing the
          selection — no navigation, and the view stays warm underneath. */}
      {mode === "workspace" && account && active && (
        <button
          type="button"
          onClick={() => setActive(null)}
          title={t("account.workspaces.title")}
          data-testid="mode-bar-workspace-name"
          className="titlebar-no-drag flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-2xs text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <ChevronLeft className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{active.name}</span>
        </button>
      )}
    </header>
  )
}

function ModeTab({
  selected,
  onSelect,
  testId,
  children,
}: {
  selected: boolean
  onSelect: () => void
  testId: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      data-testid={testId}
      onClick={onSelect}
      className={cn(
        "rounded px-2.5 py-1 text-2xs font-medium transition-colors",
        selected
          ? "bg-sidebar text-sidebar-foreground shadow-xs"
          : "text-sidebar-muted hover:text-sidebar-foreground",
      )}
    >
      {children}
    </button>
  )
}
