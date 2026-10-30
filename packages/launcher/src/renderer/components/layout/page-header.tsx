import React from "react"

import { cn } from "@renderer/lib/utils"

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Rendered on the right of the header. */
  actions?: React.ReactNode
  /** Kept for callers; the subtitle now always sits on its own line. */
  stacked?: boolean
  className?: string
}

// Search is not a page-level control — the ⌘K box lives in the top bar (see
// `top-search.tsx`) so every screen reaches the palette the same way.
//
// No rule under it: the page title is set large enough to head the page by
// itself, and the content below opens with its own section.
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn(
        "flex shrink-0 items-start justify-between gap-4 px-9 pt-7 pb-1",
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="m-0 truncate text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-1">{actions}</div>
    </header>
  )
}
