import React from "react"

import { cn } from "../../lib/utils"
import type { LogLevel } from "../../services/logs/log-parser"

const META: Record<LogLevel, { label: string; className: string }> = {
  error: { label: "ERROR", className: "bg-(--danger-bg) text-(--danger-text)" },
  warn: { label: "WARN", className: "bg-(--warning-bg) text-(--warning-text)" },
  info: { label: "INFO", className: "bg-primary/10 text-primary" },
  debug: { label: "DEBUG", className: "bg-muted text-muted-foreground" },
  trace: { label: "TRACE", className: "bg-muted text-muted-foreground" },
  unknown: { label: "LOG", className: "bg-muted text-muted-foreground" },
}

export function LogLevelBadge({ level }: { level: LogLevel }): React.JSX.Element {
  const m = META[level]
  return (
    // Fixed min-width keeps the message column aligned across levels.
    <span
      className={cn(
        "inline-block min-w-11 rounded-sm px-1.5 py-0.5 text-center text-3xs font-bold",
        m.className,
      )}
    >
      {m.label}
    </span>
  )
}
