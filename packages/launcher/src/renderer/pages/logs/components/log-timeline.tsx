import React, { useEffect, useRef, useState } from "react"
import { Clock, Copy, Minus, Plus, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import {
  formatClock,
  type AgentLane,
  type Incident,
  type TimeBucket,
  type TimeSpan,
} from "@renderer/services/logs/log-metrics"
import type { ParsedLog } from "@renderer/services/logs/log-parser"
import { TimelineDensity } from "./timeline-density"
import { TimelineLanes } from "./timeline-lanes"

/**
 * 100% is the floor because the track is stretched to the container: the zoom
 * sets `min-width`, so anything under 100% renders identically to 100% and a
 * "75%" readout would be a lie. Zooming only ever spreads the lanes out.
 */
const ZOOM_STEPS = [100, 150, 200, 300, 400]

interface Props {
  buckets: TimeBucket[]
  lanes: AgentLane[]
  incidents: Incident[]
  span: TimeSpan
  brush: TimeSpan | null
  onBrushChange: (next: TimeSpan | null) => void
  now: number
  onOpenEntry: (entry: ParsedLog) => void
  onCopyDetail: (entry: ParsedLog) => void
}

const LEGEND = [
  { key: "error", dot: "bg-(--danger)" },
  { key: "warn", dot: "bg-(--warning)" },
  { key: "info", dot: "bg-primary/70" },
] as const

export function LogTimeline({
  buckets,
  lanes,
  incidents,
  span,
  brush,
  onBrushChange,
  now,
  onOpenEntry,
  onCopyDetail,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(100)
  const [selected, setSelected] = useState<ParsedLog | null>(null)

  const stepZoom = (dir: 1 | -1): void => {
    const idx = ZOOM_STEPS.indexOf(zoom)
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + dir))]
    setZoom(next)
  }

  // "Back to now" scrolls the track to its right edge, which only means
  // anything while the track is wider than its viewport — at 100% zoom there
  // is nothing to scroll and the button did nothing at all. Measure instead of
  // assuming: lane label columns can overflow on their own.
  const [scrollable, setScrollable] = useState(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setScrollable(el.scrollWidth > el.clientWidth + 1)
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [zoom, lanes, span])

  const scrollToNow = (): void => {
    const el = scrollRef.current
    if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth: `${zoom}%` }}>
          <TimelineDensity
            buckets={buckets}
            span={span}
            brush={brush}
            onBrushChange={onBrushChange}
          />
          <TimelineLanes
            lanes={lanes}
            span={span}
            incidents={incidents}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
            now={now}
          />
        </div>
      </div>

      {selected && (
        <div className="absolute right-4 bottom-16 z-20 w-72 rounded-lg border bg-popover p-3 shadow-lg">
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "mt-0.5 size-2 shrink-0 rounded-full",
                selected.level === "error"
                  ? "bg-(--danger)"
                  : selected.level === "warn"
                    ? "bg-(--warning)"
                    : "bg-primary",
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-xs font-semibold wrap-break-word">
                {selected.message}
              </p>
              <p className="mt-1 mb-0 text-2xs text-muted-foreground">
                {selected.agent || selected.scope || "—"} ·{" "}
                {formatClock(selected.time, true)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelected(null)}
              aria-label={t("logs.timeline.closeCard")}
              className="cursor-pointer border-0 bg-transparent p-0 text-muted-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="mt-2.5 flex gap-2">
            <Button size="xs" variant="outline" onClick={() => onOpenEntry(selected)}>
              {t("logs.timeline.openInList")}
            </Button>
            <Button size="xs" variant="outline" onClick={() => onCopyDetail(selected)}>
              <Copy />
              {t("logs.actions.copy")}
            </Button>
          </div>
        </div>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-4 border-t px-4 py-2.5">
        {LEGEND.map((item) => (
          <span
            key={item.key}
            className="flex items-center gap-1.5 text-2xs text-muted-foreground"
          >
            <span className={cn("size-2 rounded-full", item.dot)} />
            {t(`logs.levels.${item.key}`)}
          </span>
        ))}

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => stepZoom(-1)}
            disabled={zoom === ZOOM_STEPS[0]}
            title={t("logs.timeline.zoomOut")}
            aria-label={t("logs.timeline.zoomOut")}
          >
            <Minus />
          </Button>
          {/* Named, not numbered, at the floor: "100%" invited the user to
              press minus and wonder why nothing happened. */}
          <span
            className="min-w-14 text-center text-2xs tabular-nums text-muted-foreground"
            title={t("logs.timeline.fitHint")}
          >
            {zoom === ZOOM_STEPS[0] ? t("logs.timeline.fit") : `${zoom}%`}
          </span>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => stepZoom(1)}
            disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            title={t("logs.timeline.zoomIn")}
            aria-label={t("logs.timeline.zoomIn")}
          >
            <Plus />
          </Button>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={scrollToNow}
          disabled={!scrollable}
          title={t(scrollable ? "logs.timeline.backToNow" : "logs.timeline.fitHint")}
        >
          <Clock />
          {t("logs.timeline.backToNow")}
        </Button>
      </div>
    </div>
  )
}
