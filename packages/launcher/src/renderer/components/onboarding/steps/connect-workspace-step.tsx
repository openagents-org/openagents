import React from "react"
import { ChevronRight, Link2, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Input } from "@renderer/components/ui/input"
import { cn } from "@renderer/lib/utils"

import {
  FieldLabel,
  InlineCode,
  SectionLabel,
  selectableCard,
} from "../onboarding-chrome"
import type {
  OnboardingProvisionApi,
  WorkspaceMode,
} from "../use-onboarding-provision"

const MODES: Array<{ id: WorkspaceMode; icon: React.ElementType }> = [
  { id: "existing", icon: Link2 },
  { id: "create", icon: Plus },
]

const BENEFIT_IDS = ["chat", "share", "history"] as const

export function ConnectWorkspaceStep({
  provision,
}: {
  provision: OnboardingProvisionApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const {
    wsMode,
    setWsMode,
    workspaceName,
    setWorkspaceName,
    wsInvite,
    setWsInvite,
  } = provision

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setWsMode(id)}
            aria-pressed={wsMode === id}
            className={cn(selectableCard(wsMode === id), "cursor-pointer p-4")}
          >
            <div className="flex items-center gap-2 text-base font-semibold">
              <Icon className="size-4 shrink-0 text-(--accent)" />
              {t(`onboarding.flow.connectWorkspace.${id}Title`)}
            </div>
            <p className="m-0 mt-1.5 text-xs leading-relaxed text-(--text-secondary)">
              {t(`onboarding.flow.connectWorkspace.${id}Desc`)}
            </p>
          </button>
        ))}
      </div>

      <SectionLabel className="mt-9">
        {t("onboarding.flow.sections.invitation")}
      </SectionLabel>

      {wsMode === "create" ? (
        <>
          <FieldLabel
            htmlFor="onboarding-workspace-name"
            label={t("onboarding.flow.workspace.nameLabel")}
            token="WORKSPACE_NAME"
          />
          <Input
            id="onboarding-workspace-name"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder={t("onboarding.flow.workspace.namePlaceholder")}
          />
          <p className="mt-2.5 mb-0 text-2xs text-(--text-tertiary)">
            {t("onboarding.flow.workspace.hintPrefix")}
            <InlineCode>workspace.openagents.org</InlineCode>
            {t("onboarding.flow.connectWorkspace.createInputHint")}
          </p>
        </>
      ) : (
        <>
          <FieldLabel
            htmlFor="onboarding-workspace-invite"
            label={t("onboarding.flow.connectWorkspace.inviteLabel")}
            token="WORKSPACE_TOKEN"
          />
          <Input
            id="onboarding-workspace-invite"
            className="font-mono text-xs"
            value={wsInvite}
            onChange={(e) => setWsInvite(e.target.value)}
            placeholder={t("onboarding.flow.connectWorkspace.invitePlaceholder")}
          />
          <p className="mt-2.5 mb-0 text-2xs text-(--text-tertiary)">
            {t("onboarding.flow.connectWorkspace.inviteHint")}
          </p>
        </>
      )}

      <div className="mt-7 rounded-lg border border-(--border) bg-(--bg-card) p-5">
        <div className="text-sm font-semibold">
          {t("onboarding.flow.connectWorkspace.benefitsTitle")}
        </div>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
          {BENEFIT_IDS.map((id) => (
            <li key={id} className="flex items-center gap-2 text-xs">
              <ChevronRight className="size-3.5 shrink-0 text-(--accent)" />
              <span className="text-(--text-secondary)">
                {t(`onboarding.flow.connectWorkspace.benefits.${id}`)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
