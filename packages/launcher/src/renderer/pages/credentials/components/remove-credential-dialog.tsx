import React from "react"
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
} from "@renderer/components/shadcn/alert-dialog"
import { Spinner } from "@renderer/components/shadcn/spinner"
import { PlatformLogo } from "@renderer/components/connections/PlatformLogo"
import { getPlatform } from "@renderer/components/connections/platforms"
import type { CredentialSummary } from "@renderer/types"

interface Props {
  target: CredentialSummary | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function RemoveCredentialDialog({
  target,
  busy,
  onConfirm,
  onCancel,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const platform = target ? getPlatform(target.provider) : undefined

  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && !busy && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            {platform && <PlatformLogo platform={platform} size={40} />}
            <AlertDialogTitle>
              {target ? t("credentials.remove.title", { label: target.label }) : ""}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            {t("credentials.remove.descriptionPrefix")}{" "}
            <strong className="text-foreground">
              {t("credentials.remove.unauthorized")}
            </strong>
            {t("credentials.remove.descriptionSuffix")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t("ui.confirmDialog.cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            // Keep the dialog up while the delete runs so the busy state shows.
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {busy && <Spinner />}
            {t("credentials.remove.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
