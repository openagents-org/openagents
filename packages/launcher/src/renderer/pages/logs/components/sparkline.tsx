import React from "react"

import { cn } from "@renderer/lib/utils"

interface Props {
  values: number[]
  /** Draw the filled area under the line. */
  area?: boolean
  className?: string
}

const W = 100
const H = 32
const PAD = 2

/**
 * Inline trend line. Colour comes from `currentColor`, so the caller sets the
 * tone with a text-* class and the line, area and dot all follow.
 */
export function Sparkline({ values, area = true, className }: Props): React.JSX.Element {
  const points = values.length > 1 ? values : [...values, ...values, 0]
  const max = Math.max(...points, 1)
  const step = W / (points.length - 1)

  const coords = points.map((v, i) => {
    const x = i * step
    const y = H - PAD - (v / max) * (H - PAD * 2)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const line = `M${coords.join(" L")}`
  const shape = `${line} L${W},${H} L0,${H} Z`

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={cn("h-8 w-full", className)}
    >
      {area && <path d={shape} className="fill-current opacity-10" />}
      <path
        d={line}
        fill="none"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="stroke-current"
      />
    </svg>
  )
}
