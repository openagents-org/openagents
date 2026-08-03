import React, { useState } from "react"
import { ChevronDown, ChevronRight, ClipboardCopy, Crosshair } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { JsonViewer } from "@renderer/components/logs/JsonViewer"
import { cn } from "@renderer/lib/utils"
import { formatDateTime } from "@renderer/services/logs/log-metrics"
import type { ParsedLog } from "@renderer/services/logs/log-parser"

interface Props {
  entry: ParsedLog
  onCopy: (entry: ParsedLog) => void
  onShowContext: (entry: ParsedLog) => void
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 flex-1 wrap-break-word text-xs">{value}</dd>
    </div>
  )
}

export function LogDetail({ entry, onCopy, onShowContext }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [stackOpen, setStackOpen] = useState(true)

  return (
    <div
      className={cn(
        "border-l-2 bg-muted/40 px-5 py-4",
        entry.level === "error"
          ? "border-l-(--danger)"
          : entry.level === "warn"
            ? "border-l-(--warning)"
            : "border-l-primary",
      )}
    >
      <div className="flex items-start gap-3">
        <h3 className="m-0 min-w-0 flex-1 wrap-break-word text-sm font-semibold">
          {entry.message}
        </h3>
        <div className="flex shrink-0 gap-2">
          <Button size="xs" variant="outline" onClick={() => onCopy(entry)}>
            <ClipboardCopy />
            {t("logs.actions.copyDetail")}
          </Button>
          <Button size="xs" variant="outline" onClick={() => onShowContext(entry)}>
            <Crosshair />
            {t("logs.actions.showContext")}
          </Button>
        </div>
      </div>

      {entry.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <Badge key={tag.key} variant="muted" size="sm" className="font-mono">
              <span className="text-muted-foreground">{t(`logs.tag.${tag.key}`)}</span>
              {tag.value}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <dl className="m-0 flex flex-col gap-2">
          <Field label={t("logs.detail.time")} value={formatDateTime(entry.time)} />
          <Field label={t("logs.detail.agent")} value={entry.agent || "—"} />
          <Field
            label={t("logs.detail.eventType")}
            value={t(`logs.eventType.${entry.eventType}`)}
          />
          <Field
            label={t("logs.detail.level")}
            value={
              entry.level === entry.rawLevel
                ? entry.level.toUpperCase()
                : t("logs.detail.inferredLevel", {
                    level: entry.level.toUpperCase(),
                    raw: entry.rawLevel.toUpperCase(),
                  })
            }
          />
          {entry.scope && (
            <Field label={t("logs.detail.scope")} value={entry.scope} />
          )}
        </dl>

        {(entry.stack.length > 0 || entry.json !== null) && (
          <div className="min-w-0">
            {entry.stack.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setStackOpen((v) => !v)}
                  className="mb-1 inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs text-muted-foreground"
                >
                  {stackOpen ? (
                    <ChevronDown className="size-3" />
                  ) : (
                    <ChevronRight className="size-3" />
                  )}
                  {t("logs.detail.stack")}
                </button>
                {stackOpen && (
                  <pre className="m-0 max-h-56 overflow-auto rounded-md bg-background px-3 py-2 font-mono text-2xs leading-relaxed">
                    {entry.stack.join("\n")}
                  </pre>
                )}
              </>
            )}
            {entry.json !== null && (
              <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-background px-3 py-2 text-2xs">
                <JsonViewer value={entry.json} collapsed={false} />
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
