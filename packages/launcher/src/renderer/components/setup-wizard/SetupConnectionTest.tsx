import React from "react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/button"
import { WizardStepShell } from "./WizardStepShell"

interface SetupConnectionTestProps {
  message: string
  ok: boolean
  onNext: () => void
  onBack: () => void
  section?: "all" | "body" | "footer"
}

/** Step 2 — confirm connection result, then advance to instance creation. */
export function SetupConnectionTest({
  message,
  ok,
  onNext,
  onBack,
  section = "all",
}: SetupConnectionTestProps): React.JSX.Element {
  const { t } = useTranslation()
  const body = (
    <>
      <p className={`text-sm m-0 ${ok ? "test-success" : "test-error"}`}>
        {message}
      </p>
      <p className="hint m-0">
        {ok
          ? t("onboarding.wizard.connectionTest.okHint")
          : t("onboarding.wizard.connectionTest.failHint")}
      </p>
    </>
  )
  const footer = (
    <div className="form-actions mt-0">
      <Button variant="default" onClick={onNext}>
        {t("onboarding.wizard.connectionTest.nextCreateAgent")}
      </Button>
      <Button variant="outline" onClick={onBack}>
        {t("onboarding.wizard.connectionTest.back")}
      </Button>
    </div>
  )

  if (section === "body") return body
  if (section === "footer") return footer
  return <WizardStepShell body={body} footer={footer} />
}
