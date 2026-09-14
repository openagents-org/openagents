import React, { useCallback, useEffect, useRef, useState } from "react"
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
import { WizardVerifyError } from "./wizard-verify-error"
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

  // Which field the form should be showing. A refusal names one, and in a form
  // long enough to scroll it is almost never the one on screen — CodeBuddy's
  // endpoint is not even rendered until "Advanced" is opened.
  const [focusField, setFocusField] = useState<{
    name: string
    nonce: number
  } | null>(null)
  // Bumped per request rather than compared by name: the same field refused
  // twice in a row has to move the form twice.
  const focusNonce = useRef(0)
  const showField = useCallback((name: string) => {
    focusNonce.current += 1
    setFocusField({ name, nonce: focusNonce.current })
  }, [])

  // Pressing the primary action and being sent back to a field is expected;
  // being sent back to a field you cannot see is not. Every attempt produces a
  // new result object, so a second identical refusal jumps again.
  const result = w.testResult
  useEffect(() => {
    const field = result && !result.ok ? result.field : null
    if (field) showField(field)
  }, [result, showField])

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
      {/* Steps up with the viewport: 4xl is a comfortable two-column form on a
          laptop and a postage stamp on a 5K display, where the window itself is
          two and a half times as wide. The summary column takes part of each
          step so the form column stays a form and not a row of very long
          inputs. */}
      <DialogContent className="sm:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl">
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
          <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
            {w.step === "auth" ? (
              <>
                <SetupAuthStep
                  agentType={entry.name}
                  fields={w.fields}
                  values={w.values}
                  onChange={w.setValues}
                  loginValues={w.loginValues}
                  onLoginChange={w.setLoginValues}
                  focusField={focusField}
                  loginCommand={w.loginCommand}
                  loginPhase={w.loginPhase}
                  loggedIn={w.loggedIn}
                  onStartLogin={w.startLogin}
                  login={w.login}
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
                  defaultName={w.defaultName}
                  connection={connection}
                  pairedWorkspaces={w.pairedWorkspaces}
                  pairedWorkspace={w.pairedWorkspace}
                  onPairedWorkspaceChange={w.setPairedWorkspaceSlug}
                  connectOnCreate={w.connectOnCreate}
                  onConnectOnCreateChange={w.setConnectOnCreate}
                />
                <CreateSummary
                  agentName={w.agentName || w.defaultName}
                  agentType={entry.name}
                />
              </>
            )}
          </div>
        </DialogBody>

        {/* Pinned, because the form above it scrolls: a verification failure
            reported inside a dozen env fields is a failure the user never
            sees. Above the footer, so the reason and the retry that acts on
            it are read as one thing. */}
        {w.step === "auth" && failed && (
          <div className="shrink-0 border-t px-6 py-2.5">
            <WizardVerifyError
              message={w.testResult!.message}
              explained={w.testResult!.explained}
              fieldName={w.testResult!.field}
              onShowField={
                w.testResult!.field
                  ? () => showField(w.testResult!.field!)
                  : undefined
              }
            />
          </div>
        )}

        {/* Left: the ways out, at the same weight and size as the action on
            the right — closing a half-filled form is a decision, and a footer
            of buttons should not mix one real control with a line of small
            print (that note now sits next to the choice it softens, in the
            step body). */}
        <DialogFooter className="items-center justify-between gap-4 sm:*:flex-none">
          {w.step === "auth" ? (
            <>
              <Button variant="outline" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              {skipVerify ? (
                <Button onClick={w.continueWithLogin}>
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
              <div className="flex min-w-0 items-center gap-2">
                <Button variant="outline" onClick={onClose}>
                  {t("common.cancel")}
                </Button>
                <Button variant="outline" onClick={() => w.setStep("auth")}>
                  {t("onboarding.wizard.footer.backToConnection")}
                </Button>
              </div>
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
