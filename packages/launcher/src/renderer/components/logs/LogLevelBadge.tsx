import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "../../lib/utils"
import type { LogLevel } from "../../services/logs/log-parser"

/** Tint per level. The label comes from `logs.levels.*` — the same keys the
 *  filter pills use, so a badge and its pill can never disagree.
 *
 *  Every level reads from the semantic tokens, never from `primary`: the accent
 *  is user-chosen, and on the amber preset an `info` badge came out the same
 *  colour as `warn` — two levels a log reader has to tell apart at a glance.
 *  These four tints only follow light/dark. */
const TINT: Record<LogLevel, string> = {
  error: "bg-(--danger-bg) text-(--danger-text)",
  warn: "bg-(--warning-bg) text-(--warning-text)",
  info: "bg-(--info-bg) text-(--info-text)",
  debug: "bg-muted text-muted-foreground",
  trace: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
}

export function LogLevelBadge({ level }: { level: LogLevel }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    // Fixed min-width keeps the message column aligned across levels.
    // `uppercase` is what makes the badge shout where the pill does not, off
    // the one shared label — it is a no-op for scripts without letter case.
    <span
      className={cn(
        "inline-block min-w-11 rounded-sm px-1.5 py-0.5 text-center text-3xs font-bold uppercase",
        TINT[level],
      )}
    >
      {t(`logs.levels.${level}`)}
    </span>
  )
}
