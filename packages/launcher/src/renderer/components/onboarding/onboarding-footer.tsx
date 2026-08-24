import React from "react"
import { Check, ChevronRight, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"

import { FooterBar } from "./onboarding-chrome"
import type { OnboardingFlowApi } from "./use-onboarding-flow"

/**
 * Per-step actions.
 *
 * Only the pairing step offers a skip, and only until it succeeds: skipping is
 * "I don't want to do this at all", which stops being a distinct choice once
 * the device is in (finishing does the same thing) or once the user has walked
 * into the optional agent steps. Back is the way out of those.
 */
export function OnboardingFooter({
  flow,
}: {
  flow: OnboardingFlowApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const { steps, stepIndex, stepId, goNext, goBack, close } = flow
  const { agents, auth, provision, pairing } = flow

  const bar = (children: React.ReactNode, withBack = true): React.JSX.Element => (
    <FooterBar
      steps={steps}
      step={stepIndex}
      onBack={withBack && stepIndex > 0 ? goBack : undefined}
    >
      {children}
    </FooterBar>
  )
  const skip = (
    <Button variant="ghost" onClick={() => close(true)}>
      {t("onboarding.flow.footer.skipToApp")}
    </Button>
  )

  switch (stepId) {
    case "welcome":
      return bar(
        <Button onClick={goNext}>
          {t("onboarding.flow.footer.getStarted")}
          <ChevronRight />
        </Button>,
        false,
      )

    // Pairing alone is a complete onboarding (the workspace installs agents
    // here remotely), so once the device is in the user chooses: finish, or
    // continue into the optional local-agent steps.
    case "pairNode":
      return bar(
        pairing.connected ? (
          <>
            <Button variant="outline" onClick={goNext}>
              {t("onboarding.flow.footer.addFirstAgent")}
              <ChevronRight />
            </Button>
            <Button onClick={() => close(true)}>
              <Check />
              {t("onboarding.flow.footer.finishSetup")}
            </Button>
          </>
        ) : (
          <>
            {skip}
            <Button
              onClick={() => void pairing.connect()}
              disabled={!pairing.canConnect}
            >
              {pairing.connecting ? (
                <>
                  <Loader2 className="animate-spin" />
                  {t("onboarding.flow.footer.connecting")}
                </>
              ) : (
                <>
                  {t("onboarding.flow.footer.connectDevice")}
                  <ChevronRight />
                </>
              )}
            </Button>
          </>
        ),
      )

    case "agent":
      return bar(
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
        </Button>,
      )

    // Only required ENV fields gate progress. CLI login is NOT a hard gate: the
    // login happens in an external terminal and the launcher's health check is
    // unreliable for some agents (e.g. Gemini exposes no readiness signal), so
    // blocking on it would strand users who are actually logged in. We show the
    // detected status, but always let them continue.
    case "configure":
      return bar(
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
        </Button>,
      )

    // Creating the agent is the last step: it binds to the paired workspace
    // (when there is one) and finishes onboarding in the same action. No skip —
    // four steps in, with a name and a folder already on screen, "skip" throws
    // that away for the same end state Back can reach deliberately.
    default:
      return bar(
        <>
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
                {t("onboarding.flow.footer.createAndFinish")}
                <Check />
              </>
            )}
          </Button>
        </>,
      )
  }
}
