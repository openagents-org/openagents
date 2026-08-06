import React from "react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"

import { SummarySection, VerifyStatus, WizardSummary } from "./wizard-summary"
import type { VerifyResult } from "./use-setup-wizard"

/**
 * Step 1's aside. Which of the two things it says depends on whether there is
 * anything to verify: the CLI path has no probe to report on, so it points
 * forward instead, and the key path leads with where the probe got to.
 */
export function AuthSummary({
  onCliPath,
  testing,
  result,
  steps,
}: {
  /** No key to probe — the panel becomes a signpost rather than a report. */
  onCliPath: boolean
  testing: boolean
  result: VerifyResult | null
  steps: string[]
}): React.JSX.Element {
  const { t } = useTranslation()

  if (onCliPath)
    return (
      <WizardSummary
        badge="02"
        title={t("onboarding.wizard.summary.next.title")}
        description={t("onboarding.wizard.summary.next.description")}
      >
        <SummarySection label={t("onboarding.wizard.summary.next.flowLabel")}>
          <ol className="m-0 flex list-none flex-col p-0">
            {steps.map((label) => (
              <li
                key={label}
                className="border-b border-panel-border py-3 text-sm font-semibold text-panel-accent-foreground last:border-b-0"
              >
                {label}
              </li>
            ))}
          </ol>
        </SummarySection>
      </WizardSummary>
    )

  const state = testing ? "running" : result ? (result.ok ? "ok" : "failed") : "idle"

  return (
    <WizardSummary
      badge="01"
      title={t("onboarding.wizard.summary.verify.title")}
      description={t("onboarding.wizard.summary.verify.description")}
    >
      <SummarySection label={t("onboarding.wizard.summary.verify.resultLabel")}>
        <VerifyStatus
          state={state}
          message={
            testing
              ? t("onboarding.wizard.verify.running")
              : result
                ? result.ok
                  ? t("onboarding.wizard.verify.ok")
                  : t("onboarding.wizard.verify.failed")
                : t("onboarding.wizard.verify.idle")
          }
        />
      </SummarySection>
      <p className="m-0 text-xs leading-relaxed text-panel-muted">
        {t("onboarding.wizard.summary.verify.modelNote")}
      </p>
      <SummarySection label={t("onboarding.wizard.summary.verify.storageLabel")}>
        <code className="font-mono text-xs text-panel-accent-foreground">
          ~/.openagents/env/
        </code>
      </SummarySection>
    </WizardSummary>
  )
}

/** Step 2's aside: what is about to be created, exactly as it will appear. */
export function CreateSummary({
  agentName,
  agentType,
}: {
  agentName: string
  agentType: string
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <WizardSummary
      badge="02"
      title={t("onboarding.wizard.summary.create.title")}
      description={t("onboarding.wizard.summary.create.description")}
    >
      <SummarySection label={t("onboarding.wizard.summary.create.previewLabel")}>
        <div className="flex items-center gap-3 rounded-lg bg-white/5 p-3">
          {/* A light chip, not the brand fill the rest of the panel uses: the
              agent glyphs are `currentColor` SVGs loaded through `<img>`, where
              that resolves against the file's own root and always paints black.
              They need something pale behind them wherever they appear. */}
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white">
            <AgentIcon type={agentType} size={18} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-panel-accent-foreground">
              {agentName}
            </div>
            <div className="mt-0.5 truncate text-2xs text-panel-muted">
              {t("onboarding.wizard.summary.create.ready")}
            </div>
          </div>
        </div>
      </SummarySection>
      <p className="m-0 text-xs leading-relaxed text-panel-muted">
        {t("onboarding.wizard.summary.create.renameNote")}
      </p>
    </WizardSummary>
  )
}
