import React, { useState } from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "../ui/badge"
import { Field, FieldDescription, FieldLabel } from "../ui/field"

/** Compact tag-style editor for credential scopes (stage.md §4.4 — "Key 权限控制"). */
export function ScopeEditor({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [draft, setDraft] = useState("")

  const add = (raw: string): void => {
    const v = raw.trim()
    if (!v || value.includes(v)) return
    onChange([...value, v])
    setDraft("")
  }

  const remove = (s: string): void => onChange(value.filter((x) => x !== s))

  return (
    <Field>
      <FieldLabel htmlFor="credential-scopes">
        {t("credentials.editor.scopesLabel")}
      </FieldLabel>
      <div className="flex min-h-8.5 flex-wrap items-center gap-1.5 rounded-sm bg-muted px-2 py-1.5">
        {value.map((s) => (
          <Badge key={s} variant="secondary" size="sm" className="gap-1">
            {s}
            <button
              type="button"
              onClick={() => remove(s)}
              className="border-0 bg-transparent p-0 hover:text-destructive"
              aria-label={t("credentials.editor.removeScope", { scope: s })}
            >
              ×
            </button>
          </Badge>
        ))}
        <input
          id="credential-scopes"
          type="text"
          value={draft}
          placeholder={
            value.length === 0
              ? t("credentials.editor.scopesPlaceholderEmpty")
              : t("credentials.editor.scopesPlaceholderAdd")
          }
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault()
              add(draft)
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              remove(value[value.length - 1])
            }
          }}
          onBlur={() => add(draft)}
          className="min-w-30 flex-1 border-0 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      <FieldDescription>{t("credentials.editor.scopesHint")}</FieldDescription>
    </Field>
  )
}
