import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Cpu, Loader2, Search } from "lucide-react"
import { Button } from "../../shadcn/button"
import AgentIcon from "../../AgentIcon"
import { cn } from "../../../lib/utils"
import type { OnboardingAgent } from "../../../types"
import { StepHeader } from "../onboarding-chrome"
import { INSTALL_PHASE_IDS } from "../onboarding-shared"

export function AgentSelectionStep({
  agents,
  loading,
  search,
  setSearch,
  selected,
  setSelected,
  onRetry,
  installing,
  installPhase,
  installDetail,
}: {
  agents: OnboardingAgent[]
  loading: boolean
  search: string
  setSearch: (v: string) => void
  selected: string
  setSelected: (v: string) => void
  onRetry: () => void
  installing: boolean
  installPhase: string | null
  installDetail: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const phaseId = INSTALL_PHASE_IDS.includes(
    (installPhase || "preparing") as (typeof INSTALL_PHASE_IDS)[number],
  )
    ? installPhase || "preparing"
    : "installing"
  return (
    <>
      <StepHeader
        icon={<Cpu className="w-5 h-5" />}
        title={t("onboarding.flow.agentSelection.title")}
        subtitle={t("onboarding.flow.agentSelection.subtitle")}
      />
      {installing && (
        <div className="flex items-start gap-2.5 mb-4 px-3.5 py-3 rounded-(--radius-sm) bg-(--accent-bg) border border-(--accent-border)">
          <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-(--accent)" />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-(--text-primary)">
              {t(`onboarding.flow.installPhase.${phaseId}`)}
            </div>
            <div className="text-2xs text-(--text-secondary) truncate">
              {installDetail ||
                t("onboarding.flow.agentSelection.installingDetail")}
            </div>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-(--radius-sm) bg-(--bg-card) border border-(--border)">
        <Search className="w-3.5 h-3.5 text-(--text-tertiary)" />
        <input
          className="flex-1 bg-transparent border-0 outline-none text-sm"
          placeholder={t("onboarding.flow.agentSelection.searchPlaceholder")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ul className="grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-2.5 list-none m-0 p-0">
        {loading && agents.length === 0 && (
          <li className="col-span-1 sm:col-span-2 text-center text-xs text-(--text-tertiary) py-6 flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />{" "}
            {t("onboarding.flow.agentSelection.loadingAgents")}
          </li>
        )}
        {!loading && agents.length === 0 && (
          <li className="col-span-1 sm:col-span-2 text-center text-xs text-(--text-tertiary) py-6 flex flex-col items-center gap-3">
            <span>
              {search.trim()
                ? t("onboarding.flow.agentSelection.noMatch")
                : t("onboarding.flow.agentSelection.stillInstalling")}
            </span>
            {!search.trim() && (
              <Button size="sm" variant="ghost" onClick={onRetry}>
                {t("onboarding.flow.agentSelection.retry")}
              </Button>
            )}
          </li>
        )}
        {agents.map((c) => {
          const active = c.name === selected
          return (
            <li key={c.name} className="h-full">
              <button
                type="button"
                onClick={() => setSelected(c.name)}
                disabled={installing}
                className={cn(
                  "w-full h-full text-left p-3 rounded-(--radius-sm) border bg-(--bg-card) transition-colors",
                  // Lock selection while an install is running — switching the
                  // selected agent mid-download would desync the install from
                  // the highlighted card.
                  installing ? "cursor-not-allowed" : "cursor-pointer",
                  active
                    ? "border-(--accent) ring-2 ring-(--accent-border)"
                    : installing
                      ? "border-(--border) opacity-50"
                      : "border-(--border) hover:border-(--border-hover)",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <AgentIcon type={c.name} size={28} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-(--text-primary) truncate">
                        {c.label || c.name}
                      </span>
                      {c.featured && (
                        <span className="text-3xs uppercase px-1 py-0.5 rounded-sm bg-(--accent-bg) text-(--accent) font-bold">
                          {t("onboarding.flow.agentSelection.featured")}
                        </span>
                      )}
                      {c.installed && (
                        <span className="text-3xs uppercase px-1 py-0.5 rounded-sm bg-(--success-bg) text-(--success-text) font-bold">
                          {t("onboarding.flow.agentSelection.installed")}
                        </span>
                      )}
                    </div>
                    <div className="text-2xs leading-snug text-(--text-secondary) line-clamp-2 mt-1 min-h-[2lh]">
                      {c.description ||
                        t("onboarding.flow.agentSelection.noDescription")}
                    </div>
                  </div>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
