import React from "react"
import { useTranslation } from "react-i18next"
import { Input } from "../shadcn/input"
import { Button } from "../shadcn/button"
import { WizardStepShell } from "./WizardStepShell"

interface SetupCreateInstanceProps {
  agentName: string
  setAgentName: (n: string) => void
  defaultName: string
  submitting: boolean
  onSubmit: () => void
  onCancel: () => void
  section?: "all" | "body" | "footer"
}

/**
 * Step 3 — name and create the first agent instance. The runtime side
 * (window.api.addAgent) is unchanged from legacy so callers don't have to
 * change anything to honor the install_agents.json schema.
 */
export function SetupCreateInstance({
  agentName,
  setAgentName,
  defaultName,
  submitting,
  onSubmit,
  onCancel,
  section = "all",
}: SetupCreateInstanceProps): React.JSX.Element {
  const { t } = useTranslation()
  const body = (
    <>
      <div className="form-group mb-0">
        <label>{t("onboarding.wizard.createInstance.agentNameLabel")}</label>
        <Input
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder={defaultName}
        />
      </div>
      <p className="hint m-0">
        {t("onboarding.wizard.createInstance.hint")}
      </p>
    </>
  )
  const footer = (
    <div className="form-actions mt-0">
      <Button
        variant="default"
        onClick={onSubmit}
        disabled={submitting || !agentName.trim()}
      >
        {submitting
          ? t("onboarding.wizard.createInstance.creating")
          : t("onboarding.wizard.createInstance.createAgent")}
      </Button>
      <Button variant="outline" onClick={onCancel}>
        {t("onboarding.wizard.createInstance.finishLater")}
      </Button>
    </div>
  )

  if (section === "body") return body
  if (section === "footer") return footer
  return <WizardStepShell body={body} footer={footer} />
}
