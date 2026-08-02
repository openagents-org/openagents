import React, { useState } from "react"
import { Trans, useTranslation } from "react-i18next"

import { ConfirmDialog } from "@renderer/components/ui-kit"
import { Checkbox } from "@renderer/components/ui/checkbox"
import AgentIcon from "@renderer/components/AgentIcon"
import type { CatalogEntry } from "@renderer/types"

interface Props {
  entry: CatalogEntry | null
  onConfirm: (wipeEnv: boolean) => void
  onCancel: () => void
}

export function UninstallDialog({
  entry,
  onConfirm,
  onCancel,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [wipeEnv, setWipeEnv] = useState(false)
  const name = entry?.label || entry?.name || ""

  const close = (): void => {
    setWipeEnv(false)
    onCancel()
  }

  return (
    <ConfirmDialog
      open={!!entry}
      icon={entry ? <AgentIcon type={entry.name} size={40} /> : undefined}
      title={t("install.uninstallModal.title", { name })}
      description={
        <Trans
          i18nKey="install.uninstallModal.description"
          values={{ name }}
          components={{ 1: <strong className="text-foreground" /> }}
        />
      }
      confirmLabel={t("install.uninstallModal.confirm")}
      cancelLabel={t("install.uninstallModal.cancel")}
      onConfirm={() => onConfirm(wipeEnv)}
      onCancel={close}
    >
      {/* A <label> makes the whole block a hit target while keeping the
          checkbox as the real control. */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-muted/40 px-3 py-2.5 transition-colors hover:bg-muted/70">
        <Checkbox
          checked={wipeEnv}
          onCheckedChange={(v) => setWipeEnv(v === true)}
          className="mt-0.5"
        />
        <span className="text-xs leading-snug text-muted-foreground">
          {t("install.uninstallModal.wipeEnv")}{" "}
          <span className="opacity-70">
            {t("install.uninstallModal.wipeEnvHint")}
          </span>
        </span>
      </label>
    </ConfirmDialog>
  )
}
