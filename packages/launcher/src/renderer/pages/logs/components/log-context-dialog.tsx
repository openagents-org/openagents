import React, { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import type { ParsedLog } from "@renderer/services/logs/log-parser"

/** Raw lines shown either side of the entry. */
const CONTEXT_LINES = 25

interface Props {
  entry: ParsedLog | null
  /** Unfiltered buffer — context is about the file, not the current filter. */
  lines: string[]
  onClose: () => void
  onCopy: (text: string) => void
}

/**
 * Shows the entry back in its raw surroundings: filters hide the lines that
 * usually explain a failure, so "show context" reads straight from the buffer.
 */
export function LogContextDialog({
  entry,
  lines,
  onClose,
  onCopy,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const anchorRef = useRef<HTMLDivElement>(null)

  const start = entry ? Math.max(0, entry.id - CONTEXT_LINES) : 0
  const end = entry ? Math.min(lines.length, entry.id + CONTEXT_LINES + 1) : 0
  const slice = entry ? lines.slice(start, end) : []
  const focusOffset = entry ? entry.id - start : 0
  const stackEnd = entry ? focusOffset + entry.stack.length : 0

  useEffect(() => {
    if (entry) anchorRef.current?.scrollIntoView({ block: "center" })
  }, [entry])

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("logs.context.title")}</DialogTitle>
          <DialogDescription>
            {t("logs.context.description", { count: CONTEXT_LINES })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <pre className="m-0 font-mono text-2xs leading-relaxed">
            {slice.map((line, i) => {
              const focused = i >= focusOffset && i <= stackEnd
              return (
                <div
                  key={start + i}
                  ref={i === focusOffset ? anchorRef : undefined}
                  className={cn(
                    "-mx-2 flex gap-3 px-2 wrap-break-word whitespace-pre-wrap",
                    focused && "rounded-sm bg-primary/10",
                  )}
                >
                  <span className="shrink-0 text-muted-foreground tabular-nums select-none">
                    {start + i + 1}
                  </span>
                  <span className="min-w-0 flex-1">{line}</span>
                </div>
              )
            })}
          </pre>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onCopy(slice.join("\n"))}>
            {t("logs.context.copyAll")}
          </Button>
          <Button onClick={onClose}>{t("logs.context.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
