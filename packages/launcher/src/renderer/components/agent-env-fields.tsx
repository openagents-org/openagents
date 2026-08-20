import React from "react"
import { useTranslation } from "react-i18next"

import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { PasswordInput } from "@renderer/components/ui-kit"
import { ModelField } from "@renderer/components/model-field"
import { envFieldHint } from "@renderer/lib/agent-meta"
import { hasModelPicker } from "@renderer/lib/model-fields"
import { cn } from "@renderer/lib/utils"
import type { EnvField, ModelListPath } from "@renderer/types"

interface Props {
  /** Agent type id — decides which model list the `*_MODEL` picker loads. */
  agentType?: string
  /**
   * Which auth path this form is: the model picker lists what the endpoint in
   * THIS form serves ("key") or what the CLI sign-in offers ("login"). Defaults
   * to "key", since every form that carries key fields is the key path.
   */
  modelPath?: ModelListPath
  fields: EnvField[]
  values: Record<string, string>
  onChange: (name: string, value: string) => void
  /** Namespaces the input ids so two of these can coexist on one screen. */
  idPrefix?: string
  className?: string
}

/**
 * An agent's declared env_config, as a form. Shared by the post-install setup
 * wizard, the Configure dialog and the agent detail page so all three ask for
 * a key the same way.
 *
 * The env var name is the label and the agent's own description sits under the
 * input as a hint. The description is a full sentence written by the agent
 * author ("OpenAI-compatible base URL (the default works for the OpenAI API;
 * change it for a proxy or relay)") — as a label it wrapped across two lines,
 * and the legacy form CSS additionally upper-cased it, so the form read as a
 * wall of shouting. The name is also what the user will see in
 * `~/.openagents/env/`, which makes it the more useful of the two to lead with.
 *
 * Password fields go through PasswordInput so secrets never sit plain in the
 * DOM (stage.md §2.2).
 */
export function AgentEnvFields({
  agentType,
  modelPath = "key",
  fields,
  values,
  onChange,
  idPrefix = "agent-env",
  className,
}: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {fields.map((f) => {
        const id = `${idPrefix}-${f.name}`
        const value = values[f.name] ?? f.default ?? ""
        const FieldInput = f.password ? PasswordInput : Input
        return (
          <Field key={f.name}>
            <FieldLabel htmlFor={id} className="font-mono text-xs">
              {f.name}
              {/* `.required` is asserted against in tests — keep the marker a
                  distinct element rather than folding it into the label text. */}
              {f.required && <span className="required"> *</span>}
            </FieldLabel>
            {agentType && hasModelPicker(agentType, f.name) ? (
              <ModelField
                id={id}
                agentType={agentType}
                value={value}
                env={values}
                path={modelPath}
                placeholder={f.placeholder}
                onChange={(next) => onChange(f.name, next)}
              />
            ) : f.options?.length ? (
              <Select
                value={value}
                onValueChange={(next: string) => onChange(f.name, next)}
              >
                <SelectTrigger id={id} className="w-full">
                  <SelectValue
                    placeholder={
                      f.placeholder ||
                      t("agents.envFields.enterField", { name: f.name })
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {f.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <FieldInput
                id={id}
                value={value}
                onChange={(e) => onChange(f.name, e.target.value)}
                placeholder={
                  f.placeholder ||
                  t("agents.envFields.enterField", { name: f.name })
                }
              />
            )}
            {/* Translated where we have a catalog entry, the registry's own
                English wording otherwise. See lib/agent-meta. */}
            {envFieldHint(f, t) && (
              <FieldDescription className="text-2xs">
                {envFieldHint(f, t)}
              </FieldDescription>
            )}
          </Field>
        )
      })}
    </div>
  )
}
