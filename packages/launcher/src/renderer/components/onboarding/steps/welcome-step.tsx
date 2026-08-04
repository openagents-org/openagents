import React from "react"
import { useTranslation } from "react-i18next"

import { PLATFORMS } from "@renderer/components/connections/platforms"
import { cn } from "@renderer/lib/utils"

import { SectionLabel } from "../onboarding-chrome"
import { useRuntimeScan } from "../use-runtime-scan"

const CAPABILITY_IDS = [
  "agents",
  "credentials",
  "workspaces",
  "connections",
] as const

interface ScanRow {
  id: string
  value: string
  detected: boolean
}

export function WelcomeStep({
  agentCount,
}: {
  /** Runnable agents found on this machine; null while the core loads. */
  agentCount: number | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const { runtime, system, loading } = useRuntimeScan(true)

  const chips: Record<(typeof CAPABILITY_IDS)[number], string> = {
    agents: agentCount == null ? "—" : String(agentCount),
    credentials: "AES-256",
    workspaces: t("onboarding.flow.welcome.capabilities.workspaces.chip"),
    connections: `${PLATFORMS.length}`,
  }

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
      <SectionLabel>{t("onboarding.flow.sections.capabilities")}</SectionLabel>
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {CAPABILITY_IDS.map((id) => (
          <li
            key={id}
            className="rounded-lg border border-(--border) bg-(--bg-card) p-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-base font-semibold">
                {t(`onboarding.flow.welcome.capabilities.${id}.title`)}
              </span>
              <span className="shrink-0 font-mono text-2xs font-medium text-(--accent)">
                {chips[id]}
              </span>
            </div>
            <p className="m-0 mt-2 text-xs leading-relaxed text-(--text-secondary)">
              {t(`onboarding.flow.welcome.capabilities.${id}.desc`)}
            </p>
          </li>
        ))}
      </ul>

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
        {t("onboarding.flow.welcome.footnote")}
      </p>
    </>
  )
}
