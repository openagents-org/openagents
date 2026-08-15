import React from "react"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { SearchInput } from "@renderer/components/ui-kit"
import { agentDescription } from "@renderer/lib/agent-meta"
import { cn } from "@renderer/lib/utils"
import type { OnboardingAgent } from "@renderer/types"

import { selectableCard } from "../onboarding-chrome"
import { INSTALL_PHASE_IDS } from "../onboarding-shared"
import type { OnboardingAgentsApi } from "../use-onboarding-agents"

export function AgentSelectionStep({
  agents,
}: {
  agents: OnboardingAgentsApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    visibleAgents,
    agentsLoading,
    search,
    setSearch,
    installedOnly,
    setInstalledOnly,
    selectedAgent,
    setSelectedAgent,
    installing,
    installPhase,
    installDetail,
    reload,
  } = agents

  const phaseId = INSTALL_PHASE_IDS.includes(
    (installPhase || "preparing") as (typeof INSTALL_PHASE_IDS)[number],
  )
    ? installPhase || "preparing"
    : "installing"

  return (
    <>
      {installing && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-(--accent-border) bg-(--accent-bg) px-4 py-3">
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-(--accent)" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">
              {t(`onboarding.flow.installPhase.${phaseId}`)}
            </div>
            <div className="truncate text-2xs text-(--text-secondary)">
              {installDetail ||
                t("onboarding.flow.agentSelection.installingDetail")}
            </div>
          </div>
        </div>
      )}

      <div className="mb-5 flex items-center gap-2.5">
        <SearchInput
          wrapperClassName="flex-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("onboarding.flow.agentSelection.searchPlaceholder")}
        />
        <Button
          variant={installedOnly ? "default" : "outline"}
          onClick={() => setInstalledOnly(!installedOnly)}
          aria-pressed={installedOnly}
        >
          {t("onboarding.flow.agentSelection.installedOnly")}
        </Button>
      </div>

      <ul className="m-0 grid auto-rows-fr list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2">
        {agentsLoading && visibleAgents.length === 0 && (
          <li className="col-span-full flex items-center justify-center gap-2 py-8 text-xs text-(--text-tertiary)">
            <Loader2 className="size-4 animate-spin" />
            {t("onboarding.flow.agentSelection.loadingAgents")}
          </li>
        )}
        {!agentsLoading && visibleAgents.length === 0 && (
          <li className="col-span-full flex flex-col items-center gap-3 py-8 text-center text-xs text-(--text-tertiary)">
            <span>
              {search.trim() || installedOnly
                ? t("onboarding.flow.agentSelection.noMatch")
                : t("onboarding.flow.agentSelection.stillInstalling")}
            </span>
            {!search.trim() && !installedOnly && (
              <Button size="sm" variant="ghost" onClick={reload}>
                {t("onboarding.flow.agentSelection.retry")}
              </Button>
            )}
          </li>
        )}
        {visibleAgents.map((agent) => (
          <li key={agent.name} className="h-full">
            <AgentCard
              agent={agent}
              active={agent.name === selectedAgent}
              locked={installing}
              onSelect={() => setSelectedAgent(agent.name)}
            />
          </li>
        ))}
      </ul>
    </>
  )
}

/** The mono footer line: what this agent needs before it can run. */
function authRequirement(agent: OnboardingAgent): string {
  if (agent.authMode === "login" && agent.loginCommand) return agent.loginCommand
  const key = agent.envFields.find((f) => f.password)?.name
  if (agent.authMode === "env" && key) return key
  return agent.authMode
}

function AgentCard({
  agent,
  active,
  locked,
  onSelect,
}: {
  agent: OnboardingAgent
  active: boolean
  locked: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      // Lock selection while an install is running — switching the selected
      // agent mid-download would desync the install from the highlighted card.
      disabled={locked}
      className={cn(
        selectableCard(active),
        "flex h-full w-full flex-col p-4",
        locked ? "cursor-not-allowed" : "",
        locked && !active && "opacity-50",
      )}
    >
      <div className="flex items-start gap-3">
        <AgentIcon type={agent.name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-base font-semibold">
              {agent.label || agent.name}
            </span>
            {agent.featured && (
              <Badge
                size="sm"
                variant="secondary"
                className="border-(--accent-border) bg-(--accent-bg) text-(--accent)"
              >
                {t("onboarding.flow.agentSelection.featured")}
              </Badge>
            )}
            <Badge size="sm" variant={agent.installed ? "success" : "muted"}>
              {agent.installed
                ? t("onboarding.flow.agentSelection.installed")
                : t("onboarding.flow.agentSelection.needsInstall")}
            </Badge>
          </div>
          <p className="m-0 mt-1.5 line-clamp-2 text-xs leading-relaxed text-(--text-secondary)">
            {agentDescription(agent.name, agent.description, t) ||
              t("onboarding.flow.agentSelection.noDescription")}
          </p>
        </div>
      </div>
      <div className="mt-3 pt-3 font-mono text-2xs text-(--text-tertiary)">
        {t(`onboarding.flow.authMode.${agent.authMode}`)}
        <span className="mx-1.5 opacity-60">·</span>
        {authRequirement(agent)}
      </div>
    </button>
  )
}
