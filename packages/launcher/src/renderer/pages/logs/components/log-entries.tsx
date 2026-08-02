import React, { useMemo, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"

import { LogLevelBadge } from "@renderer/components/logs/LogLevelBadge"
import { JsonViewer } from "@renderer/components/logs/JsonViewer"
import { cn } from "@renderer/lib/utils"
import type { LogLevel, ParsedLog } from "@renderer/services/logs/log-parser"

export type LogEntry = { p: ParsedLog; i: number }

/** Message colour per level — error/warn stand out, debug/trace recede. */
const LEVEL_CLASS: Record<LogLevel, string> = {
  error: "text-(--danger-text)",
  warn: "text-(--warning-text)",
  info: "text-foreground",
  debug: "text-muted-foreground",
  trace: "text-muted-foreground",
  unknown: "text-foreground",
}

function SourceTag({ source }: { source: string }): React.JSX.Element {
  return (
    <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-3xs text-primary">
      {source}
    </span>
  )
}

function LogRow({ entry }: { entry: LogEntry }): React.JSX.Element {
  const { t } = useTranslation()
  const { p, i } = entry
  const [expanded, setExpanded] = useState(false)

  return (
    <li
      className={cn(
        "flex items-start gap-2 border-b px-3 py-1.5 hover:bg-accent/40",
        p.level === "error" && "bg-(--danger-bg)/30",
      )}
    >
      <span className="w-20 shrink-0 text-3xs tabular-nums text-muted-foreground">
        {p.timestamp ? p.timestamp.split(/[ T]/).pop()?.slice(0, 8) : "—"}
      </span>
      <span className="mt-px shrink-0">
        <LogLevelBadge level={p.level} />
      </span>
      {p.source && <SourceTag source={p.source} />}
      <div className="min-w-0 flex-1 wrap-break-word">
        <span className={LEVEL_CLASS[p.level]}>{p.message || p.raw}</span>
        {p.json !== null && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-3xs text-muted-foreground"
            >
              {expanded ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              {expanded ? t("logs.json.hide") : t("logs.json.show")}
            </button>
            {expanded && (
              <pre className="mt-1 overflow-x-auto rounded-sm bg-muted px-3 py-2 text-2xs">
                <JsonViewer value={p.json} collapsed={false} />
              </pre>
            )}
          </div>
        )}
      </div>
      <span className="sr-only">{i}</span>
    </li>
  )
}

export function LogList({ entries }: { entries: LogEntry[] }): React.JSX.Element {
  return (
    <ul className="m-0 list-none p-0">
      {entries.map((e) => (
        <LogRow key={e.i} entry={e} />
      ))}
    </ul>
  )
}

/** Same rows, bucketed by minute so bursts read as a single event. */
export function LogTimeline({ entries }: { entries: LogEntry[] }): React.JSX.Element {
  const { t } = useTranslation()

  const groups = useMemo(() => {
    const map = new Map<string, LogEntry[]>()
    for (const e of entries) {
      const stamp = e.p.iso || e.p.timestamp || ""
      const key = stamp ? stamp.slice(0, 16) : t("logs.timeline.noTimestamp")
      map.set(key, [...(map.get(key) || []), e])
    }
    return Array.from(map.entries())
  }, [entries, t])

  return (
    <ol className="m-0 list-none p-0">
      {groups.map(([bucket, list]) => (
        <li key={bucket} className="border-b">
          <div className="sticky top-0 bg-muted px-3 py-1.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
            {bucket}
          </div>
          <ul className="m-0 list-none p-0">
            {list.map(({ p, i }) => (
              <li
                key={i}
                className="flex items-start gap-2 px-4 py-1.5 hover:bg-accent/40"
              >
                <span className="shrink-0">
                  <LogLevelBadge level={p.level} />
                </span>
                {p.source && <SourceTag source={p.source} />}
                <span className={cn("min-w-0 flex-1 wrap-break-word", LEVEL_CLASS[p.level])}>
                  {p.message || p.raw}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  )
}
