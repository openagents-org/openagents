import React, { useState } from "react"
import { useTranslation } from "react-i18next"

import { TriangleAlert } from "lucide-react"
import { Alert, AlertTitle } from "@renderer/components/ui/alert"
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
 *
 * The remedies come from the core, which is not translated, so every piece of
 * prose is looked up by the key the core sends (`summaryKey`,
 * `alternativeKind`) and falls back to its English text. The commands
 * themselves are the core's, verbatim: they are platform-specific and must be
 * copyable exactly as shown.
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
    <Alert className="mt-3">
      <TriangleAlert className="text-destructive" />
      <AlertTitle>{t("install.progress.prereq.title")}</AlertTitle>
      <div className="col-start-2 flex min-w-0 flex-col">
        {missing.map((item) => (
          <div key={item.name} className="mt-3 flex flex-col gap-2">
            <p className="m-0 text-xs text-muted-foreground">
              {item.summaryKey
                ? t(`install.progress.prereq.summary.${item.summaryKey}`, {
                    defaultValue: item.summary,
                  })
                : item.summary}
            </p>

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
                label={
                  item.alternativeKind
                    ? t(
                        `install.progress.prereq.alternativeVia.${item.alternativeKind}`,
                        {
                          defaultValue: t(
                            "install.progress.prereq.alternative",
                          ),
                        },
                      )
                    : t("install.progress.prereq.alternative")
                }
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
                  <span className="text-xs text-muted-foreground">
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
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={onRetry}
          >
            {t("install.progress.prereq.retry")}
          </Button>
        )}
      </div>
    </Alert>
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
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-sm bg-muted px-2 py-1 text-xs whitespace-pre">
          {command}
        </code>
        <Button size="sm" variant="ghost" onClick={onCopy}>
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </div>
  )
}
