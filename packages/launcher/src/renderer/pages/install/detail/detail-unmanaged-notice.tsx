import React, { useState } from "react"
import { Check, Copy, Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { globalUninstallCommand } from "../../../../shared/npm-install-spec"
import type { CatalogEntry } from "@renderer/types"

function detectPlatform(): "macos" | "linux" | "windows" {
  if (typeof navigator === "undefined") return "linux"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("win")) return "windows"
  if (ua.includes("mac")) return "macos"
  return "linux"
}

/**
 * Why there is no Uninstall button on an agent that plainly says "installed".
 *
 * The launcher only removes what it put under `~/.openagents/`; a copy the user
 * installed globally (npm -g, homebrew, a vendor installer) stays on PATH, and
 * detection keeps reporting the agent as present. Without this the sequence
 * reads as a broken button: press Uninstall, watch it succeed, watch the card
 * still say "installed" — and now the button is gone too, because `managed`
 * flipped to false. Every part of that is correct and none of it was visible.
 *
 * So: say where the remaining copy is, say why this screen will not touch it,
 * and hand over the exact command that will.
 */
export function UnmanagedNotice({
  entry,
  binaryPath,
}: {
  entry: CatalogEntry
  /** Resolved from the health probe; absent when the probe hasn't answered. */
  binaryPath: string | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const command = globalUninstallCommand(entry.install?.[detectPlatform()])

  async function copy(): Promise<void> {
    if (!command) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* Clipboard denied — the command is on screen and selectable anyway. */
    }
  }

  return (
    <div className="rounded-lg border border-(--warning-border) bg-(--warning-bg) px-3.5 py-3">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-(--warning-text)" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-xs font-semibold text-(--warning-text)">
            {t("agents.unmanaged.title")}
          </p>
          <p className="m-0 mt-1 text-2xs leading-relaxed text-muted-foreground">
            {t("agents.unmanaged.body")}
          </p>

          {binaryPath && (
            <p
              className="m-0 mt-2 truncate font-mono text-2xs text-muted-foreground"
              title={binaryPath}
            >
              {binaryPath}
            </p>
          )}

          {command && (
            <>
              <p className="m-0 mt-2.5 text-2xs text-muted-foreground">
                {t("agents.unmanaged.removeManually")}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5 rounded-md border bg-card py-1 pr-1 pl-2.5">
                <code className="min-w-0 flex-1 truncate font-mono text-2xs">
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
          )}
        </div>
      </div>
    </div>
  )
}
