import React from "react"
import { useTranslation } from "react-i18next"

import { Checkbox } from "../ui/checkbox"
import { Skeleton } from "../ui/skeleton"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "../ui/field"
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
          // A choice card: the whole row toggles the checkbox inside it, and
          // the checkbox stays the real control for keyboard and screen readers.
          <FieldLabel key={target.id} htmlFor={`mcp-target-${target.id}`}>
            <Field orientation="horizontal" data-disabled={disabled || undefined}>
              <Checkbox
                id={`mcp-target-${target.id}`}
                checked={active}
                disabled={disabled}
                onCheckedChange={() => onToggle(target.id)}
              />
              <FieldContent className="min-w-0">
                <FieldTitle>
                  {target.label}
                  {target.configured && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("connections.mcp.alreadyConfigured")}
                    </span>
                  )}
                  {!target.detected && !disabled && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {t("connections.mcp.notDetected")}
                    </span>
                  )}
                </FieldTitle>
                <FieldDescription className="truncate text-xs">
                  {target.error
                    ? t("connections.mcp.unreadable", { detail: target.error })
                    : target.file}
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        )
      })}
    </div>
  )
}
