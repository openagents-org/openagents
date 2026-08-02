import React from "react"

import { cn } from "@renderer/lib/utils"

interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  /** Rendered on the right of the header. */
  actions?: React.ReactNode
  className?: string
}

// Search is not a page-level control — the ⌘K box lives at the top of the rail
// (see `sidebar-search.tsx`) so every screen reaches the palette the same way.
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: PageHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between gap-4 border-b px-9 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <h1 className="m-0 truncate text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && (
          <span className="truncate text-sm text-muted-foreground">{subtitle}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">{actions}</div>
    </header>
  )
}
