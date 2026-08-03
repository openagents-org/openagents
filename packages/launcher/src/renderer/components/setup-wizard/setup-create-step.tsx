import React from "react"
import { useTranslation } from "react-i18next"

import { Field, FieldDescription, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"

/**
 * Step 3 — name the first instance. addAgent is unchanged from legacy, so the
 * install_agents.json schema is honoured without callers changing anything.
 */
export function SetupCreateStep({
  agentName,
  onChange,
  defaultName,
}: {
  agentName: string
  onChange: (name: string) => void
  defaultName: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Field>
      <FieldLabel htmlFor="setup-agent-name">
        {t("onboarding.wizard.createInstance.agentNameLabel")}
      </FieldLabel>
      <Input
        id="setup-agent-name"
        value={agentName}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultName}
      />
      <FieldDescription>{t("onboarding.wizard.createInstance.hint")}</FieldDescription>
    </Field>
  )
}
