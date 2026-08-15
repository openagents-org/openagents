import * as React from "react"

import { cn } from "@renderer/lib/utils"

/**
 * The row above a list: search, filter chips, sort, and whatever action the
 * page keeps next to them (refresh, a view switch).
 *
 * Every list page grew its own version of this — one row here, two rows there,
 * `mb-4` on one page and `mb-5` on the next, `size="sm"` controls on one and
 * default heights on another. Side by side the pages looked like different
 * apps. The layout lives here now; pages supply the controls in order and
 * nothing else.
 *
 * Wraps rather than scrolls: the window is 1200px at its narrowest, which fits
 * these controls, but a long filter set at a large text size should fold onto a
 * second line instead of pushing the sort control off the edge.
 */
export function PageToolbar({
  className,
  ...props
}: React.ComponentProps<"div">): React.JSX.Element {
  return (
    <div
      data-slot="page-toolbar"
      className={cn("mb-5 flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  )
}
