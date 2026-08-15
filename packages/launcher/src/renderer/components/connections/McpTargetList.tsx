import React from "react"
import { useTranslation } from "react-i18next"

import { Checkbox } from "../ui/checkbox"
import { Skeleton } from "../ui/skeleton"
import { cn } from "../../lib/utils"
import type { McpTargetState } from "../../types"

interface Props {
  targets: McpTargetState[]
  selected: Set<string>
  loading: boolean
  onToggle: (id: string) => void
}

export function McpTargetList({
  targets,
  selected,
  loading,
  onToggle,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="flex flex-col gap-1.5" aria-label={t("connections.mcp.loading")}>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {targets.map((target) => {
        const active = selected.has(target.id)
        const disabled = !!target.error

        return (
          // A <label> makes the whole row a hit target and keeps the checkbox
          // as the real control, so keyboard and screen readers work unaided.
          <label
            key={target.id}
            className={cn(
              "flex items-start gap-2.5 rounded-sm border px-3 py-2 transition-colors",
              disabled
                ? "cursor-not-allowed border-transparent bg-muted opacity-70"
                : active
                  ? "cursor-pointer border-primary/30 bg-primary/5"
                  : "cursor-pointer border-transparent bg-muted hover:border-primary/30",
            )}
          >
            <Checkbox
              checked={active}
              disabled={disabled}
              onCheckedChange={() => onToggle(target.id)}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-medium">{target.label}</span>
                {target.configured && (
                  <span className="text-3xs text-(--success-text)">
                    {t("connections.mcp.alreadyConfigured")}
                  </span>
                )}
                {!target.detected && !disabled && (
                  <span className="text-3xs text-muted-foreground">
                    {t("connections.mcp.notDetected")}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-3xs text-muted-foreground">
                {target.error
                  ? t("connections.mcp.unreadable", { detail: target.error })
                  : target.file}
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}
