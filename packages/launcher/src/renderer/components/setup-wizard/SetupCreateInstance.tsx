import React from "react"
import { useTranslation } from "react-i18next"
import { Field, FieldDescription, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { Button } from "../ui/button"

interface BodyProps {
  agentName: string
  setAgentName: (n: string) => void
  defaultName: string
}

interface FooterProps {
  agentName: string
  submitting: boolean
  onSubmit: () => void
  onCancel: () => void
}

/**
 * Step 3 — name and create the first agent instance. The runtime side
 * (window.api.addAgent) is unchanged from legacy so callers don't have to
 * change anything to honor the install_agents.json schema.
 */
export function SetupCreateInstanceBody({
  agentName,
  setAgentName,
  defaultName,
}: BodyProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <Field>
      <FieldLabel htmlFor="setup-agent-name">
        {t("onboarding.wizard.createInstance.agentNameLabel")}
      </FieldLabel>
      <Input
        id="setup-agent-name"
        value={agentName}
        onChange={(e) => setAgentName(e.target.value)}
        placeholder={defaultName}
      />
      <FieldDescription>
        {t("onboarding.wizard.createInstance.hint")}
      </FieldDescription>
    </Field>
  )
}

/**
 * Buttons are returned bare, not wrapped: DialogFooter lays the row out
 * itself (`[&>*]:flex-1`), so a wrapper would take the whole row and leave
 * the buttons clustered on the left.
 */
export function SetupCreateInstanceFooter({
  agentName,
  submitting,
  onSubmit,
  onCancel,
}: FooterProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <Button variant="outline" onClick={onCancel}>
        {t("onboarding.wizard.createInstance.finishLater")}
      </Button>
      <Button onClick={onSubmit} disabled={submitting || !agentName.trim()}>
        {submitting
          ? t("onboarding.wizard.createInstance.creating")
          : t("onboarding.wizard.createInstance.createAgent")}
      </Button>
    </>
  )
}
