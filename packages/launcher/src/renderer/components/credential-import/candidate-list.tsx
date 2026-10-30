import React from "react"
import type { TFunction } from "i18next"
import { Check } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  CLI_SOURCE_NAMES,
  type ImportCandidate,
  type ImportSource,
} from "../../../shared/credential-import"
import { Badge } from "@renderer/components/ui/badge"
import { cn } from "@renderer/lib/utils"

interface Props {
  candidates: ImportCandidate[]
  selected: string | null
  onSelect: (id: string) => void
}

/**
 * The keys found, one choice each. A row says whose key it is, where it will be
 * sent and where it was found — enough to pick without seeing the key itself.
 */
export function CandidateList({
  candidates,
  selected,
  onSelect,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      role="radiogroup"
      aria-label={t("credentialImport.title")}
      className="flex flex-col gap-2"
    >
      {candidates.map((c) => {
        const active = c.id === selected
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(c.id)}
            className={cn(
              "flex w-full cursor-pointer items-start gap-3 rounded-lg border bg-transparent px-3.5 py-3 text-left transition-colors hover:bg-muted/50",
              active && "border-primary bg-muted/50",
            )}
          >
            <span
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                active && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {active && <Check className="size-3" />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">
                  {t(`credentialImport.vendor.${c.vendor}`)}
                </span>
                {c.vendor === "relay" && (
                  <Badge variant="muted" size="sm">
                    {t(`credentialImport.protocol.${c.protocol}`)}
                  </Badge>
                )}
                <code className="text-2xs text-muted-foreground">
                  {c.keyHint}
                </code>
              </span>
              <span className="truncate font-mono text-2xs text-muted-foreground">
                {c.baseUrl}
              </span>
              <span className="text-2xs text-muted-foreground">
                {t("credentialImport.from", {
                  sources: c.sources.map((s) => sourceLabel(s, t)).join(" · "),
                })}
                {c.model &&
                  ` · ${t("credentialImport.model", { model: c.model })}`}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function sourceLabel(source: ImportSource, t: TFunction): string {
  const name = source.label || CLI_SOURCE_NAMES[source.ref] || source.ref
  return t(`credentialImport.source.${source.kind}`, { name })
}
