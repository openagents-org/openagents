import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "../../lib/utils"
import type { LogLevel } from "../../services/logs/log-parser"

/** Tint per level. The label comes from `logs.levels.*` — the same keys the
 *  filter pills use, so a badge and its pill can never disagree. */
const TINT: Record<LogLevel, string> = {
  error: "bg-(--danger-bg) text-(--danger-text)",
  warn: "bg-(--warning-bg) text-(--warning-text)",
  info: "bg-primary/10 text-primary",
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
