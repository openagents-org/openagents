import React from "react"
import { LauncherUpdateBanner } from "@renderer/components/LauncherUpdateBanner"
import { useAccountStore } from "@renderer/store/account"
import { useWorkspaceTabsStore } from "@renderer/store/workspace-tabs"
import { WORKSPACE_HOME_TAB } from "../../../shared/workspace-view"
import { AccountChip } from "./account-chip"
import { ModeSwitch } from "./mode-switch"
import { WorkspaceTabs } from "./workspace-tabs"

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

/**
 * The Workspace side's top edge, in place of This Computer's sidebar: the
 * switch between the two sides — the same control, in the same spot, as at the
 * top of This Computer's sidebar — then the workspace tabs, All Workspaces
 * first, like a browser's. The web app it shows has a sidebar of its own, so the window
 * gives it the full width rather than a second sidebar beside it.
 *
 * It is the window's title bar: it drags the window and clears the OS buttons
 * on whichever side they are drawn. Nothing here pops out over the page — the
 * workspace is a native view drawn above the launcher's DOM — so the tab
 * overflow and context menus are native menus, and the account on All
 * Workspaces is plain buttons.
 */
export function WorkspaceBar(): React.JSX.Element {
  const signedIn = useAccountStore((s) => !!s.account)
  const onHome = useWorkspaceTabsStore((s) => s.active === WORKSPACE_HOME_TAB)
  // The strip is only as wide as its tabs, so the room it may use is measured
  // on the row that holds it.
  const [rowRef, rowWidth] = useWidth<HTMLDivElement>()

  return (
    <header className="titlebar-drag flex h-(--mode-bar-h) shrink-0 items-center gap-3 border-b bg-background pr-(--window-controls-w) pl-(--traffic-lights-w)">
      {/* pl-2 after the lights, as the sidebar's row has, so the switch lands
          on the same pixels on both sides. */}
      <div className="flex min-w-0 flex-1 items-center gap-3 pl-2">
        <ModeSwitch />
        <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
        <div ref={rowRef} className="flex min-w-0 flex-1 items-center">
          {signedIn && <WorkspaceTabs budget={rowWidth} />}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3 pr-3">
        <div className="titlebar-no-drag flex shrink-0 justify-center">
          <LauncherUpdateBanner inline />
        </div>
        {onHome && <AccountChip />}
      </div>
    </header>
  )
}
