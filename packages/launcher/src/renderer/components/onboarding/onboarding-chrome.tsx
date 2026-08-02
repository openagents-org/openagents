import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircle2 } from "lucide-react"
import { cn } from "../../lib/utils"
import type { Step } from "./onboarding-shared"

export function ProgressBar({ step }: { step: Step }): React.JSX.Element {
  const { t } = useTranslation()
  const labels = [
    t("onboarding.flow.progress.welcome"),
    t("onboarding.flow.progress.agent"),
    t("onboarding.flow.progress.configure"),
    t("onboarding.flow.progress.createAgent"),
    t("onboarding.flow.progress.connectWorkspace"),
  ]
  return (
    <div className="shrink-0 px-8 pt-6 pb-4 border-b border-(--border) bg-(--bg-card)">
      <div className="flex items-center gap-3 max-w-180 mx-auto">
        {labels.map((label, i) => (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "w-6 h-6 rounded-full text-2xs font-bold flex items-center justify-center",
                  i < step
                    ? "bg-(--success) text-white"
                    : i === step
                      ? "bg-(--accent) text-white"
                      : "bg-(--bg-input) text-(--text-tertiary)",
                )}
              >
                {i < step ? <CheckCircle2 className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-xs",
                  i === step
                    ? "text-(--text-primary) font-semibold"
                    : "text-(--text-secondary)",
                )}
              >
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div className="flex-1 h-px bg-(--border)" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

export function FooterShell({
  children,
}: {
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="shrink-0 border-t border-(--border) bg-(--bg-card) px-8 py-4">
      <div className="max-w-180 mx-auto flex items-center justify-between gap-3">
        {children}
      </div>
    </div>
  )
}

export function StepHeader({
  icon,
  title,
  subtitle,
}: {
  icon: React.JSX.Element
  title: string
  subtitle: string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 mb-8">
      <div className="w-10 h-10 rounded-(--radius-sm) bg-(--accent-bg) text-(--accent) flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <h1 className="m-0 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 m-0 text-sm text-(--text-secondary)">{subtitle}</p>
      </div>
    </div>
  )
}

// ─── Step bodies ──────────────────────────────────────────────
