import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "../../lib/utils"
import type { LogLevel } from "../../services/logs/log-parser"

/** Each level's dot — shared with the level filter, so a row and its filter
 *  segment can never disagree. Every level reads from the semantic tokens,
 *  never from `primary`, so `info` and `warn` stay apart in either theme. */
export const LEVEL_DOT: Record<LogLevel, string> = {
  error: "bg-(--danger)",
  warn: "bg-(--warning)",
  info: "bg-(--info)",
  debug: "bg-muted-foreground",
  trace: "bg-muted-foreground",
  unknown: "bg-muted-foreground",
}

/** The word in the text colour; an error is coloured in words too, because
 *  it is what a reader scans a long log for. Debug-level noise recedes. */
const TEXT: Record<LogLevel, string> = {
  error: "text-(--danger-text)",
  warn: "text-foreground",
  info: "text-foreground",
  debug: "text-muted-foreground",
  trace: "text-muted-foreground",
  unknown: "text-muted-foreground",
}

export function LogLevelBadge({ level }: { level: LogLevel }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    // The same dot-and-word as the level filter above the table, in place of
    // a tinted block per row. Fixed min-width keeps the message column aligned.
    <span className={cn("inline-flex min-w-14 items-center gap-1.5 text-xs", TEXT[level])}>
      <span className={cn("size-1.5 shrink-0 rounded-full", LEVEL_DOT[level])} />
      {t(`logs.levels.${level}`)}
    </span>
  )
}
