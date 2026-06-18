import React, { useState } from "react"
import { Check, Copy, ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import type { CatalogEntry } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import { copyTextToClipboard } from "@renderer/lib/clipboard"

interface Props {
  entry: CatalogEntry
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * First-run commands. Three sources in priority order: the registry's
 * `quick_start` prose, its `example_commands`, and — when it supplies
 * neither — a pair derived from `install.binary` + `check_ready.login_command`,
 * which is what a first run actually looks like.
 *
 * Hidden entirely when there is nothing to say, rather than rendering a card
 * whose content is "no info".
 */
export function DetailQuickStart({ entry, showToast }: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)

  const prose = entry.quick_start?.trim() || ""
  const examples = (entry.example_commands || []).filter((e) => e?.cmd)
  const loginCmd = entry.check_ready?.login_command?.trim() || ""
  const binary = entry.install?.binary

  const derived: Array<{ cmd: string; description?: string }> = []
  if (examples.length === 0) {
    if (binary)
      derived.push({
        cmd: binary,
        description: t("agents.quickStart.launch", {
          name: entry.label || entry.name,
        }),
      })
    if (loginCmd)
      derived.push({ cmd: loginCmd, description: t("agents.quickStart.signInConfigure") })
  }
  const commands = examples.length > 0 ? examples : derived

  const docs = entry.docs || entry.homepage
  const links = [
    docs && { label: t("agents.quickStart.documentation"), url: docs },
    entry.github && { label: t("agents.quickStart.github"), url: entry.github },
  ].filter((l): l is { label: string; url: string } => !!l)

  if (!prose && commands.length === 0 && links.length === 0) return null

  async function copy(cmd: string): Promise<void> {
    try {
      await copyTextToClipboard(cmd)
      setCopied(cmd)
      window.setTimeout(() => setCopied((c) => (c === cmd ? null : c)), 1500)
    } catch {
      showToast(t("agents.quickStart.toast.copyFailed"), "error")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {prose && (
        <p className="m-0 max-w-prose text-xs leading-loose whitespace-pre-wrap text-muted-foreground">
          {prose}
        </p>
      )}

      {commands.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {commands.map((ex, i) => (
            <div key={`${ex.cmd}-${i}`} className="flex min-w-0 flex-col gap-1.5">
              {ex.description && (
                <span className="truncate text-2xs tracking-wider text-muted-foreground uppercase">
                  {ex.description}
                </span>
              )}
              <div className="flex items-center gap-2 rounded-lg border bg-card py-2 pr-2 pl-3">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">
                  {ex.cmd}
                </code>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => copy(ex.cmd)}
                  title={t("agents.quickStart.copyCommand")}
                  aria-label={t("agents.quickStart.copyCommand")}
                >
                  {copied === ex.cmd ? <Check className="text-success" /> : <Copy />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {links.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-2xs">
          {links.map((l) => (
            <a
              key={l.url}
              href="#"
              className="inline-flex items-center gap-1"
              onClick={(e) => {
                e.preventDefault()
                window.api.openExternal(l.url)
              }}
            >
              {l.label}
              <ExternalLink className="size-3" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
