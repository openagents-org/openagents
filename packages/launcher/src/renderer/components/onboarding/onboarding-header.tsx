import React from "react"
import { useTranslation } from "react-i18next"

import { StepHeading } from "./onboarding-chrome"
import type { OnboardingFlowApi } from "./use-onboarding-flow"

/**
 * The step's title and subtitle, resolved in the container rather than inside
 * each step body — the heading is pinned while the content below it scrolls,
 * so it cannot live in the scrolling half.
 */
export function OnboardingHeader({
  flow,
}: {
  flow: OnboardingFlowApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const { stepId, agents } = flow
  const entry = agents.selectedEntry
  const label =
    entry?.label || entry?.name || t("onboarding.flow.apiKey.thisAgent")

  switch (stepId) {
    case "welcome":
      return (
        <StepHeading
          title={t("onboarding.flow.welcome.title")}
          subtitle={t("onboarding.flow.welcome.subtitle")}
        />
      )
    case "pairNode":
      return (
        <StepHeading
          title={t("onboarding.flow.pairNode.title")}
          subtitle={t("onboarding.flow.pairNode.subtitle")}
        />
      )
    case "agent":
      return (
        <StepHeading
          title={t("onboarding.flow.agentSelection.title")}
          subtitle={t("onboarding.flow.agentSelection.subtitle")}
        />
      )
    case "configure":
      return (
        <StepHeading
          title={t("onboarding.flow.apiKey.title")}
          subtitle={authSubtitle(entry, label, t)}
        />
      )
    default:
      return (
        <StepHeading
          title={t("onboarding.flow.createAgent.title")}
          subtitle={t("onboarding.flow.createAgent.subtitle", { label })}
        />
      )
  }
}

/** How this agent authenticates decides what the configure step promises. */
function authSubtitle(
  entry: OnboardingFlowApi["agents"]["selectedEntry"],
  label: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const mode = entry?.authMode ?? "none"
  if (mode === "env") return t("onboarding.flow.apiKey.subtitleEnv", { label })
  if (mode === "none") return t("onboarding.flow.apiKey.subtitleNone", { label })
  return entry && entry.envFields.length > 0
    ? t("onboarding.flow.apiKey.subtitleLoginWithKey", { label })
    : t("onboarding.flow.apiKey.subtitleLogin", { label })
}
