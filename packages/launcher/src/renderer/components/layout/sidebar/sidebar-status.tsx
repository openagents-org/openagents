import React from "react"
import { Monitor } from "lucide-react"

import { StatusDot } from "@renderer/components/ui-kit"
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@renderer/components/ui/sidebar"
import { useUiStore } from "@renderer/store/ui"
import { useDeviceReadout } from "../use-device-readout"

/**
 * This computer's state at the bottom of the sidebar — what its agents are
 * doing and the app version, the line that used to run along the bottom of the
 * window. Its name is at the top, under the app's, so it is not repeated here.
 * The state is the agents', so a click opens Connect Agents.
 *
 * In the icon rail only the computer is left, its state as the dot on it, and
 * the whole line in the tooltip.
 */
export function SidebarStatus(): React.JSX.Element {
  const { hostname, status, statusLabel, version } = useDeviceReadout()
  const summary = [hostname, statusLabel, version].filter(Boolean).join(" · ")
  return (
    <SidebarFooter data-testid="status-footer">
      <SidebarMenu className="group-data-[collapsible=icon]:items-center">
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" tooltip={summary} aria-label={summary}
            onClick={() => useUiStore.getState().setCurrentTab("dashboard")}>
            <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background">
              <Monitor className="size-4" />
              {/* Inside the tile's corner: the button clips what hangs past its
                  edge, and in the rail the tile is the whole button. */}
              <StatusDot state={status} className="absolute right-0.5 bottom-0.5 ring-2 ring-background" />
            </span>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-medium">{statusLabel}</span>
              <span className="truncate font-mono text-xs text-muted-foreground">{version}</span>
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
