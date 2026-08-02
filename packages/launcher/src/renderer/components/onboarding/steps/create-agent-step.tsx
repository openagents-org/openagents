import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Cpu, FolderOpen } from "lucide-react"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { StepHeader } from "../onboarding-chrome"

export function CreateAgentStep({
  agentLabel,
  name,
  setName,
  folder,
  setFolder,
  onBrowse,
}: {
  agentLabel: string
  name: string
  setName: (v: string) => void
  folder: string
  setFolder: (v: string) => void
  onBrowse: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <StepHeader
        icon={<Cpu className="w-5 h-5" />}
        title={t("onboarding.flow.createAgent.title")}
        subtitle={t("onboarding.flow.createAgent.subtitle", {
          label: agentLabel || t("onboarding.flow.apiKey.thisAgent"),
        })}
      />
      <label className="block text-xs font-medium mb-1.5">
        {t("onboarding.flow.createAgent.nameLabel")}
      </label>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("onboarding.flow.createAgent.namePlaceholder")}
      />
      <p className="mt-1.5 text-2xs text-(--text-tertiary)">
        {t("onboarding.flow.createAgent.nameHint")}
      </p>

      <label className="block text-xs font-medium mb-1.5 mt-5">
        {t("onboarding.flow.createAgent.folderLabel")}
      </label>
      <div className="flex items-center gap-2">
        <Input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder={t("onboarding.flow.createAgent.folderPlaceholder")}
          className="flex-1"
        />
        <Button size="sm" variant="ghost" onClick={onBrowse}>
          <FolderOpen className="w-3.5 h-3.5" />{" "}
          {t("onboarding.flow.createAgent.browse")}
        </Button>
      </div>
      <p className="mt-1.5 text-2xs text-(--text-tertiary)">
        {t("onboarding.flow.createAgent.folderHint")}
      </p>
    </>
  )
}
