import React, { useMemo } from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"
import {
  formatClock,
  type AgentLane,
  type Incident,
  type TimeSpan,
} from "@renderer/services/logs/log-metrics"
import type { LogLevel, ParsedLog } from "@renderer/services/logs/log-parser"

/** Dots per lane. Denser than this and they overlap into a solid bar anyway. */
const SLOTS = 180

interface Slot {
  ratio: number
  level: LogLevel
  count: number
  entry: ParsedLog
}

interface Props {
  lanes: AgentLane[]
  span: TimeSpan
  incidents: Incident[]
  selectedId: number | null
  onSelect: (entry: ParsedLog) => void
  /** Drawn as the "now" marker when it falls inside the span. */
  now: number
}

const DOT_CLASS: Record<LogLevel, string> = {
  error: "bg-(--danger)",
  warn: "bg-(--warning)",
  info: "bg-(--info)",
  debug: "bg-muted-foreground/50",
  trace: "bg-muted-foreground/40",
  unknown: "bg-muted-foreground/50",
}

const SEVERITY: LogLevel[] = ["error", "warn", "info", "debug", "trace", "unknown"]

/** Collapses a lane's entries into fixed slots, keeping the worst per slot. */
function slotsOf(entries: ParsedLog[], span: TimeSpan): Slot[] {
  const width = (span.end - span.start) / SLOTS || 1
  const map = new Map<number, Slot>()
  for (const e of entries) {
    if (e.time === null) continue
    const idx = Math.min(SLOTS - 1, Math.max(0, Math.floor((e.time - span.start) / width)))
    const existing = map.get(idx)
    if (!existing) {
      map.set(idx, { ratio: idx / SLOTS, level: e.level, count: 1, entry: e })
      continue
    }
    existing.count += 1
    if (SEVERITY.indexOf(e.level) < SEVERITY.indexOf(existing.level)) {
      existing.level = e.level
      existing.entry = e
    }
  }
  return Array.from(map.values())
}

function pct(value: number, span: TimeSpan): number {
  const width = span.end - span.start || 1
  return ((value - span.start) / width) * 100
}

/**
 * The "correlated failure" annotation, anchored so it can never leave the track.
 *
 * A fixed `-translate-x-1/2` centres the label on the incident, which is right
 * in the middle of the chart and wrong at either end: an incident near the last
 * bucket put half the label past the right edge, and since the track scrolls
 * (`overflow-auto`), that overhang became real scroll width — a slab of empty
 * space to the right and a scrollbar under the whole panel.
 *
 * Sliding the anchor with the position fixes it without measuring anything:
 * at 0% the label is left-aligned, at 50% centred, at 100% right-aligned, and
 * in between it eases from one to the other. The label stays inside the track
 * for any incident and still points at the right place.
 */
function IncidentTag({
  incident,
  span,
}: {
  incident: Incident
  span: TimeSpan
}): React.JSX.Element {
  const { t } = useTranslation()
  const p = Math.min(100, Math.max(0, pct((incident.start + incident.end) / 2, span)))

  return (
    <div
      className="pointer-events-none absolute -top-1 z-20 rounded-md border border-(--danger-border) bg-(--danger-bg) px-2 py-0.5 text-3xs whitespace-nowrap text-(--danger-text)"
      style={{
        // The 10rem offset skips the sticky lane-label column.
        left: `calc(10rem + (100% - 10rem) * ${p / 100})`,
        transform: `translateX(${-p}%)`,
      }}
    >
      {t("logs.timeline.incident", {
        agents: incident.agents,
        events: incident.events,
      })}
    </div>
  )
}

export function TimelineLanes({
  lanes,
  span,
  incidents,
  selectedId,
  onSelect,
  now,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  const laneSlots = useMemo(
    () => lanes.map((lane) => ({ lane, slots: slotsOf(lane.entries, span) })),
    [lanes, span],
  )
  const nowInSpan = now >= span.start && now <= span.end
  // Only annotate the worst incident — stacking labels turns the chart to noise.
  const headline = incidents.slice().sort((a, b) => b.events - a.events)[0]

  return (
    <div className="relative">
      {laneSlots.map(({ lane, slots }) => (
        <div key={lane.agent} className="flex items-center border-t">
          <div className="sticky left-0 z-10 flex w-40 shrink-0 items-center gap-2 bg-card px-4 py-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xs font-semibold text-primary uppercase">
              {lane.agent.slice(0, 2)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{lane.agent}</div>
              <div className="text-3xs text-muted-foreground">
                {t("logs.timeline.laneEvents", { count: lane.total })}
              </div>
            </div>
          </div>

          <div className="relative h-12 min-w-0 flex-1">
            {incidents.map((incident) => (
              <div
                key={incident.start}
                className="pointer-events-none absolute inset-y-0 bg-(--danger)/10"
                style={{
                  left: `${pct(incident.start, span)}%`,
                  width: `${Math.max(0.5, pct(incident.end, span) - pct(incident.start, span))}%`,
                }}
              />
            ))}

            {slots.map((slot) => (
              <button
                key={slot.ratio}
                type="button"
                onClick={() => onSelect(slot.entry)}
                title={`${formatClock(slot.entry.time)} · ${slot.entry.message}`}
                style={{ left: `${slot.ratio * 100}%` }}
                className={cn(
                  "absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-0 p-0 transition-transform hover:scale-200",
                  DOT_CLASS[slot.level],
                  slot.entry.id === selectedId && "scale-200 ring-2 ring-primary",
                )}
              />
            ))}
          </div>
        </div>
      ))}

      {nowInSpan && (
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-primary"
          style={{ left: `calc(10rem + (100% - 10rem) * ${pct(now, span) / 100})` }}
        />
      )}

      {headline && <IncidentTag incident={headline} span={span} />}
    </div>
  )
}
