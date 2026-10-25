import React from "react"

import { useThemeStore } from "@renderer/store/theme"
import { cn } from "@renderer/lib/utils"
import logoLight from "@renderer/assets/brand/openagents-logo-light.png"
import logoDark from "@renderer/assets/brand/openagents-logo-dark.png"

/**
 * The full OpenAgents wordmark — colour mark plus lettering — on a
 * transparent ground. One component so the title bar and the welcome page
 * cannot drift onto different artwork. The dark cut sets the lettering in
 * white; both keep the brand gradient.
 */
export function BrandWordmark({
  className,
}: {
  /** Size it by height (`h-*`); the width follows the 936×153 artwork. */
  className?: string
}): React.JSX.Element {
  const theme = useThemeStore((s) => s.resolved)
  return (
    <img
      src={theme === "dark" ? logoDark : logoLight}
      width={936}
      height={153}
      alt="OpenAgents"
      draggable={false}
      className={cn("block w-auto shrink-0 select-none", className)}
    />
  )
}
