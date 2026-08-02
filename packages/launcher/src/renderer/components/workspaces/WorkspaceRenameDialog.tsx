import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { Field, FieldDescription, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import type { Workspace } from "../../types"

/**
 * Rename a workspace locally. The launcher's connector doesn't expose a
 * server-side rename today, so this writes to settings.json under
 * `workspace-aliases:<id>` and the Workspaces page reads it back. Falls back
 * to the connector's name when no alias is set.
 *
 * stage.md §4.1 — "Workspace 操作 / 编辑".
 */
export function WorkspaceRenameDialog({
  open,
  workspace,
  onClose,
  onSaved,
}: {
  open: boolean
  workspace: Workspace | null
  onClose: () => void
  onSaved: (id: string, name: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && workspace) {
      setName(workspace.name || workspace.slug || workspace.id)
    }
  }, [open, workspace])

  const handleSave = async (): Promise<void> => {
    if (!workspace) return
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      await window.api.setSetting(`workspace-aliases:${workspace.id}`, trimmed)
      onSaved(workspace.id, trimmed)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("workspaces.rename.title")}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <Field>
            <FieldLabel htmlFor="workspace-rename">
              {t("workspaces.rename.label")}
            </FieldLabel>
            <Input
              id="workspace-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleSave()}
              autoFocus
              placeholder={t("workspaces.rename.placeholder")}
            />
            <FieldDescription>
              {t("workspaces.rename.hint", {
                slug: workspace?.slug || workspace?.id,
              })}
            </FieldDescription>
          </Field>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("workspaces.rename.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={busy || !name.trim()}>
            {busy ? t("workspaces.rename.saving") : t("workspaces.rename.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
