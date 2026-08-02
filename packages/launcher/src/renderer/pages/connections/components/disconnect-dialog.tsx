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
import { PLATFORMS, platformLabel } from "@renderer/components/connections/platforms"
import type { ConnectionRecord } from "@renderer/types"

interface Props {
  target: ConnectionRecord | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DisconnectDialog({
  target,
  busy,
  onConfirm,
  onCancel,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const label = target ? platformLabel(target.platform) : ""
  const platform = PLATFORMS.find((p) => p.id === target?.platform) ?? PLATFORMS[0]

  return (
    <AlertDialog open={!!target} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            {target && <PlatformLogo platform={platform} size={40} />}
            <AlertDialogTitle>
              {target ? t("connections.disconnect.title", { platform: label }) : ""}
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription>
            {t("connections.disconnect.descriptionBefore")}
            <strong className="text-foreground">{label}</strong>
            {t("connections.disconnect.descriptionAfter")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("ui.confirmDialog.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            // Keep the dialog mounted while the disconnect runs: Radix closes
            // on action by default, which would hide the busy state.
            onClick={(e) => {
              e.preventDefault()
              onConfirm()
            }}
          >
            {busy && <Spinner />}
            {t("connections.disconnect.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
