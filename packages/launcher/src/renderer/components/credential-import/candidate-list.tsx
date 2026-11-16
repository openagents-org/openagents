import React from "react"
import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"

import {
  CLI_SOURCE_NAMES,
  type ImportCandidate,
  type ImportSource,
} from "../../../shared/credential-import"
import { Badge } from "@renderer/components/ui/badge"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@renderer/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@renderer/components/ui/radio-group"

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
    // shadcn's choice cards: each row is a FieldLabel around its Field, so the
    // whole row picks the radio inside it.
    <RadioGroup
      value={selected ?? ""}
      onValueChange={onSelect}
      aria-label={t("credentialImport.title")}
      className="gap-2"
    >
      {candidates.map((c) => (
        <FieldLabel key={c.id} htmlFor={`import-candidate-${c.id}`}>
          <Field orientation="horizontal">
            <RadioGroupItem value={c.id} id={`import-candidate-${c.id}`} />
            <FieldContent className="min-w-0">
              <FieldTitle className="flex-wrap">
                {t(`credentialImport.vendor.${c.vendor}`)}
                {c.vendor === "relay" && (
                  <Badge variant="secondary">
                    {t(`credentialImport.protocol.${c.protocol}`)}
                  </Badge>
                )}
                <code className="text-xs font-normal text-muted-foreground">
                  {c.keyHint}
                </code>
              </FieldTitle>
              <FieldDescription className="truncate font-mono text-xs">
                {c.baseUrl}
              </FieldDescription>
              <FieldDescription className="text-xs">
                {t("credentialImport.from", {
                  sources: c.sources.map((s) => sourceLabel(s, t)).join(" · "),
                })}
                {c.model &&
                  ` · ${t("credentialImport.model", { model: c.model })}`}
              </FieldDescription>
            </FieldContent>
          </Field>
        </FieldLabel>
      ))}
    </RadioGroup>
  )
}

function sourceLabel(source: ImportSource, t: TFunction): string {
  const name = source.label || CLI_SOURCE_NAMES[source.ref] || source.ref
  return t(`credentialImport.source.${source.kind}`, { name })
}
