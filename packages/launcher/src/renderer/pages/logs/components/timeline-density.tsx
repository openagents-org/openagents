import React, { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"
import { formatClock, type TimeBucket, type TimeSpan } from "@renderer/services/logs/log-metrics"

interface Props {
  buckets: TimeBucket[]
  span: TimeSpan
  brush: TimeSpan | null
  onBrushChange: (next: TimeSpan | null) => void
}

const AXIS_TICKS = 6

/** Ratio (0–1) of a pointer position inside the plot area. */
function ratioAt(el: HTMLElement, clientX: number): number {
  const rect = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
}

function pct(value: number, span: TimeSpan): number {
  const width = span.end - span.start || 1
  return ((value - span.start) / width) * 100
}

/**
 * Stacked event-density chart. Dragging across it brushes a time window that
 * the rest of the page filters on; a plain click clears the selection.
 */
export function TimelineDensity({
  buckets,
  span,
  brush,
  onBrushChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const plotRef = useRef<HTMLDivElement>(null)
  const dragStart = useRef<number | null>(null)
  const [draft, setDraft] = useState<TimeSpan | null>(null)

  const max = Math.max(...buckets.map((b) => b.total), 1)
  const toTime = (ratio: number): number =>
    span.start + ratio * (span.end - span.start)

  const selection = draft || brush

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!plotRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = toTime(ratioAt(plotRef.current, e.clientX))
    setDraft(null)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (dragStart.current === null || !plotRef.current) return
    const current = toTime(ratioAt(plotRef.current, e.clientX))
    const start = Math.min(dragStart.current, current)
    const end = Math.max(dragStart.current, current)
    setDraft(end - start > 1000 ? { start, end } : null)
  }

  const onPointerUp = (): void => {
    dragStart.current = null
    // A click without a meaningful drag reads as "clear the selection".
    onBrushChange(draft)
    setDraft(null)
  }

  const ticks = Array.from({ length: AXIS_TICKS }, (_, i) => {
    const ratio = i / (AXIS_TICKS - 1)
    return { ratio, label: formatClock(toTime(ratio)) }
  })

  return (
    <div className="px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-2xs font-medium text-muted-foreground">
          {t("logs.timeline.density")}
        </span>
        {brush && (
          <button
            type="button"
            onClick={() => onBrushChange(null)}
            className="border-0 bg-transparent p-0 text-2xs text-primary"
          >
            {t("logs.timeline.clearBrush")}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <div className="flex w-8 shrink-0 flex-col justify-between py-0.5 text-right text-3xs text-muted-foreground">
          <span>{max}</span>
          <span>{Math.round(max / 2)}</span>
          <span>0</span>
        </div>

        <div className="min-w-0 flex-1">
          <div
            ref={plotRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="relative flex h-24 cursor-crosshair touch-none items-end gap-px border-b"
          >
            {buckets.map((b) => (
              <div
                key={b.start}
                title={t("logs.timeline.bucketTooltip", {
                  time: formatClock(b.start),
                  total: b.total,
                  error: b.error,
                })}
                className="flex h-full min-w-0 flex-1 flex-col justify-end"
              >
                <div
                  className="w-full bg-(--danger)"
                  style={{ height: `${(b.error / max) * 100}%` }}
                />
                <div
                  className="w-full bg-(--warning)"
                  style={{ height: `${(b.warn / max) * 100}%` }}
                />
                <div
                  className="w-full bg-primary/70"
                  style={{ height: `${(b.info / max) * 100}%` }}
                />
              </div>
            ))}

            {selection && (
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 border-x border-primary bg-primary/10",
                  !draft && "bg-primary/15",
                )}
                style={{
                  left: `${pct(selection.start, span)}%`,
                  width: `${pct(selection.end, span) - pct(selection.start, span)}%`,
                }}
              >
                <span className="absolute -top-1 -left-px -translate-x-1/2 rounded-sm bg-primary px-1 text-3xs text-primary-foreground">
                  {formatClock(selection.start)}
                </span>
                <span className="absolute -top-1 -right-px translate-x-1/2 rounded-sm bg-primary px-1 text-3xs text-primary-foreground">
                  {formatClock(selection.end)}
                </span>
              </div>
            )}
          </div>

          <div className="relative mt-1 h-3">
            {ticks.map((tick, i) => (
              <span
                key={tick.ratio}
                className={cn(
                  "absolute text-3xs text-muted-foreground",
                  // Keep the edge labels inside the plot instead of clipping.
                  i === 0
                    ? "translate-x-0"
                    : i === ticks.length - 1
                      ? "-translate-x-full"
                      : "-translate-x-1/2",
                )}
                style={{ left: `${tick.ratio * 100}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
