import React from "react"
import { AlertCircle, ChevronDown, Grid2X2, MessagesSquare, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Spinner } from "@renderer/components/ui/spinner"
import { useAccountStore } from "@renderer/store/account"
import { useWorkspaceTabsStore } from "@renderer/store/workspace-tabs"
import { cn } from "@renderer/lib/utils"
import {
  shortcutTab,
  visibleTabs,
  WORKSPACE_HOME_TAB,
  type WorkspaceTab,
} from "../../../shared/workspace-view"

type DragHandlers = Pick<React.HTMLAttributes<HTMLDivElement>, "onDragStart" | "onDragOver" | "onDragEnd" | "onDrop">

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
 * Tab chrome, shared by the workspace tabs and All Workspaces. They sit in the
 * Workspace button's box, so the active tab is a raised page in the accent
 * text — a quieter version of the filled switch beside it — and the two read
 * as one hierarchy: which half, then which page in it. Inactive tabs stay flat
 * until hovered.
 */
function tabClass(active: boolean): string {
  return cn(
    "group relative flex h-8 items-center gap-2 rounded-md text-sm transition-colors",
    active
      ? "bg-background font-medium text-primary shadow-sm"
      : "text-muted-foreground hover:bg-background/70 hover:text-foreground",
  )
}

function TabStatus({ state }: { state: WorkspaceTab["state"] }): React.JSX.Element {
  if (state === "loading") return <Spinner className="size-3.5 shrink-0" />
  if (state === "failed") return <AlertCircle className="size-3.5 shrink-0 text-destructive" />
  return <MessagesSquare className="size-4 shrink-0" />
}

/** All Workspaces, pinned first: a tab like the others, but never closed or moved. */
const HomeTab = React.forwardRef<HTMLButtonElement, { active: boolean }>(function HomeTab({ active }, ref) {
  const { t } = useTranslation()
  return (
    <button ref={ref} type="button" role="tab" aria-selected={active} data-testid="all-workspaces"
      onClick={() => useAccountStore.getState().openWorkspaces()}
      className={cn(tabClass(active), "titlebar-no-drag shrink-0 px-3")}>
      <Grid2X2 className="size-4 shrink-0" />
      {t("account.workspaces.title")}
    </button>
  )
})

function TabButton({ tab, label, active, dragging, onSelect, onClose, drag }: {
  tab: WorkspaceTab
  label: { title: string; hint: string | null }
  active: boolean
  dragging: boolean
  onSelect: () => void
  onClose: () => void
  drag: DragHandlers
}): React.JSX.Element {
  const { t } = useTranslation()
  // A native tooltip rather than the launcher's: anything drawn below this bar
  // would land under the Workspace view and never be seen.
  const full = label.hint ? `${label.title} (${label.hint})` : label.title
  return (
    <div
      draggable
      {...drag}
      // Tabs shrink together down to their minimum; past five, the rest wait
      // in the menu instead of scrolling the strip.
      className={cn(tabClass(active), "w-44 min-w-28 shrink cursor-default pr-1.5 pl-3", dragging && "opacity-40")}
      // The whole tab selects, padding included; the close button stops that.
      onClick={onSelect}
      onContextMenu={(e) => { e.preventDefault(); void window.api.showWorkspaceTabContextMenu(tab.id) }}
      // Middle click closes, as in a browser.
      onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose() } }}
    >
      <button type="button" role="tab" aria-selected={active} title={full}
        data-testid="workspace-tab" className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left">
        <TabStatus state={tab.state} />
        <span className="truncate">{label.title}</span>
        {label.hint && <span className="shrink-0 font-normal text-muted-foreground">{label.hint}</span>}
      </button>
      {/* Shown on the active tab and on hover only, as a browser does: a cross
          on every tab made the strip read as a row of delete buttons. */}
      <button type="button" aria-label={t("workspaceTabs.close", { name: full })} title={t("workspaceTabs.close", { name: full })}
        onClick={(e) => { e.stopPropagation(); onClose() }}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-foreground/10 focus-visible:opacity-100",
          active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/**
 * The tabs past the fifth, and every other one with its shortcut, as an OS
 * menu — see workspace-tab-menu.ts for why it is native.
 */
function TabMenuButton({ hidden }: { hidden: number }): React.JSX.Element {
  const { t } = useTranslation()
  const label = t("workspaceTabs.more", { count: hidden })
  return (
    <button type="button" aria-label={label} title={label} data-testid="workspace-tab-menu"
      className="titlebar-no-drag flex h-8 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
      onClick={(e) => {
        const { left, bottom } = e.currentTarget.getBoundingClientRect()
        void window.api.showWorkspaceTabMenu({ x: left, y: bottom })
      }}>
      +{hidden}
      <ChevronDown className="size-3.5" />
    </button>
  )
}

