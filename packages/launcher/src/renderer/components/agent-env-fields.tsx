import React, { useEffect, useMemo, useState } from "react"
import { AlertCircle, ChevronDown, ChevronRight, Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import {
  agentCredentials,
  endpointMismatch,
  isAdvancedField,
  sortCredentialFields,
} from "../../shared/agent-credentials"

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
  /**
   * A field the caller wants the user looking at — the one an attempt just
   * failed on. `nonce` is what fires it: the same field can be refused twice
   * in a row, and only a changed value re-runs the effect. Opens the advanced
   * section when the field lives behind it, then scrolls it into view.
   */
  focusField?: { name: string; nonce: number } | null
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
  focusField,
  idPrefix = "agent-env",
  className,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // The registry lists fields in the order they were written, which put
  // CodeBuddy's endpoint below two tuning knobs and off the bottom of a
  // scrolling dialog. Order by what has to be decided first instead.
  const ordered = useMemo(() => sortCredentialFields(fields), [fields])
  const [plain, advanced] = useMemo(() => {
    const adv: EnvField[] = []
    const rest: EnvField[] = []
    for (const f of ordered)
      (agentType && isAdvancedField(agentType, f.name) ? adv : rest).push(f)
    return [rest, adv]
  }, [ordered, agentType])

  // Being told a value is wrong is only half an answer when the field holding
  // it is three screens down, or — for an endpoint — not rendered at all until
  // "Advanced" is opened. Reveal it and scroll to it, so the message and the
  // input it is about are on screen together.
  const focusName = focusField?.name
  const focusNonce = focusField?.nonce
  useEffect(() => {
    if (!focusName) return
    if (advanced.some((f) => f.name === focusName)) setAdvancedOpen(true)
    // Two frames: the first lets the `setAdvancedOpen` above commit, because
    // until it has, the element being scrolled to does not exist.
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        const el = document.getElementById(`${idPrefix}-${focusName}`)
        if (!el) return
        el.scrollIntoView({ block: "center", behavior: "smooth" })
        el.focus({ preventScroll: true })
      })
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [focusName, focusNonce, advanced, idPrefix])

  const renderField = (f: EnvField): React.JSX.Element => {
    const id = `${idPrefix}-${f.name}`
    const value = values[f.name] ?? f.default ?? ""
    const FieldInput = f.password ? PasswordInput : Input
    // A model-gateway URL in a field that takes a vendor deployment is not
    // a typo the agent recovers from — it cannot work at all. Say so at the
    // field, while the user is still looking at it.
    const mismatch = agentType ? endpointMismatch(agentType, value) : null
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
        {mismatch && (
          <p className="m-0 flex items-start gap-1.5 text-2xs leading-relaxed text-(--danger-text)">
            <AlertCircle className="mt-px size-3.5 shrink-0" />
            {t(`agents.credentials.endpointMismatch.${mismatch}` as never)}
          </p>
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
  }

  const noEndpoint = agentType
    ? agentCredentials(agentType).noEndpoint
    : undefined

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {plain.map(renderField)}

      {/* Why this form has no endpoint field. An absence explains nothing:
          next to agents that do have one, a missing base URL reads as an
          oversight, and the user goes looking for the setting instead of for
          the place it actually lives. */}
      {noEndpoint && (
        <p className="m-0 flex items-start gap-1.5 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-2xs leading-relaxed text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          {t(`agents.credentials.noEndpoint.${noEndpoint}` as never)}
        </p>
      )}

      {/* Hidden until asked for. A deployment override is something you
          come looking for; showing it beside the credential fields is what
          made a model-gateway URL look like a thing that might work. */}
      {advanced.length > 0 && (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            className="inline-flex cursor-pointer items-center gap-1 self-start border-0 bg-transparent p-0 text-2xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {advancedOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            {t("agents.envFields.advanced")}
          </button>
          {advancedOpen && advanced.map(renderField)}
        </div>
      )}
    </div>
  )
}
