import React from "react"
import { ArrowRight } from "lucide-react"
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
import { WizardSteps } from "./wizard-steps"
import { AuthSummary, CreateSummary } from "./wizard-summary-panels"
import { useSetupWizard, type WizardStep } from "./use-setup-wizard"

interface Props {
  entry: CatalogEntry | null
  open: boolean
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
}

const STEP_INDEX: Record<WizardStep, number> = { auth: 0, create: 1 }

/**
 * Post-install setup wizard: connect, then create the first instance. Two
 * steps, because those are the only two that ask the user for anything —
 * verifying the connection now happens inside the save action (see
 * `use-setup-wizard`), not on a page of its own.
 *
 * The layout is form-left / summary-right. The summary carries the sense of
 * direction the deleted step used to carry, without taking a turn of its own.
 * It hides below `md`, where the two columns would each be too narrow to read;
 * everything it says is either repeated in the form or purely orientational.
 *
 * Nothing here traps the user: the agent is already installed by the time this
 * opens, so closing it at any point leaves a usable install behind.
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

  const steps = (["auth", "create"] as const).map((key) => ({
    key,
    label: t(`onboarding.wizard.steps.${key}`),
  }))

  // The CLI path has no key to verify, so its primary action goes straight to
  // naming the agent; the key path saves and probes on the way there.
  const onCliPath = w.authTab === "cli" && !!w.loginCommand
  const skipVerify = onCliPath || w.fields.length === 0
  const failed = !!w.testResult && !w.testResult.ok

  // What step 2 reports back. Nothing in this wizard forces a sign-in, so the
  // CLI path can reach step 2 unconfirmed — the recap has to be able to say so
  // rather than paint every arrival green.
  const connection = onCliPath
    ? { label: t("onboarding.wizard.auth.cliTab"), ok: w.loggedIn === true }
    : w.fields.length > 0
      ? {
          label: t("onboarding.wizard.auth.keyTab"),
          model: w.testResult?.model,
          ok: !!w.testResult?.ok,
        }
      : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader className="gap-4">
          <div className="flex items-center gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted">
              <AgentIcon type={entry.name} size={24} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="m-0 text-lg">
                {t("onboarding.wizard.title", {
                  label: entry.label || entry.name,
                })}
              </DialogTitle>
              <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                {t("onboarding.wizard.subtitle")}
              </p>
            </div>
          </div>
          <WizardSteps
            steps={steps}
            current={STEP_INDEX[w.step]}
            meta={t(
              w.step === "create"
                ? "onboarding.wizard.meta.lastStep"
                : "onboarding.wizard.meta.estimate",
            )}
          />
        </DialogHeader>

        <DialogBody>
          <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_22rem]">
            {w.step === "auth" ? (
              <>
                <SetupAuthStep
                  fields={w.fields}
                  values={w.values}
                  onChange={w.setValues}
                  errorMessage={failed ? w.testResult!.message : null}
                  onRetry={w.saveAndContinue}
                  loginCommand={w.loginCommand}
                  loginPhase={w.loginPhase}
                  loggedIn={w.loggedIn}
                  onOpenTerminal={w.openLoginTerminal}
                  onConfirmLogin={w.confirmLogin}
                  onCancelAwaiting={() => w.setLoginPhase("idle")}
                  tab={w.authTab}
                  onTabChange={w.setAuthTab}
                />
                <AuthSummary
                  onCliPath={skipVerify}
                  testing={w.testing}
                  result={w.testResult}
                  steps={steps.map((s) => s.label)}
                />
              </>
            ) : (
              <>
                <SetupCreateStep
                  agentName={w.agentName}
                  onChange={w.setAgentName}
                  defaultName={`my-${entry.name}`}
                  connection={connection}
                />
                <CreateSummary
                  agentName={w.agentName || `my-${entry.name}`}
                  agentType={entry.name}
                />
              </>
            )}
          </div>
        </DialogBody>

        {/* One primary action, and a note that never competes with it. This is
            the one dialog that opts out of the shared even-split footer: half
            the row given to a sentence of small print would read as a second
            control, which is exactly what a wizard footer must not have. */}
        <DialogFooter className="items-center justify-between gap-4 sm:*:flex-none">
          {w.step === "auth" ? (
            <>
              <span className="text-2xs text-muted-foreground">
                {t("onboarding.wizard.footer.changeLater")}
              </span>
              {skipVerify ? (
                <Button onClick={() => w.setStep("create")}>
                  {t("onboarding.wizard.footer.saveAndCreate")}
                  <ArrowRight />
                </Button>
              ) : (
                <Button onClick={w.saveAndContinue} disabled={w.testing}>
                  {w.testing
                    ? t("onboarding.wizard.verify.running")
                    : failed
                      ? t("onboarding.wizard.verify.retry")
                      : t("onboarding.wizard.footer.saveAndCreate")}
                  {!w.testing && <ArrowRight />}
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => w.setStep("auth")}>
                {t("onboarding.wizard.footer.backToConnection")}
              </Button>
              <Button
                onClick={w.createAgent}
                disabled={w.submitting || !w.agentName.trim()}
              >
                {w.submitting
                  ? t("onboarding.wizard.createInstance.creating")
                  : t("onboarding.wizard.createInstance.createAgent")}
                {!w.submitting && <ArrowRight />}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
