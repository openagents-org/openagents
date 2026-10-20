import React from "react"
import { AlertCircle, ChevronDown, Grid2X2, MessagesSquare, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import { useAccountStore } from "@renderer/store/account"
import { useWorkspaceTabsStore } from "@renderer/store/workspace-tabs"
import { cn } from "@renderer/lib/utils"
import {
  shortcutTab,
  TAB_MENU_THRESHOLD,
  WORKSPACE_HOME_TAB,
  type WorkspaceTab,
} from "../../../shared/workspace-view"

/** Title, plus the slug when another open tab has the same name. */
function labelsFor(tabs: WorkspaceTab[]): Map<string, { title: string; hint: string | null }> {
  const counts = new Map<string, number>()
  for (const tab of tabs) counts.set(tab.title, (counts.get(tab.title) ?? 0) + 1)
  return new Map(tabs.map((tab) => [tab.id, {
    title: tab.title,
    hint: (counts.get(tab.title) ?? 0) > 1 && tab.slug && tab.slug !== tab.title ? tab.slug : null,
  }]))
}

/**
 * Tab chrome, shared by the workspace tabs and All Workspaces. The active tab
 * is raised off the bar — the same treatment as the mode switch beside it —
 * rather than joined to the page below: that page is the Workspace app, with
 * colours of its own the launcher cannot match under every skin. Inactive tabs
 * sit flat on the bar between dividers.
 */
function tabClass(active: boolean, divided: boolean): string {
  return cn(
    "group relative flex h-7 items-center gap-1 rounded-md text-xs font-medium transition-colors",
    active
      ? "z-10 bg-background font-semibold text-foreground shadow-sm ring-1 ring-border"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
    divided && !active && "after:absolute after:inset-y-1.5 after:-left-px after:w-px after:bg-border group-hover:after:opacity-0",
  )
}

function TabStatus({ state, active }: { state: WorkspaceTab["state"]; active: boolean }): React.JSX.Element {
  if (state === "loading") return <Spinner className="size-3 shrink-0" />
  if (state === "failed") return <AlertCircle className="size-3 shrink-0 text-destructive" />
  return <MessagesSquare className={cn("size-3.5 shrink-0", active && "text-primary")} />
}

/** All Workspaces, pinned first: a tab like the others, but never closed. */
function HomeTab({ active }: { active: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button type="button" role="tab" aria-selected={active} data-testid="all-workspaces"
      onClick={() => useAccountStore.getState().openWorkspaces()}
      className={cn(tabClass(active, false), "titlebar-no-drag shrink-0 gap-1.5 px-3")}>
      <Grid2X2 className={cn("size-3.5 shrink-0", active && "text-primary")} />
      {t("account.workspaces.title")}
    </button>
  )
}

function TabButton({ tab, label, active, divided, onSelect, onClose }: {
  tab: WorkspaceTab
  label: { title: string; hint: string | null }
  active: boolean
  /** Draw the divider on its left: off beside the active tab. */
  divided: boolean
  onSelect: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const ref = React.useRef<HTMLDivElement>(null)
  // A tab switched to by shortcut or from the menu may be scrolled out of sight.
  React.useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [active])
  // A native tooltip rather than the launcher's: anything drawn below this bar
  // would land under the Workspace view and never be seen.
  const full = label.hint ? `${label.title} (${label.hint})` : label.title
  return (
    <div
      ref={ref}
      // Tabs shrink together until they reach their minimum, and only then
      // does the strip scroll.
      className={cn(tabClass(active, divided), "w-44 min-w-28 shrink cursor-default pr-1.5 pl-3")}
      // The whole tab selects, padding included; the close button stops that.
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); void window.api.showWorkspaceTabContextMenu(tab.id) }}
      // Middle click closes, as in a browser.
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose() } }}
    >
      <button type="button" role="tab" aria-selected={active} title={full}
        data-testid="workspace-tab" className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left">
        <TabStatus state={tab.state} active={active} />
        <span className="truncate">{label.title}</span>
        {label.hint && <span className="shrink-0 font-normal text-muted-foreground">{label.hint}</span>}
      </button>
      <button type="button" aria-label={t("workspaceTabs.close", { name: full })} title={t("workspaceTabs.close", { name: full })}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted-foreground/15 hover:text-foreground">
        <X className="size-3" />
      </button>
    </div>
  )
}

/**
 * Every open tab with its shortcut, once there are too many to scan at a
 * glance. Opened by main as an OS menu — see workspace-tab-menu.ts for why.
 */
function TabMenuButton({ count }: { count: number }): React.JSX.Element {
  const { t } = useTranslation()
  const label = t("workspaceTabs.all", { count })
  return (
    <Button variant="ghost" size="icon-xs" className="titlebar-no-drag shrink-0" aria-label={label} title={label}
      data-testid="workspace-tab-menu"
      onClick={(e) => {
        const { left, bottom } = e.currentTarget.getBoundingClientRect()
        void window.api.showWorkspaceTabMenu({ x: left, y: bottom })
      }}>
      <ChevronDown className="size-3.5" />
    </Button>
  )
}

/**
 * All Workspaces and the open workspaces, one tab each. Closing a tab closes
 * its page only — the workspace, this device's connection to it and its
 * agents carry on.
 */
export function WorkspaceTabs(): React.JSX.Element {
  const { t } = useTranslation()
  const tabs = useWorkspaceTabsStore((s) => s.tabs)
  const shown = useWorkspaceTabsStore((s) => s.active)
  const labels = React.useMemo(() => labelsFor(tabs), [tabs])

  React.useEffect(() => { useWorkspaceTabsStore.getState().init() }, [])

  // The same shortcuts main handles while a workspace page has focus, for when
  // the launcher's own window does — after clicking this strip, say. Only on
  // the Workspace side: This Computer keeps Ctrl+1–9 for its own pages.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useAccountStore.getState().mode !== "workspace") return
      const { tabs: open, activate } = useWorkspaceTabsStore.getState()
      const id = shortcutTab({ type: "keyDown", key: e.key, meta: e.metaKey, control: e.ctrlKey, shift: e.shiftKey, alt: e.altKey },
        window.api?.platform ?? "", open.map((tab) => tab.id))
      if (!id) return
      e.preventDefault()
      activate(id)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div role="tablist" aria-label={t("workspaceTabs.label")} className="flex min-w-0 flex-1 items-center gap-1 self-stretch">
      <HomeTab active={shown === WORKSPACE_HOME_TAB} />
      <div className="titlebar-no-drag scrollbar-hide flex min-w-0 items-center gap-0.5 self-stretch overflow-x-auto overflow-y-hidden px-px">
        {tabs.map((tab, index) => (
          <TabButton key={tab.id} tab={tab} label={labels.get(tab.id)!} active={tab.id === shown}
            divided={(index === 0 ? WORKSPACE_HOME_TAB : tabs[index - 1].id) !== shown}
            onSelect={() => useWorkspaceTabsStore.getState().activate(tab.id)}
            onClose={() => useWorkspaceTabsStore.getState().close(tab.id)} />
        ))}
      </div>
      {tabs.length >= TAB_MENU_THRESHOLD && <TabMenuButton count={tabs.length} />}
    </div>
  )
}
