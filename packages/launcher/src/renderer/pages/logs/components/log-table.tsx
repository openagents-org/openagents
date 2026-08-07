import React, { useEffect, useRef } from "react"
import { ChevronDown, ChevronRight, ChevronsUpDown } from "lucide-react"
import { useTranslation } from "react-i18next"

import { LogLevelBadge } from "@renderer/components/logs/LogLevelBadge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@renderer/components/ui/table"
import { cn } from "@renderer/lib/utils"
import { formatClock } from "@renderer/services/logs/log-metrics"
import type { LogLevel, ParsedLog } from "@renderer/services/logs/log-parser"
import { LogDetail } from "./log-detail"

export type Density = "compact" | "normal" | "comfortable"

const DENSITY_CLASS: Record<Density, string> = {
  compact: "py-1",
  normal: "py-2",
  comfortable: "py-3.5",
}

/** Message colour per level — error/warn stand out, debug/trace recede. */
const LEVEL_TEXT: Record<LogLevel, string> = {
  error: "text-(--danger-text)",
  warn: "text-(--warning-text)",
  info: "text-foreground",
  debug: "text-muted-foreground",
  trace: "text-muted-foreground",
  unknown: "text-foreground",
}

interface Props {
  entries: ParsedLog[]
  density: Density
  sort: "asc" | "desc"
  onToggleSort: () => void
  expandedId: number | null
  onToggleExpand: (id: number) => void
  /** Row the user jumped to from the timeline; briefly tinted. */
  highlightId: number | null
  onCopyDetail: (entry: ParsedLog) => void
  onShowContext: (entry: ParsedLog) => void
}

export function LogTable({
  entries,
  density,
  sort,
  onToggleSort,
  expandedId,
  onToggleExpand,
  highlightId,
  onCopyDetail,
  onShowContext,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const cell = DENSITY_CLASS[density]

  // Bring the highlighted row into view. Arriving here from the timeline's
  // "Open in list" already switched the view, paged to the entry and expanded
  // it — but none of that moves the scroll container, so an entry anywhere
  // below the fold left the jump looking like it had only changed tabs.
  const highlightRef = useRef<HTMLTableRowElement | null>(null)
  useEffect(() => {
    if (highlightId === null) return
    highlightRef.current?.scrollIntoView({ block: "center" })
  }, [highlightId, entries])

  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-card">
        <TableRow>
          <TableHead className="w-28">
            <button
              type="button"
              onClick={onToggleSort}
              className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-medium text-muted-foreground"
              title={t(`logs.sort.${sort}`)}
            >
              {t("logs.columns.time")}
              <ChevronsUpDown className="size-3" />
            </button>
          </TableHead>
          <TableHead className="w-20 text-xs">{t("logs.columns.level")}</TableHead>
          <TableHead className="w-32 text-xs">{t("logs.columns.agent")}</TableHead>
          <TableHead className="text-xs">{t("logs.columns.event")}</TableHead>
          <TableHead className="w-16 text-right text-xs">
            {t("logs.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => {
          const expanded = expandedId === entry.id
          return (
            <React.Fragment key={entry.id}>
              <TableRow
                ref={highlightId === entry.id ? highlightRef : undefined}
                onClick={() => onToggleExpand(entry.id)}
                className={cn(
                  "cursor-pointer",
                  entry.level === "error" && "bg-(--danger-bg)/40",
                  highlightId === entry.id && "bg-primary/10",
                )}
              >
                <TableCell className={cn(cell, "text-2xs tabular-nums text-muted-foreground")}>
                  {formatClock(entry.time, true)}
                </TableCell>
                <TableCell className={cell}>
                  <LogLevelBadge level={entry.level} />
                </TableCell>
                <TableCell className={cn(cell, "truncate text-xs text-muted-foreground")}>
                  {entry.agent || entry.scope || "—"}
                </TableCell>
                <TableCell className={cn(cell, "max-w-0 text-xs")}>
                  <span className={cn("block truncate", LEVEL_TEXT[entry.level])}>
                    {entry.message}
                  </span>
                </TableCell>
                <TableCell className={cn(cell, "text-right")}>
                  <span
                    aria-label={t(expanded ? "logs.actions.collapse" : "logs.actions.expand")}
                    className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                  >
                    {expanded ? (
                      <ChevronDown className="size-3.5" />
                    ) : (
                      <ChevronRight className="size-3.5" />
                    )}
                  </span>
                </TableCell>
              </TableRow>
              {expanded && (
                <TableRow className="hover:bg-transparent">
                  {/* Five, matching the header exactly. At six the browser
                      added an anonymous column to hold the overflow, split the
                      detail panel's intrinsic width across it, and pushed the
                      table wider than its `overflow-x-auto` container — so
                      opening any entry with a long message scrolled the whole
                      log sideways and clipped the columns on the left. */}
                  <TableCell colSpan={5} className="p-0">
                    <LogDetail
                      entry={entry}
                      onCopy={onCopyDetail}
                      onShowContext={onShowContext}
                    />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          )
        })}
      </TableBody>
    </Table>
  )
}
