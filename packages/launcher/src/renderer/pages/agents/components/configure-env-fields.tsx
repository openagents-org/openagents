import React from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"
import { PasswordInput } from "@renderer/components/ui-kit"
import type { EnvField } from "@renderer/types"

interface Props {
  fields: EnvField[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
}

/** The API-key side of an agent's configuration: its declared env fields. */
export function ConfigureEnvFields({
  fields,
  values,
  onChange,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4">
      {fields.map((f) => {
        const id = `agent-config-${f.name}`
        const placeholder =
          f.placeholder || t("agents.configureDialog.enterField", { name: f.name })
        return (
          <Field key={f.name}>
            <FieldLabel htmlFor={id}>
              {f.description}
              {/* `.required` is asserted against in tests — keep the marker a
                  distinct element rather than folding it into the label text. */}
              {f.required && <span className="required"> *</span>}
            </FieldLabel>
            {f.password ? (
              <PasswordInput
                id={id}
                value={values[f.name] || ""}
                onChange={(e) => onChange(f.name, e.target.value)}
                placeholder={placeholder}
              />
            ) : (
              <Input
                id={id}
                value={values[f.name] || ""}
                onChange={(e) => onChange(f.name, e.target.value)}
                placeholder={placeholder}
              />
            )}
          </Field>
        )
      })}
    </div>
  )
}
