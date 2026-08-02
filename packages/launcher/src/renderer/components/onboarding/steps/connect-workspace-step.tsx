import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Layers, Link2, Plus } from "lucide-react"
import { Input } from "../../shadcn/input"
import { cn } from "../../../lib/utils"
import { StepHeader } from "../onboarding-chrome"

export function ConnectWorkspaceStep({
  mode,
  setMode,
  workspaceName,
  setWorkspaceName,
  invite,
  setInvite,
}: {
  mode: "create" | "existing"
  setMode: (m: "create" | "existing") => void
  workspaceName: string
  setWorkspaceName: (v: string) => void
  invite: string
  setInvite: (v: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const options: Array<{
    id: "create" | "existing"
    icon: React.JSX.Element
    title: string
    desc: string
  }> = [
    {
      id: "existing",
      icon: <Link2 className="w-4 h-4" />,
      title: t("onboarding.flow.connectWorkspace.existingTitle"),
      desc: t("onboarding.flow.connectWorkspace.existingDesc"),
    },
    {
      id: "create",
      icon: <Plus className="w-4 h-4" />,
      title: t("onboarding.flow.connectWorkspace.createTitle"),
      desc: t("onboarding.flow.connectWorkspace.createDesc"),
    },
  ]
  return (
    <>
      <StepHeader
        icon={<Layers className="w-5 h-5" />}
        title={t("onboarding.flow.connectWorkspace.title")}
        subtitle={t("onboarding.flow.connectWorkspace.subtitle")}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-5">
        {options.map((o) => {
          const active = o.id === mode
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              className={cn(
                "text-left p-3 rounded-(--radius-sm) border bg-(--bg-card) cursor-pointer transition-colors",
                active
                  ? "border-(--accent) ring-2 ring-(--accent-border)"
                  : "border-(--border) hover:border-(--border-hover)",
              )}
            >
              <div className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
                <span className="text-(--accent)">{o.icon}</span>
                {o.title}
              </div>
              <div className="mt-1 text-2xs leading-snug text-(--text-secondary)">
                {o.desc}
              </div>
            </button>
          )
        })}
      </div>

      {mode === "create" ? (
        <>
          <label className="block text-xs font-medium mb-1.5">
            {t("onboarding.flow.workspace.nameLabel")}
          </label>
          <Input
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            placeholder={t("onboarding.flow.workspace.namePlaceholder")}
          />
          <p className="mt-3 text-2xs text-(--text-tertiary)">
            {t("onboarding.flow.workspace.hintPrefix")}
            <code className="inline-code">workspace.openagents.org</code>
            {t("onboarding.flow.connectWorkspace.createInputHint")}
          </p>
        </>
      ) : (
        <>
          <label className="block text-xs font-medium mb-1.5">
            {t("onboarding.flow.connectWorkspace.inviteLabel")}
          </label>
          <Input
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder={t("onboarding.flow.connectWorkspace.invitePlaceholder")}
          />
          <p className="mt-3 text-2xs text-(--text-tertiary)">
            {t("onboarding.flow.connectWorkspace.inviteHint")}
          </p>
        </>
      )}
    </>
  )
}
