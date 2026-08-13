import * as React from "react"
import { useTranslation } from "react-i18next"
import { TriangleAlert } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "../ui/alert-dialog"
import { Spinner } from "../ui/spinner"

export interface ConfirmDialogProps {
  open: boolean
  /** Optional glyph above the title (agent icon, platform logo…). */
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  /** Handle for tests that need to reach this specific prompt's confirm. */
  confirmTestId?: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  /** Extra controls between the copy and the actions (an opt-in checkbox…). */
  children?: React.ReactNode
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
  confirmTestId,
  cancelLabel,
  destructive = true,
  busy = false,
  children,
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
          {/* Wrapped, not raw: the header grid reserves its media column off
              the `alert-dialog-media` slot, so a bare node would land in the
              title row and push the copy out of alignment.

              Destructive prompts with no glyph of their own get a warning mark
              — it reads as "this one is different" before the copy is. */}
          {icon ? (
            <AlertDialogMedia>{icon}</AlertDialogMedia>
          ) : destructive ? (
            <AlertDialogMedia className="size-11 bg-destructive/10 text-destructive">
              <TriangleAlert className="size-5" />
            </AlertDialogMedia>
          ) : null}
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {/* A column, not a bare wrapper: prompts that stack two blocks here —
            an opt-in checkbox and the warning that opt-in unlocks — had no gap
            between them at all and rendered as one welded box. */}
        {children && (
          <div className="flex shrink-0 flex-col gap-3">{children}</div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {cancelLabel ?? t("ui.confirmDialog.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid={confirmTestId}
            disabled={busy}
            // The `variant` prop, not a `buttonVariants()` class: AlertDialogAction
            // renders `<Button asChild>`, and Radix's Slot merges className by
            // concatenation with no twMerge — so a destructive class handed in
            // that way lands next to the default `bg-primary` and loses on CSS
            // order. That is why every delete prompt rendered purple.
            variant={destructive ? "destructive" : "default"}
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
