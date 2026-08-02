import React, { useState } from "react"
import { Trans, useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/shadcn/dialog"
import { Button } from "@renderer/components/shadcn/button"
import { Checkbox } from "@renderer/components/shadcn/checkbox"
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

  return (
    <Dialog
      open={!!entry}
      onOpenChange={(open) => {
        if (open) return
        setWipeEnv(false)
        onCancel()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="items-center text-center sm:text-center">
          {entry && <AgentIcon type={entry.name} size={40} />}
          <DialogTitle>{t("install.uninstallModal.title", { name })}</DialogTitle>
          <DialogDescription>
            <Trans
              i18nKey="install.uninstallModal.description"
              values={{ name }}
              components={{ 1: <strong className="text-foreground" /> }}
            />
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
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
        </DialogBody>

        <DialogFooter className="sm:justify-center">
          <Button variant="outline" onClick={onCancel}>
            {t("install.uninstallModal.cancel")}
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(wipeEnv)}>
            {t("install.uninstallModal.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
