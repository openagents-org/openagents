import React, { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import type { PrereqRemedy } from "@renderer/types"

interface Props {
  missing: PrereqRemedy[]
  onRetry?: () => void
}

/**
 * What the user sees when an install was refused before it started, because
 * the machine is missing something the agent's installer needs.
 *
 * This exists because the alternative is worse than useless: hermes's install
 * script reacts to a missing git by opening a bare macOS dialog nobody asked
 * for and then polling silently for fifteen minutes. Here the requirement is
 * named, the command is copyable, and on macOS the same Apple installer can be
 * opened deliberately — with a Retry sitting next to it.
 */
export function InstallPrereqNotice({ missing, onRetry }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)
  const [cltState, setCltState] = useState<"idle" | "requested" | "failed">("idle")

  const copy = (value: string): void => {
    void navigator.clipboard.writeText(value)
    setCopied(value)
    window.setTimeout(() => setCopied((c) => (c === value ? null : c)), 2000)
  }

  const requestClt = async (): Promise<void> => {
    try {
      const result = await window.api.installXcodeCommandLineTools()
      setCltState(result?.ok ? "requested" : "failed")
    } catch {
      setCltState("failed")
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-(--danger-border) bg-(--danger-bg) p-4">
      <p className="m-0 text-sm font-medium text-foreground">
        {t("install.progress.prereq.title")}
      </p>

      {missing.map((item) => (
        <div key={item.name} className="mt-3 flex flex-col gap-2">
          <p className="m-0 text-xs text-muted-foreground">{item.summary}</p>

          <CommandRow
            label={t("install.progress.prereq.installCommand")}
            command={item.command}
            copied={copied === item.command}
            onCopy={() => copy(item.command)}
            copyLabel={t("install.progress.prereq.copyCommand")}
            copiedLabel={t("install.progress.prereq.copied")}
          />

          {item.alternative && (
            <CommandRow
              label={t("install.progress.prereq.alternative")}
              command={item.alternative}
              copied={copied === item.alternative}
              onCopy={() => copy(item.alternative as string)}
              copyLabel={t("install.progress.prereq.copyCommand")}
              copiedLabel={t("install.progress.prereq.copied")}
            />
          )}

          {item.action === "install-xcode-clt" && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void requestClt()}>
                {t("install.progress.prereq.installClt")}
              </Button>
              {cltState !== "idle" && (
                <span className="text-2xs text-muted-foreground">
                  {t(
                    cltState === "requested"
                      ? "install.progress.prereq.cltRequested"
                      : "install.progress.prereq.cltFailed",
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      ))}

      {onRetry && (
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          {t("install.progress.prereq.retry")}
        </Button>
      )}
    </div>
  )
}

interface CommandRowProps {
  label: string
  command: string
  copied: boolean
  onCopy: () => void
  copyLabel: string
  copiedLabel: string
}

function CommandRow({
  label,
  command,
  copied,
  onCopy,
  copyLabel,
  copiedLabel,
}: CommandRowProps): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-sm bg-muted px-2 py-1 text-2xs whitespace-pre">
          {command}
        </code>
        <Button size="sm" variant="ghost" onClick={onCopy}>
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  )
}
