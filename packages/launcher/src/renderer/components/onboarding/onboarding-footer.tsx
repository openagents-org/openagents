import React from "react"
import { ChevronRight, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"

import { FooterBar } from "./onboarding-chrome"
import type { OnboardingFlowApi } from "./use-onboarding-flow"

/**
 * Per-step actions. Steps 4 and 5 are optional, so both keep a skip that
 * closes onboarding for good rather than parking the user mid-wizard.
 */
export function OnboardingFooter({
  flow,
}: {
  flow: OnboardingFlowApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const { step, goNext, goBack, close, agents, auth, provision } = flow

  const skip = (
    <Button variant="ghost" onClick={() => close(true)}>
      {t("onboarding.flow.footer.skipToApp")}
    </Button>
  )

  switch (step) {
    case 0:
      return (
        <FooterBar step={step}>
          <Button onClick={goNext}>
            {t("onboarding.flow.footer.getStarted")}
            <ChevronRight />
          </Button>
        </FooterBar>
      )

    case 1:
      return (
        <FooterBar step={step} onBack={goBack}>
          <Button
            onClick={() => void agents.installSelected()}
            disabled={!agents.selectedEntry || agents.installing}
          >
            {agents.installing ? (
              <>
                <Loader2 className="animate-spin" />
                {t("onboarding.flow.footer.installing")}
              </>
            ) : (
              <>
                {t("onboarding.flow.footer.continue")}
                <ChevronRight />
              </>
            )}
          </Button>
        </FooterBar>
      )

    // Only required ENV fields gate progress. CLI login is NOT a hard gate: the
    // login happens in an external terminal and the launcher's health check is
    // unreliable for some agents (e.g. Gemini exposes no readiness signal), so
    // blocking on it would strand users who are actually logged in. We show the
    // detected status, but always let them continue.
    case 2:
      return (
        <FooterBar step={step} onBack={goBack}>
          <Button
            onClick={() => void auth.saveAndContinue()}
            disabled={auth.saving || auth.blocked}
          >
            {auth.saving ? (
              <>
                <Loader2 className="animate-spin" />
                {t("onboarding.flow.footer.saving")}
              </>
            ) : (
              <>
                {t("onboarding.flow.footer.saveAndContinue")}
                <ChevronRight />
              </>
            )}
          </Button>
        </FooterBar>
      )

    case 3:
      return (
        <FooterBar step={step} onBack={goBack}>
          {skip}
          <Button
            onClick={() => void provision.createAgent()}
            disabled={
              provision.creatingAgent ||
              !provision.agentName.trim() ||
              !provision.agentFolder.trim()
            }
          >
            {provision.creatingAgent ? (
              <>
                <Loader2 className="animate-spin" />
                {t("onboarding.flow.footer.creating")}
              </>
            ) : (
              <>
                {t("onboarding.flow.footer.createAndContinue")}
                <ChevronRight />
              </>
            )}
          </Button>
        </FooterBar>
      )

    default:
      return (
        <FooterBar step={step} onBack={goBack}>
          {skip}
          <Button
            onClick={() => void provision.finishWorkspace()}
            disabled={
              provision.provisioning ||
              (provision.wsMode === "create"
                ? !provision.workspaceName.trim()
                : !provision.wsInvite.trim())
            }
          >
            {provision.provisioning ? (
              <>
                <Loader2 className="animate-spin" />
                {provision.wsMode === "create"
                  ? t("onboarding.flow.footer.creating")
                  : t("onboarding.flow.footer.connecting")}
              </>
            ) : (
              <>
                {t("onboarding.flow.footer.finishSetup")}
                <ChevronRight />
              </>
            )}
          </Button>
        </FooterBar>
      )
  }
}
