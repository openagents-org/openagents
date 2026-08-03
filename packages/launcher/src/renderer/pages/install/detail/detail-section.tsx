import React from "react"

import { Card } from "@renderer/components/ui/card"
import { cn } from "@renderer/lib/utils"

interface SectionProps {
  title: React.ReactNode
  /** Rendered at the right of the section heading. */
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * One block of the detail page's main column. Blocks are separated by a
 * hairline rather than each sitting in its own card: the page is one document
 * about one agent, and a stack of cards fragmented it into unrelated panels.
 */
export function DetailSection({
  title,
  action,
  className,
  children,
}: SectionProps): React.JSX.Element {
  return (
    <section className={cn("border-t pt-6 first:border-t-0 first:pt-0", className)}>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <h3 className="m-0 text-base font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** Boxed panel for the right rail, where cards *are* the right metaphor. */
export function RailCard({
  title,
  className,
  children,
}: {
  title?: React.ReactNode
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Card className={cn("gap-3 px-4 py-4", className)}>
      {title && (
        <div className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
          {title}
        </div>
      )}
      {children}
    </Card>
  )
}

/** Label on the left, value on the right — the rail's only row shape. */
export function RailRow({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  )
}
