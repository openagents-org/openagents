import React from "react"
import { Bot, Link2, type LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"

import { SectionLabel, selectableCard } from "../onboarding-chrome"
import type { OnboardingMode } from "../onboarding-shared"
import { useRuntimeScan } from "../use-runtime-scan"

/** `node` leads, and is preselected: one code and this device is in. */
const MODES: Array<{ id: OnboardingMode; icon: LucideIcon }> = [
  { id: "node", icon: Link2 },
  { id: "agent", icon: Bot },
]

interface ScanRow {
  id: string
  value: string
  detected: boolean
}

export function WelcomeStep({
  mode,
  setMode,
}: {
  mode: OnboardingMode
  setMode: (m: OnboardingMode) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { runtime, system, loading } = useRuntimeScan(true)

  const pending = t("onboarding.flow.welcome.scan.pending")
  const rows: ScanRow[] = [
    {
      id: "node",
      value: runtime?.nodeVersion || pending,
      detected: !!runtime?.nodeVersion,
    },
    {
      id: "npm",
      value: runtime?.npmVersion || pending,
      detected: !!runtime?.npmVersion,
    },
    {
      id: "core",
      value: runtime?.coreVersion || pending,
      detected: !!runtime?.coreVersion,
    },
    { id: "credentials", value: "AES-256-GCM", detected: true },
    {
      id: "platform",
      value: system ? `${system.platform} · ${system.arch}` : pending,
      detected: !!system,
    },
  ]

  return (
    <>
      <SectionLabel>{t("onboarding.flow.sections.path")}</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            aria-pressed={mode === id}
            className={cn(selectableCard(mode === id), "p-5")}
          >
            <div className="flex items-center gap-2 text-base font-semibold">
              <Icon className="size-4 shrink-0 text-(--accent)" />
              {t(`onboarding.flow.welcome.modes.${id}.title`)}
              {id === "node" && (
                <span className="ml-auto shrink-0 rounded-full bg-(--accent-bg) px-2 py-0.5 font-mono text-2xs font-medium text-(--accent)">
                  {t("onboarding.flow.welcome.modes.recommended")}
                </span>
              )}
            </div>
            <p className="m-0 mt-2 text-xs leading-relaxed text-(--text-secondary)">
              {t(`onboarding.flow.welcome.modes.${id}.desc`)}
            </p>
          </button>
        ))}
      </div>

      <SectionLabel className="mt-9">
        {t("onboarding.flow.sections.runtimeScan")}
      </SectionLabel>
      <ul
        className={cn(
          "m-0 list-none overflow-hidden rounded-lg border border-(--border) bg-(--bg-card) p-0 transition-opacity",
          loading && "opacity-60",
        )}
      >
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-3 border-b border-(--border) px-4 py-2.5 last:border-b-0"
          >
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                row.detected ? "bg-(--success)" : "bg-(--text-tertiary)",
              )}
            />
            <span className="text-sm">
              {t(`onboarding.flow.welcome.scan.${row.id}`)}
            </span>
            <span className="ml-auto truncate font-mono text-2xs text-(--text-secondary)">
              {row.value}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-5 mb-0 text-xs text-(--text-tertiary)">
        {t(`onboarding.flow.welcome.footnote.${mode}`)}
      </p>
    </>
  )
}
