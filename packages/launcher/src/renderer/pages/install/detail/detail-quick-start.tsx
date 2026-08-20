import React, { useState } from "react"
import { Check, Copy } from "lucide-react"
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
 * neither — the one command worth deriving, `install.binary`.
 *
 * Hidden entirely when there is nothing to say, rather than rendering a card
 * whose content is "no info".
 */
export function DetailQuickStart({ entry, showToast }: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [copied, setCopied] = useState<string | null>(null)

  const prose = entry.quick_start?.trim() || ""
  const examples = (entry.example_commands || []).filter((e) => e?.cmd)
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
    // The login command is deliberately NOT derived here. The config section
    // now signs the user in with a button, so printing "copy `claude auth login`
    // into a terminal" a few hundred pixels below it isn't a second copy of the
    // same thing — it's the instruction the in-app flow exists to replace,
    // contradicting the button. Registry-authored example_commands are left
    // alone; this only drops the fallback we synthesise ourselves.
  }
  const commands = examples.length > 0 ? examples : derived

  // No links row here. It listed docs-or-homepage and GitHub, all three of
  // which DetailHeader already carries in the meta line under the agent's name
  // — and for the many entries with no `docs` of their own it fell back to
  // `homepage`, so the "Documentation" link at the bottom of the page was the
  // same URL as the domain printed at the top. One row of its own for a
  // duplicate of something 600px above it.
  if (!prose && commands.length === 0) return null

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
    </div>
  )
}
