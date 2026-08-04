import React from "react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import { Button } from "@renderer/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import type { CatalogEntry } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

import { SetupAuthStep } from "./setup-auth-step"
import { SetupCreateStep } from "./setup-create-step"
import { SetupTestStep } from "./setup-test-step"
import { WizardSteps } from "./wizard-steps"
import { useSetupWizard, type WizardStep } from "./use-setup-wizard"

interface Props {
  entry: CatalogEntry | null
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}

const STEP_INDEX: Record<WizardStep, number> = { auth: 0, test: 1, create: 2 }

/**
 * Post-install setup wizard: authenticate, verify, create the first instance.
 * Every step can be skipped — the agent is already installed by the time this
 * opens, so the user is never trapped in it.
 */
export default function SetupWizard({
  entry,
  open,
  onClose,
  showToast,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const w = useSetupWizard({ entry, open, onClose, showToast })

  if (!entry) return null

  const steps = (["auth", "test", "create"] as const).map((key) => ({
    key,
    label: t(`onboarding.wizard.steps.${key}`),
  }))

  // The CLI path has no key to test, so its primary action goes straight to
  // naming the agent; the key path saves and tests first.
  const onCliPath = w.authTab === "cli" && !!w.loginCommand
  const hasFields = w.fields.length > 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AgentIcon type={entry.name} size={28} />
            <DialogTitle className="m-0">
              {t("onboarding.wizard.title", { label: entry.label || entry.name })}
            </DialogTitle>
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            {t("onboarding.wizard.subtitle")}
          </p>
          <WizardSteps steps={steps} current={STEP_INDEX[w.step]} />
        </DialogHeader>

        <DialogBody>
          {w.step === "auth" && (
            <SetupAuthStep
              fields={w.fields}
              values={w.values}
              onChange={w.setValues}
              errorMessage={w.testResult && !w.testResult.ok ? w.testResult.message : null}
              loginCommand={w.loginCommand}
              loginPhase={w.loginPhase}
              loggedIn={w.loggedIn}
              onOpenTerminal={w.openLoginTerminal}
              onConfirmLogin={w.confirmLogin}
              onCancelAwaiting={() => w.setLoginPhase("idle")}
              tab={w.authTab}
              onTabChange={w.setAuthTab}
            />
          )}
          {w.step === "test" && (
            <SetupTestStep
              ok={!!w.testResult?.ok}
              message={
                w.testResult?.message ||
                t("onboarding.wizard.test.connectionSuccessful")
              }
            />
          )}
          {w.step === "create" && (
            <SetupCreateStep
              agentName={w.agentName}
              onChange={w.setAgentName}
              defaultName={`my-${entry.name}`}
            />
          )}
        </DialogBody>

        <DialogFooter>
          {w.step === "auth" && (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("onboarding.wizard.apiConfig.skip")}
              </Button>
              {onCliPath || !hasFields ? (
                <Button onClick={() => w.setStep("create")}>
                  {t("onboarding.wizard.connectionTest.nextCreateAgent")}
                </Button>
              ) : (
                <Button onClick={w.saveAndTest} disabled={w.testing}>
                  {w.testing
                    ? t("onboarding.wizard.apiConfig.testing")
                    : t("onboarding.wizard.apiConfig.saveAndTest")}
                </Button>
              )}
            </>
          )}

          {w.step === "test" && (
            <>
              <Button variant="outline" onClick={() => w.setStep("auth")}>
                {t("onboarding.wizard.connectionTest.back")}
              </Button>
              <Button onClick={() => w.setStep("create")}>
                {t("onboarding.wizard.connectionTest.nextCreateAgent")}
              </Button>
            </>
          )}

          {w.step === "create" && (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("onboarding.wizard.createInstance.finishLater")}
              </Button>
              <Button
                onClick={w.createAgent}
                disabled={w.submitting || !w.agentName.trim()}
              >
                {w.submitting
                  ? t("onboarding.wizard.createInstance.creating")
                  : t("onboarding.wizard.createInstance.createAgent")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
