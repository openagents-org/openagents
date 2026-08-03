import React from "react"

import { Card } from "@renderer/components/ui/card"
import { cn } from "@renderer/lib/utils"

interface SettingsCardProps {
  title?: string
  desc?: string
  /** Rendered on the right of the card title — a link-out, a refresh, etc. */
  action?: React.ReactNode
  children?: React.ReactNode
  /**
   * Sits below the rows and outside their `divide-y`, so a trailing button
   * group reads as belonging to the card rather than as one more row.
   */
  footer?: React.ReactNode
  className?: string
}

/**
 * One group of related settings. Rows are separated by the card itself
 * (`divide-y`) rather than by hand-placed separators, so a caller can add,
 * remove or conditionally render a row without also fixing up the hairlines
 * around it.
 *
 * Padding here (and in the rows below) is deliberately generous: a settings
 * module is read one line at a time, and the tighter spacing this replaced
 * turned four stacked cards into a wall of text.
 */
export function SettingsCard({
  title,
  desc,
  action,
  children,
  footer,
  className,
}: SettingsCardProps): React.JSX.Element {
  return (
    <Card className={cn("mb-5 gap-0 px-6 py-5", className)}>
      {(title || action) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 className="m-0 text-sm font-semibold">{title}</h3>}
            {desc && (
              <p className="mt-1 mb-0 text-2xs text-muted-foreground">
                {desc}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children && <div className="divide-y divide-border">{children}</div>}
      {footer && <div className="mt-4">{footer}</div>}
    </Card>
  )
}

interface RowProps {
  label: React.ReactNode
  desc?: React.ReactNode
  children?: React.ReactNode
  /**
   * Stack the control under the label. Use for wide inputs / long descriptions
   * where the side-by-side layout would crush the label column.
   */
  stacked?: boolean
  className?: string
}

/**
 * One setting. Plain <div>, not <label>: several rows wrap a Radix Select or a
 * button rather than a single native control, and a <label> around those
 * hijacks the click.
 */
export function Row({
  label,
  desc,
  children,
  stacked,
  className,
}: RowProps): React.JSX.Element {
  const text = (
    <div className="min-w-0">
      <div className="text-xs font-medium">{label}</div>
      {desc && (
        <div className="mt-0.5 text-2xs font-normal text-muted-foreground">
          {desc}
        </div>
      )}
    </div>
  )

  if (stacked) {
    return (
      <div className={cn("flex flex-col gap-3 py-4", className)}>
        {text}
        {children}
      </div>
    )
  }

  return (
    <div
      className={cn("flex items-center justify-between gap-6 py-4", className)}
    >
      {text}
      {children && <div className="shrink-0">{children}</div>}
    </div>
  )
}

interface InfoRowProps {
  label: React.ReactNode
  value?: React.ReactNode
  /** Secondary line under the value — a path, a hint, a raw number. */
  hint?: React.ReactNode
  /** Status chip or button pinned to the right of the value. */
  trailing?: React.ReactNode
  /** Monospace the value. For paths, versions and identifiers. */
  mono?: boolean
}

/** A read-only fact: version, path, capability, system property. */
export function InfoRow({
  label,
  value,
  hint,
  trailing,
  mono,
}: InfoRowProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        {hint && (
          <div className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
            {hint}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {value !== undefined && (
          <span className={cn("text-xs font-medium", mono && "font-mono")}>
            {value}
          </span>
        )}
        {trailing}
      </div>
    </div>
  )
}
