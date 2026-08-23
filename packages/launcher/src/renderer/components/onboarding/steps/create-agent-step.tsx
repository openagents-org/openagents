import React from "react"
import { Check, FolderOpen } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { cn } from "@renderer/lib/utils"
import type { OnboardingAgent } from "@renderer/types"

import { FieldLabel, SectionLabel } from "../onboarding-chrome"
import type { OnboardingAuthApi } from "../use-onboarding-auth"
import type { OnboardingProvisionApi } from "../use-onboarding-provision"

interface PreviewLine {
  text: string
  /** Ticked lines are things already true; the rest still need the user. */
  ok: boolean
}

export function CreateAgentStep({
  entry,
  auth,
  provision,
}: {
  entry: OnboardingAgent | null
  auth: OnboardingAuthApi
  provision: OnboardingProvisionApi
}): React.JSX.Element {
  const { t } = useTranslation()
  const { agentName, setAgentName, agentFolder, setAgentFolder, browseFolder } =
    provision
  const secret = entry?.envFields.find(
    (f) => f.password && (auth.values[f.name] || "").trim(),
  )
  const model = entry?.envFields.find(
    (f) => /model/i.test(f.name) && (auth.values[f.name] || "").trim(),
  )

  const authLine: PreviewLine = secret
    ? { text: `key ${secret.name} · ${t("onboarding.flow.launch.injected")}`, ok: true }
    : entry?.loginCommand
      ? {
          text: `auth ${entry.loginCommand} · ${
            auth.loggedIn
              ? t("onboarding.flow.launch.signedIn")
              : t("onboarding.flow.launch.signInPending")
          }`,
          ok: auth.loggedIn,
        }
      : { text: t("onboarding.flow.launch.noCredentials"), ok: true }

  // Where the agent will land: the workspace this device is paired with, or
  // local-only until connected from the Agents page.
  const wsLine: PreviewLine = provision.pairedWorkspace
    ? {
        text: t("onboarding.flow.launch.willConnect", {
          name:
            provision.pairedWorkspace.name || provision.pairedWorkspace.slug,
        }),
        ok: true,
      }
    : { text: t("onboarding.flow.launch.localOnly"), ok: false }

  const lines: PreviewLine[] = [
    authLine,
    model
      ? { text: `model ${auth.values[model.name]}`, ok: true }
      : {
          text: `instance ${agentName.trim() || t("onboarding.flow.launch.unnamed")}`,
          ok: !!agentName.trim(),
        },
    wsLine,
  ]

  return (
    <>
      <SectionLabel>{t("onboarding.flow.sections.instance")}</SectionLabel>

      <FieldLabel
        htmlFor="onboarding-agent-name"
        label={t("onboarding.flow.createAgent.nameLabel")}
        token="INSTANCE_ID"
      />
      <Input
        id="onboarding-agent-name"
        value={agentName}
        onChange={(e) => setAgentName(e.target.value)}
        placeholder={t("onboarding.flow.createAgent.namePlaceholder")}
      />
      <p className="mt-2 mb-0 text-2xs text-(--text-tertiary)">
        {t("onboarding.flow.createAgent.nameHint")}
      </p>

      <div className="mt-6">
        <FieldLabel
          htmlFor="onboarding-agent-folder"
          label={t("onboarding.flow.createAgent.folderLabel")}
          token="CWD"
        />
        <div className="flex items-center gap-2.5">
          <Input
            id="onboarding-agent-folder"
            className="flex-1 font-mono text-xs"
            value={agentFolder}
            onChange={(e) => setAgentFolder(e.target.value)}
            placeholder={t("onboarding.flow.createAgent.folderPlaceholder")}
          />
          <Button variant="outline" onClick={() => void browseFolder()}>
            <FolderOpen />
            {t("onboarding.flow.createAgent.browse")}
          </Button>
        </div>
        <p className="mt-2 mb-0 text-2xs text-(--text-tertiary)">
          {t("onboarding.flow.createAgent.folderHint")}
        </p>
      </div>

      <SectionLabel className="mt-9">
        {t("onboarding.flow.sections.launchPreview")}
      </SectionLabel>
      <div className="rounded-lg border border-(--border) bg-(--bg-card) p-4 font-mono text-xs">
        <div className="flex gap-2">
          <span className="text-(--accent)">$</span>
          <span className="break-all">
            openagents run {entry?.name || "agent"} --cwd{" "}
            {agentFolder.trim() || "~"}
          </span>
        </div>
        {lines.map((line) => (
          <div key={line.text} className="mt-2 flex gap-2">
            {line.ok ? (
              <Check className="mt-0.5 size-3 shrink-0 text-(--success)" />
            ) : (
              <span className="text-(--text-tertiary)">○</span>
            )}
            <span
              className={cn(
                "break-all",
                line.ok ? "text-(--text-secondary)" : "text-(--text-tertiary)",
              )}
            >
              {line.text}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
