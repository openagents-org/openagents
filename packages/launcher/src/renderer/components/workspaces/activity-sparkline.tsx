import React from "react"

import { cn } from "@renderer/lib/utils"

interface Props {
  /** One value per day, oldest first. */
  values: number[]
  /** Tailwind text colour class — the line and fill inherit it. */
  className?: string
}

// The viewBox is a fixed grid the path is computed in; the SVG itself scales to
// the card, so these are unitless and never need to match rendered pixels.
const W = 100
const H = 32
const PAD = 3

/**
 * Message volume over the last few days. A sparkline, not a chart: no axes, no
 * ticks, no tooltip — it answers "is this workspace busy, quiet, or dead?" at a
 * glance and hands the details to the workspace itself.
 */
export function ActivitySparkline({ values, className }: Props): React.JSX.Element {
  const max = Math.max(...values, 1)
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0
  const points = values.map((v, i) => {
    const x = PAD + i * step
    const y = H - PAD - (v / max) * (H - PAD * 2)
    return [x, y] as const
  })

  const line = points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
  // Close the path along the baseline so the area under the line can be filled.
  const area = `${line} ${(PAD + (values.length - 1) * step).toFixed(2)},${H - PAD} ${PAD},${H - PAD}`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn("h-10 w-full", className)}
      aria-hidden="true"
    >
      <polygon points={area} fill="currentColor" opacity={0.12} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.1} fill="currentColor" />
      ))}
    </svg>
  )
}
