import React, { useState } from "react"
import { Trans, useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import { Checkbox } from "@renderer/components/ui/checkbox"
import { ConfirmDialog } from "@renderer/components/ui-kit"
import type { CatalogEntry } from "@renderer/types"

interface Props {
  /** Non-null opens the dialog — the agent about to be removed. */
  entry: CatalogEntry | null
  onConfirm: (wipeEnv: boolean) => void
  onCancel: () => void
}

/**
 * Uninstall confirmation. Saved env is kept by default: an API key is
 * expensive to re-obtain and cheap to leave behind, so removing it is an
 * explicit opt-in rather than a side effect of uninstalling.
 */
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
      title={t("agents.detail.uninstallTitle", { name })}
      description={
        <Trans
          i18nKey="agents.detail.uninstallBody"
          values={{ name }}
          components={{ 1: <strong className="text-foreground" /> }}
        />
      }
      confirmLabel={t("agents.detail.uninstall")}
      cancelLabel={t("agents.detail.cancel")}
      onConfirm={() => {
        setWipeEnv(false)
        onConfirm(wipeEnv)
      }}
      onCancel={close}
    >
      {/* A <label> makes the whole block a hit target while the checkbox stays
          the real control. */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-muted/40 px-3 py-2.5 transition-colors hover:bg-muted/70">
        <Checkbox
          checked={wipeEnv}
          onCheckedChange={(v) => setWipeEnv(v === true)}
          className="mt-0.5"
        />
        <span className="text-xs leading-snug text-muted-foreground">
          {t("agents.detail.alsoRemoveEnv")}{" "}
          <span className="opacity-70">{t("agents.detail.alsoRemoveEnvHint")}</span>
        </span>
      </label>
    </ConfirmDialog>
  )
}
