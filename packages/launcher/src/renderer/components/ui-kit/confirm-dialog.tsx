import * as React from "react"
import { useTranslation } from "react-i18next"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shadcn/alert-dialog"
import { Spinner } from "../shadcn/spinner"
import { buttonVariants } from "../shadcn/button"
import { cn } from "../../lib/utils"

export interface ConfirmDialogProps {
  open: boolean
  /** Optional glyph above the title (agent icon, platform logo…). */
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Centered confirmation prompt. Wraps AlertDialog because this exact shape
 * (icon + title + copy + one destructive action) recurs across the app and the
 * raw primitives take eight lines of boilerplate every time.
 */
export function ConfirmDialog({
  open,
  icon,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !busy && onCancel()}>
      {/* Default width, not `sm`: these carry install commands and paths
          that wrap badly at 20rem. */}
      <AlertDialogContent>
        <AlertDialogHeader>
          {icon}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {cancelLabel ?? t("ui.confirmDialog.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={cn(
              destructive && buttonVariants({ variant: "destructive" }),
            )}
            // Keep the dialog mounted while the action runs so `busy` is visible;
            // Radix would otherwise close on click.
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {busy && <Spinner />}
            {busy
              ? t("ui.confirmDialog.working")
              : (confirmLabel ?? t("ui.confirmDialog.confirm"))}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
