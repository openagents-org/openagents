import React, { useState } from "react"
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
import { Field, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in *local* time, not ISO/UTC. */
function toDateTimeLocalValue(date: Date): string {
  const pad = (v: number): string => String(v).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function defaultClearRange(): { start: string; end: string } {
  const now = new Date()
  return {
    start: toDateTimeLocalValue(new Date(now.getTime() - 60 * 60 * 1000)),
    end: toDateTimeLocalValue(now),
  }
}

interface Props {
  open: boolean
  onClose: () => void
  /** Resolves to an error message, or null when the delete succeeded. */
  onConfirm: (startIso: string, endIso: string) => Promise<string | null>
}

export function ClearLogsDialog({ open, onClose, onConfirm }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [range, setRange] = useState(defaultClearRange)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    const start = range.start ? new Date(range.start) : null
    const end = range.end ? new Date(range.end) : null
    if (!start || isNaN(start.getTime()) || !end || isNaN(end.getTime())) {
      setError(t("logs.clearModal.errors.invalidRange"))
      return
    }
    if (start.getTime() > end.getTime()) {
      setError(t("logs.clearModal.errors.startAfterEnd"))
      return
    }
    setBusy(true)
    setError("")
    const failure = await onConfirm(start.toISOString(), end.toISOString())
    setBusy(false)
    if (failure) setError(failure)
    else onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setRange(defaultClearRange())
          setError("")
        } else onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("logs.clearModal.title")}</DialogTitle>
          <DialogDescription>{t("logs.clearModal.description")}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Field>
            <FieldLabel htmlFor="clear-start">
              {t("logs.clearModal.startTime")}
            </FieldLabel>
            <Input
              id="clear-start"
              type="datetime-local"
              value={range.start}
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="clear-end">{t("logs.clearModal.endTime")}</FieldLabel>
            <Input
              id="clear-end"
              type="datetime-local"
              value={range.end}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
            />
          </Field>
          {error && <p className="text-xs text-(--danger-text)">{error}</p>}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("logs.clearModal.cancel")}
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy}>
            {busy ? t("logs.clearModal.deleting") : t("logs.clearModal.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
