import React from "react"
import { useTranslation } from "react-i18next"

import { cn } from "@renderer/lib/utils"

import { SectionLabel } from "../onboarding-chrome"
import { useRuntimeScan } from "../use-runtime-scan"

interface ScanRow {
  id: string
  value: string
  detected: boolean
}

/**
 * The opening screen of the single pairing-first flow: what happens next
 * (pair this device, drive it from the workspace) plus the local runtime
 * scan. The old two-path mode choice is gone — a local agent is an optional
 * continuation after pairing, not a separate route.
 */
export function WelcomeStep(): React.JSX.Element {
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
      <SectionLabel>{t("onboarding.flow.sections.runtimeScan")}</SectionLabel>
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
        {t("onboarding.flow.welcome.footnote.node")}
      </p>
    </>
  )
}
