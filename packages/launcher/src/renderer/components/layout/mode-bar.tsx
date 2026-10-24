import React from "react"
import { ChevronRight, MessagesSquare, Monitor } from "lucide-react"
import { useTranslation } from "react-i18next"
import { LauncherUpdateBanner } from "@renderer/components/LauncherUpdateBanner"
import { BrandWordmark } from "@renderer/components/ui-kit"
import { useAccountStore } from "@renderer/store/account"
import { useWorkspaceTabsStore } from "@renderer/store/workspace-tabs"
import { cn } from "@renderer/lib/utils"
import { WorkspaceTabs } from "./workspace-tabs"
import { LocalNav } from "./local-nav"
import { TopSearch } from "./top-search"
import { AccountChip } from "./account-chip"
import { WORKSPACE_HOME_TAB } from "../../../shared/workspace-view"

const ModeTab = React.forwardRef<HTMLButtonElement, {
  active: boolean
  onClick: () => void
  icon: typeof Monitor
  label: string
  testId: string
  /** Set on Workspace while its side is showing: a click folds its tabs. */
  expanded?: boolean
  toggleLabel?: string
}>(function ModeTab({ active, onClick, icon: Icon, label, testId, expanded, toggleLabel }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active}
      aria-expanded={expanded}
      title={toggleLabel}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "titlebar-no-drag flex h-8 min-w-32 shrink-0 items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-colors",
        // Filled in the accent: these two decide everything below them, so
        // the side the window is on has to read at a glance.
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background hover:text-foreground",
      )}
    >
      <Icon className="size-4" />{label}
      {expanded !== undefined && (
        <ChevronRight className={cn("-mr-2 size-3.5 transition-transform", expanded && "rotate-180")} />
      )}
    </button>
  )
})

/** Tracks an element's rendered width; 0 until it is laid out. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.offsetWidth))
    observer.observe(el)
    setWidth(el.offsetWidth)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** The workspace group's padding and inner gap, plus a little slack, in px. */
const GROUP_CHROME = 16

/**
 * The window's top edge.
 *
 * The first row is the native title bar, read left to right: the product, then
 * the two halves of the window — This Computer, for the device the agents run
 * on; Workspace, for working with people and agents — and what belongs to the
 * half that is showing. On the Workspace side that is its tabs, All Workspaces
 * first, held in one box with the Workspace button: they are pages of that
 * side, and laid out beside the switch they read as its peers. Workspace comes
 * second so its group can grow to the right without moving This Computer. A
 * click on Workspace while it is showing folds the tabs away and another brings
 * them back; they start out open and only fold when asked to. On This Computer
 * the row ends with the way into search, with theme and notifications in the
 * status footer. It is the window's drag handle and carries the OS buttons'
 * clearance on whichever side they are drawn.
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
  const [tabsOpen, setTabsOpen] = React.useState(true)
  const showTabs = !local && !!account

  // The tabs get the room right of This Computer, less the Workspace button;
  // the group itself is only as wide as its contents, so it cannot be measured.
  const [rowRef, rowWidth] = useWidth<HTMLDivElement>()
  const [workspaceRef, workspaceWidth] = useWidth<HTMLButtonElement>()
  const tabsBudget = Math.max(0, rowWidth - workspaceWidth - GROUP_CHROME)

  const onWorkspace = (): void => {
    if (local) useAccountStore.getState().enterWorkspaceMode()
    else if (account) setTabsOpen((open) => !open)
  }

  return (
    <header className="relative z-20 shrink-0 border-b bg-background">
      <div className="titlebar-drag flex h-(--mode-bar-h) items-center gap-4 pr-(--window-controls-w) pl-(--traffic-lights-w)">
        <div className="flex shrink-0 items-center pl-4">
          <BrandWordmark className="h-6" />
        </div>
        <div role="tablist" aria-label={t("nav.modeSwitch")} className="flex min-w-0 flex-1 items-center gap-2 self-stretch">
          <div className="flex shrink-0 items-center rounded-lg bg-muted p-1">
            <ModeTab active={local} onClick={() => useAccountStore.getState().exitWorkspace()}
              icon={Monitor} label={t("nav.modeLauncher")} testId="mode-launcher" />
          </div>
          {/* Everything right of This Computer is the Workspace group's to grow
              into, so opening, closing or folding tabs moves nothing else. */}
          <div ref={rowRef} className="flex min-w-0 flex-1 items-center self-stretch">
            <div className="flex min-w-0 items-center gap-1 rounded-lg bg-muted p-1">
              <ModeTab ref={workspaceRef} active={!local} onClick={onWorkspace}
                icon={MessagesSquare} label={t("nav.modeWorkspace")} testId="mode-workspace"
                expanded={showTabs ? tabsOpen : undefined}
                toggleLabel={showTabs ? t(tabsOpen ? "workspaceTabs.collapse" : "workspaceTabs.expand") : undefined} />
              {/* Folded, not unmounted: the strip also carries the tab shortcuts. */}
              {showTabs && (
                <div className={cn("min-w-0 items-center", tabsOpen ? "flex" : "hidden")}>
                  <WorkspaceTabs budget={tabsBudget} />
                </div>
              )}
            </div>
            {local && (
              <div className="flex min-w-0 flex-1 items-center justify-end pr-4">
                <div className="titlebar-no-drag flex items-center">
                  <TopSearch />
                </div>
              </div>
            )}
          </div>
        </div>
        {!local && (
          // Popovers from here would open under the Workspace's native view,
          // so this side keeps only what cannot wait: the update notice, and on
          // All Workspaces the account, whose page drops its own header here.
          <div className="flex shrink-0 items-center justify-end gap-3 pr-4">
            <div className="titlebar-no-drag flex shrink-0 justify-center">
              <LauncherUpdateBanner inline />
            </div>
            {onHome && <AccountChip />}
          </div>
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
