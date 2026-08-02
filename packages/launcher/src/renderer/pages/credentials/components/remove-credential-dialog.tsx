import React from "react"
import { useTranslation } from "react-i18next"

import { ConfirmDialog } from "@renderer/components/ui-kit"
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
    <ConfirmDialog
      open={!!target}
      icon={platform ? <PlatformLogo platform={platform} size={40} /> : undefined}
      title={target ? t("credentials.remove.title", { label: target.label }) : ""}
      description={
        <>
          {t("credentials.remove.descriptionPrefix")}{" "}
          <strong className="text-foreground">
            {t("credentials.remove.unauthorized")}
          </strong>
          {t("credentials.remove.descriptionSuffix")}
        </>
      }
      confirmLabel={t("credentials.remove.confirm")}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
