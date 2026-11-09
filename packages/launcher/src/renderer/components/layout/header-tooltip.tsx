import React from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@renderer/components/ui/tooltip"

/**
 * The name of an icon-only button in the header, shown under it on hover —
 * at once, unlike a `title`, which the OS shows after a second or so and
 * which read as no hint at all. `children` must forward its ref and props
 * (a Button, or a Radix trigger rendered `asChild`).
 */
export function HeaderTooltip({ label, children }: {
  label: string
  children: React.ReactElement
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
