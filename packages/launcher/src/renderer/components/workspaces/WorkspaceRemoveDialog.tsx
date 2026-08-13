import React, { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Checkbox } from "../ui/checkbox"
import { ConfirmDialog } from "../ui-kit"
import type { Workspace } from "../../types"

/**
 * Remove a workspace — from this launcher, or from existence.
 *
 * Those are not the same act, and this dialog is where they stopped being one
 * button. Unchecked (the default) drops the local record only; the workspace,
 * its channels and its other members are untouched and it can be re-added from
 * its link at any time. Checked calls `DELETE /v1/workspaces/{id}`, which takes
 * it away from **everyone** — recoverable only by an admin flipping the row's
 * status back, which no UI offers.
 */
export function WorkspaceRemoveDialog({
  workspace,
  displayName,
  busy,
  onConfirm,
  onCancel,
}: {
  /** Non-null opens the dialog — the workspace about to be removed. */
  workspace: Workspace | null
  displayName: string
  busy: boolean
  onConfirm: (deleteRemote: boolean) => void
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [deleteRemote, setDeleteRemote] = useState(false)

  // Destroying the workspace for everyone must be chosen every time, never
  // inherited from the last time this dialog was open.
  useEffect(() => {
    if (workspace) setDeleteRemote(false)
  }, [workspace])

  return (
    <ConfirmDialog
      open={!!workspace}
      title={t("workspaces.remove.title", { name: displayName })}
      description={t(
        deleteRemote
          ? "workspaces.remove.descriptionRemote"
          : "workspaces.remove.description",
      )}
      confirmLabel={t(
        deleteRemote ? "workspaces.remove.confirmRemote" : "workspaces.remove.confirm",
      )}
      // Destructive either way: the local half still unbinds every agent that
      // was in this workspace, and nothing about the button should suggest a
      // reversible tidy-up.
      destructive
      busy={busy}
      onConfirm={() => onConfirm(deleteRemote)}
      onCancel={onCancel}
    >
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border bg-muted/40 px-3 py-2.5 transition-colors hover:bg-muted/70">
        <Checkbox
          checked={deleteRemote}
          disabled={busy}
          onCheckedChange={(v) => setDeleteRemote(v === true)}
          className="mt-0.5"
        />
        <span className="text-xs leading-snug text-muted-foreground">
          {t("workspaces.remove.alsoDelete")}
        </span>
      </label>

      {deleteRemote && (
        <div className="flex items-start gap-2.5 rounded-md border border-(--danger-border) bg-(--danger-bg) px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-(--danger-text)" />
          <span className="text-xs leading-snug text-(--danger-text)">
            {t("workspaces.remove.alsoDeleteWarning")}
          </span>
        </div>
      )}
    </ConfirmDialog>
  )
}
