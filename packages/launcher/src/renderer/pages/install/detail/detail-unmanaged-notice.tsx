import React, { useState } from "react"
import { Check, Copy, Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { REGISTRY_PLATFORM } from "@renderer/lib/platform"
import { globalUninstallCommand } from "../../../../shared/npm-install-spec"
import type { AgentUpdateTarget, CatalogEntry } from "@renderer/types"

/**
 * What this screen does to an agent the user installed themselves.
 *
 * The launcher only removes what it put under `~/.openagents/`, so a copy the
 * user installed (npm -g, Homebrew, a vendor installer) has no Uninstall
 * button — and without a word about it, that reads as a broken page.
 *
 * Updating depends on how the copy was installed. An npm global install is
 * updated at its original install path (see main/agents/original-install),
 * asking for admin rights where the path needs them. Anything else cannot be
 * updated where it is, so Update installs a managed copy beside it — and then
 * there are two, which is why only that case offers the removal command.
 */
export function UnmanagedNotice({
  entry,
  binaryPath,
  target,
}: {
  entry: CatalogEntry
  /** Resolved from the health probe; absent when the probe hasn't answered. */
  binaryPath: string | null
  /** Where Update will go; null until the launcher has answered. */
  target: AgentUpdateTarget | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = entry.label || entry.name
  const original = target?.kind === "original" ? target : null
  const removeCommand =
    target?.kind === "managed"
      ? globalUninstallCommand(entry.install?.[REGISTRY_PLATFORM])
      : null

  return (
    <div className="rounded-lg border border-(--warning-border) bg-(--warning-bg) px-3.5 py-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-(--warning-text)" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-semibold text-(--warning-text)">
            {t("agents.unmanaged.title")}
          </p>
          {target && (
            <p className="m-0 mt-1 text-2xs leading-relaxed text-muted-foreground">
              {original
                ? t("agents.unmanaged.originalBody", { name })
                : t("agents.unmanaged.managedBody", { name })}
              {original?.elevation === "prompt" &&
                ` ${t("agents.unmanaged.adminPrompt")}`}
            </p>
          )}

          <PathLine
            label={t("agents.unmanaged.installPath")}
            value={original?.prefix || binaryPath}
          />

          {original?.elevation === "manual" && (
            <CommandBox
              hint={t("agents.unmanaged.adminManual")}
              command={original.command}
            />
          )}
          {removeCommand && (
            <CommandBox
              hint={t("agents.unmanaged.removeManually")}
              command={removeCommand}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function PathLine({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}): React.JSX.Element | null {
  if (!value) return null
  return (
    <p
      className="m-0 mt-2 truncate font-mono text-2xs text-muted-foreground"
      title={value}
    >
      <span className="font-sans">{label}</span>
      {value}
    </p>
  )
}

function CommandBox({
  hint,
  command,
}: {
  hint: string
  command: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* Clipboard denied — the command is on screen and selectable anyway. */
    }
  }

  return (
    <>
      <p className="m-0 mt-2.5 text-2xs text-muted-foreground">{hint}</p>
      <div className="mt-1.5 flex items-center gap-1.5 rounded-md border bg-card py-1 pr-1 pl-2.5">
        <code className="min-w-0 flex-1 truncate font-mono text-2xs" title={command}>
          {command}
        </code>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={copy}
          title={t("agents.quickStart.copyCommand")}
          aria-label={t("agents.quickStart.copyCommand")}
        >
          {copied ? <Check className="text-success" /> : <Copy />}
        </Button>
      </div>
    </>
  )
}