/**
 * Drag a tab along the strip to reorder it, as in a browser: the order follows
 * the pointer while dragging and is handed to main on release.
 */
function useTabDrag(tabs: WorkspaceTab[]): {
  order: WorkspaceTab[]
  dragged: string | null
  handlers: (id: string) => DragHandlers
} {
  const [dragged, setDragged] = React.useState<string | null>(null)
  const [order, setOrder] = React.useState<string[] | null>(null)

  const shown = order
    ? order.map((id) => tabs.find((tab) => tab.id === id)).filter((tab): tab is WorkspaceTab => !!tab)
    : tabs

  const finish = (): void => {
    if (dragged && order) {
      const to = order.indexOf(dragged)
      if (to >= 0 && to !== tabs.findIndex((tab) => tab.id === dragged)) useWorkspaceTabsStore.getState().move(dragged, to)
    }
    setDragged(null)
    setOrder(null)
  }

  const handlers = (id: string): DragHandlers => ({
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/plain", id)
      setDragged(id)
      setOrder(tabs.map((tab) => tab.id))
    },
    onDragOver: (e) => {
      if (!dragged || !order) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      if (id === dragged) return
      const from = order.indexOf(dragged)
      const to = order.indexOf(id)
      if (from < 0 || to < 0) return
      const next = [...order]
      next.splice(from, 1)
      next.splice(to, 0, dragged)
      setOrder(next)
    },
    onDrop: (e) => { e.preventDefault(); finish() },
    onDragEnd: finish,
  })

  return { order: shown, dragged, handlers }
}

/** A tab at its narrowest (min-w-28) plus the gap after it, and the "+N" button. */
const TAB_SLOT = 116
const MENU_SLOT = 64
/** The divider after All Workspaces, with its margins and the gaps around it. */
const DIVIDER_SLOT = 14

/**
 * How many tabs fit in `width`. Five is the most the strip shows; a narrower
 * window shows fewer rather than letting tabs spill over what sits to their
 * right.
 */
function tabsThatFit(width: number, total: number): number {
  const fit = Math.floor(width / TAB_SLOT)
  return Math.max(0, total > fit ? Math.floor((width - MENU_SLOT) / TAB_SLOT) : fit)
}

/**
 * All Workspaces and the open workspaces, one tab each, at most five of the
 * latter at a time. Closing a tab closes its page only — the workspace, this
 * device's connection to it and its agents carry on.
 *
 * `budget` is the room the mode bar has for all of this. The strip is only as
 * wide as its tabs, so it cannot measure its own room: how many it holds would
 * then depend on how many it holds.
 */
export function WorkspaceTabs({ budget }: { budget: number }): React.JSX.Element {
  const { t } = useTranslation()
  const tabs = useWorkspaceTabsStore((s) => s.tabs)
  const shown = useWorkspaceTabsStore((s) => s.active)
  const labels = React.useMemo(() => labelsFor(tabs), [tabs])
  const { order, dragged, handlers } = useTabDrag(tabs)
  const homeRef = React.useRef<HTMLButtonElement>(null)
  const [homeWidth, setHomeWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = homeRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setHomeWidth(el.offsetWidth))
    observer.observe(el)
    setHomeWidth(el.offsetWidth)
    return () => observer.disconnect()
  }, [])
  const stripWidth = Math.max(0, budget - homeWidth - DIVIDER_SLOT)
  const fit = tabsThatFit(stripWidth, tabs.length)
  const visible = visibleTabs(order, shown, fit)

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
    <div role="tablist" aria-label={t("workspaceTabs.label")} className="flex min-w-0 items-center gap-1">
      <HomeTab ref={homeRef} active={shown === WORKSPACE_HOME_TAB} />
      {tabs.length > 0 && <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />}
      {/* Capped at the room the bar has left, so the tabs shrink to share it
          down to their minimum; past that the rest go into the "+N" menu. */}
      <div className="flex min-w-0 items-center gap-1" style={{ maxWidth: stripWidth }}>
        <div className="titlebar-no-drag flex min-w-0 items-center gap-1 overflow-hidden">
          {visible.map((tab) => (
            <TabButton key={tab.id} tab={tab} label={labels.get(tab.id)!} active={tab.id === shown}
              dragging={tab.id === dragged} drag={handlers(tab.id)}
              onSelect={() => useWorkspaceTabsStore.getState().activate(tab.id)}
              onClose={() => useWorkspaceTabsStore.getState().close(tab.id)} />
          ))}
        </div>
        {tabs.length > visible.length && <TabMenuButton hidden={tabs.length - visible.length} />}
      </div>
    </div>
  )
}
