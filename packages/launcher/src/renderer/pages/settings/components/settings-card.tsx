import React from "react"

import { Card } from "@renderer/components/shadcn/card"

export function SettingsCard({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Card className="mb-4 gap-3 px-5 py-4">
      <h3 className="m-0 text-base font-semibold tracking-tight">{title}</h3>
      <div className="flex flex-col">{children}</div>
    </Card>
  )
}

interface RowProps {
  label: string
  desc?: string
  children: React.ReactNode
  /**
   * Stack label above the control. Use for wide inputs / long descriptions
   * where the side-by-side layout would crush the label column.
   */
  stacked?: boolean
}

/**
 * One setting. Plain <div>, not <label>: several rows wrap a Radix Select or a
 * button rather than a single native control, and a <label> around those
 * hijacks the click.
 */
export function Row({ label, desc, children, stacked }: RowProps): React.JSX.Element {
  const text = (
    <div className="min-w-0">
      <span className="text-sm font-medium">{label}</span>
      {desc && (
        <span className="mt-0.5 block text-2xs font-normal text-muted-foreground">
          {desc}
        </span>
      )}
    </div>
  )

  if (stacked) {
    return (
      <div className="flex flex-col gap-2 py-2.5">
        {text}
        <div className="w-full">{children}</div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      {text}
      <div className="shrink-0">{children}</div>
    </div>
  )
}
