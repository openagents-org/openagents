import React from "react"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@renderer/components/ui-kit"
import { SidebarHeader, useSidebar } from "@renderer/components/ui/sidebar"
import { useSidebarStore } from "@renderer/store/sidebar"
import { useThemeStore } from "@renderer/store/theme"
import { useDeviceReadout } from "../use-device-readout"
import { ModeSwitch } from "../mode-switch"

/**
 * The top of the sidebar: the title-bar row, with the switch between This
 * Computer and the Workspace after the macOS traffic lights — the very spot
 * the Workspace side's tab bar puts the same switch, so it does not move when
 * the side does. In the icon rail the lights take the row, and the switch
 * stacks under them as two icons. It is window chrome, so it drags the window.
 *
 * Under it, the app and which computer this is — the row shadcn's sidebar uses
 * for its team switcher. Hidden in the icon rail, where the mark alone would
 * sit below the two switch icons as a third, unlabelled one.
 */
export function SidebarBrand(): React.JSX.Element {
  const { t } = useTranslation()
  // The mark sits on a tile of the primary colour, so it takes the opposite
  // cut-out: white on the light theme's near-black, black on the dark one's.
  const dark = useThemeStore((s) => s.resolved === "dark")
  const { hostname } = useDeviceReadout()
  // The switch's width at its full labels, for AppFrame to size the sidebar to
  // — measured only while expanded: in the rail the pair stack and narrow.
  const { state } = useSidebar()
  const switchRef = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const el = switchRef.current
    if (!el || state !== "expanded") return
    const sync = (): void => useSidebarStore.getState().setSwitchWidth(Math.ceil(el.offsetWidth))
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    sync()
    return () => observer.disconnect()
  }, [state])
  return (
    <>
      <div className="sidebar-drag flex h-(--mode-bar-h) shrink-0 items-center pl-(--traffic-lights-w) group-data-[collapsible=icon]:h-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:pt-(--traffic-lights-h) group-data-[collapsible=icon]:pb-2 group-data-[collapsible=icon]:pl-0">
        <div className="pl-2 group-data-[collapsible=icon]:pl-0">
          <ModeSwitch inSidebar ref={switchRef} />
        </div>
      </div>
      <SidebarHeader className="sidebar-drag group-data-[collapsible=icon]:hidden">
        <div className="flex h-12 items-center gap-2 px-2">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary">
            <BrandMark variant={dark ? "black" : "white"} className="size-5" />
          </span>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-sm font-semibold">{t("common.appName")}</span>
            <span className="truncate text-xs text-muted-foreground">{hostname || t("agents.shared.thisComputer")}</span>
          </span>
        </div>
      </SidebarHeader>
    </>
  )
}
