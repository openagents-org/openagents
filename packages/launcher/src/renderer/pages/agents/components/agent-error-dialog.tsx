import React, { useState } from "react"
import { AlertCircle, Check, Copy } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"

/**
 * The last error an agent reported, behind a one-glyph trigger.
 *
 * It used to sit inline under the status badge in the table. Daemon errors are
 * whole sentences (often a stack line or a shell command), so that second line
 * pushed rows past their fixed height and its `max-w` stole width from every
 * other column. The row now says only *that* something failed; the text itself
 * lives here, where it can wrap, scroll and be copied.
 */
export function AgentErrorDialog({
  agentName,
  message,
}: {
  agentName: string
  message: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard can be denied; the text is selectable either way.
    }
  }

  return (
    <>
      <Button
        size="icon-xs"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        aria-label={t("agents.list.error.view")}
        title={message}
        data-testid={`agent-error-${agentName}`}
        onClick={() => setOpen(true)}
      >
        <AlertCircle />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("agents.list.error.title", { name: agentName })}
            </DialogTitle>
          </DialogHeader>

          <DialogBody>
            <pre className="m-0 max-h-72 overflow-auto rounded-md border bg-muted p-3 font-mono text-2xs leading-relaxed break-words whitespace-pre-wrap">
              {message}
            </pre>
            <p className="mt-3 mb-0 text-2xs text-muted-foreground">
              {t("agents.list.error.hint")}
            </p>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />}
              {t(copied ? "agents.list.error.copied" : "agents.list.error.copy")}
            </Button>
            <Button onClick={() => setOpen(false)}>
              {t("agents.list.error.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
