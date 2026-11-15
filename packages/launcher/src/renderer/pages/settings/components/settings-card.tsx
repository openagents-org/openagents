import React from "react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card"
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
  const header = !!(title || desc || action)
  return (
    <Card className={cn("mb-6 gap-0 py-0", className)}>
      {header && (
        <CardHeader className="border-b py-(--card-spacing)">
          {title && <CardTitle>{title}</CardTitle>}
          {desc && <CardDescription>{desc}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      {children && <CardContent className="flex flex-col divide-y">{children}</CardContent>}
      {footer && <CardFooter>{footer}</CardFooter>}
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
      <div className="text-sm font-medium">{label}</div>
      {desc && (
        <div className="mt-0.5 text-xs font-normal text-muted-foreground">
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
          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
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
