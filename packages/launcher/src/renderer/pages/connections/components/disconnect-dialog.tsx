import React from "react"
import { useTranslation } from "react-i18next"

import { ConfirmDialog } from "@renderer/components/ui-kit"
import { PlatformLogo } from "@renderer/components/connections/PlatformLogo"
import {
  PLATFORMS,
  platformLabel,
} from "@renderer/components/connections/platforms"
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
  const platform =
    PLATFORMS.find((p) => p.id === target?.platform) ?? PLATFORMS[0]

  return (
    <ConfirmDialog
      open={!!target}
      icon={target ? <PlatformLogo platform={platform} size={40} /> : undefined}
      title={
        target ? t("connections.disconnect.title", { platform: label }) : ""
      }
      description={
        <>
          {t("connections.disconnect.descriptionBefore")}
          <strong className="text-foreground">{label}</strong>
          {t("connections.disconnect.descriptionAfter")}
        </>
      }
      confirmLabel={t("connections.disconnect.confirm")}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
