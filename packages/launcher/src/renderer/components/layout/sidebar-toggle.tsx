import React from "react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Kbd } from "@renderer/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip"
import { useSidebar } from "@renderer/components/ui/sidebar"
import { cn } from "@renderer/lib/utils"

/**
 * `SidebarProvider` binds meta *and* ctrl, so each platform is shown the one it
 * would actually reach for. Read once, like `REGISTRY_PLATFORM` — preload hands
 * `platform` over as a value, not a call.
 */
const SHORTCUT = window.api?.platform === "darwin" ? "⌘B" : "Ctrl B"

/**
 * The rail's collapse control.
 *
 * A button, because until now there was none: collapsing meant finding a 2px
 * seam at the edge of the rail, and the reports were exactly what that
 * predicts — people did not know the rail collapsed at all. The seam and the
 * shortcut still work; this is the part that says so.
 *
 * Full contrast, like the bell beside it, and the icon points the way the rail
 * is about to move rather than naming the panel — so it reads as a control at
 * rest, before anyone hovers it.
 */
export function SidebarToggle({
  className,
}: {
  className?: string
}): React.JSX.Element {
  const { state, toggleSidebar } = useSidebar()
  const { t } = useTranslation()

  const collapsed = state === "collapsed"
  const label = collapsed ? t("nav.expandSidebar") : t("nav.collapseSidebar")
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={label}
          data-testid="sidebar-toggle"
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            className,
          )}
        >
          <Icon className="size-4" />
        </button>
      </TooltipTrigger>
      {/* To the right in both states: expanded, the button sits on the rail's
          own right edge, so anywhere else would cover the header it belongs to.
          The shortcut rides along — this is where someone looks when they want
          the rail out of the way, and it is the only place it is advertised. */}
      <TooltipContent side="right" className="flex items-center gap-2">
        {label}
        {/* Kbd already dresses itself for a tooltip background. */}
        <Kbd>{SHORTCUT}</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}
