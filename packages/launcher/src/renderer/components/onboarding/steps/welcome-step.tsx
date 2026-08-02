import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Cpu, KeyRound, Layers, Rocket, Sparkles } from "lucide-react"
import { StepHeader } from "../onboarding-chrome"

export function WelcomeStep(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <StepHeader
        icon={<Sparkles className="w-5 h-5" />}
        title={t("onboarding.flow.welcome.title")}
        subtitle={t("onboarding.flow.welcome.subtitle")}
      />
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 list-none m-0 p-0">
        {[
          {
            icon: <Cpu className="w-4 h-4" />,
            label: t("onboarding.flow.welcome.benefits.install"),
          },
          {
            icon: <KeyRound className="w-4 h-4" />,
            label: t("onboarding.flow.welcome.benefits.credentials"),
          },
          {
            icon: <Layers className="w-4 h-4" />,
            label: t("onboarding.flow.welcome.benefits.workspaces"),
          },
          {
            icon: <Rocket className="w-4 h-4" />,
            label: t("onboarding.flow.welcome.benefits.connect"),
          },
        ].map((b) => (
          <li
            key={b.label}
            className="flex items-start gap-3 p-3.5 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)"
          >
            <div className="text-(--accent) mt-0.5 shrink-0">{b.icon}</div>
            <span className="text-xs text-(--text-primary)">{b.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-xs text-(--text-tertiary)">
        {t("onboarding.flow.welcome.footnote")}
      </p>
    </>
  )
}
