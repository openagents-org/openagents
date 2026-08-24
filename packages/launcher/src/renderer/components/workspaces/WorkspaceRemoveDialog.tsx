import React, { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Checkbox } from "../ui/checkbox"
import { ConfirmDialog } from "../ui-kit"
import type { Workspace } from "../../types"

/** What removing does to THIS device — true whether or not the box is checked. */
const EFFECT_KEYS = [
  "workspaces.remove.effects.pairing",
  "workspaces.remove.effects.agents",
  "workspaces.remove.effects.local",
]

/**
 * Remove a workspace — from this device, and optionally from existence.
 *
 * There is no launcher-only removal any more: pairing is what connects a device
 * to a workspace, so a removal that left the pairing behind left the workspace
 * still listing this machine, still able to run commands on it, and no card in
 * the UI to unpair from. Removing therefore always deletes the server-side
 * pairing (and its credential) along with the local record — the bullet list
 * spells that out, because "remove" reads reversible and this is not.
 *
 * The checkbox is the second, far larger act: `DELETE /v1/workspaces/{id}`
 * takes the workspace away from **everyone**, recoverable only by an admin
 * flipping the row's status back, which no UI offers.
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
      // Destructive either way: unchecked still revokes this device's pairing
      // and unbinds its agents, so nothing here may read as a tidy-up.
      destructive
      busy={busy}
      onConfirm={() => onConfirm(deleteRemote)}
      onCancel={onCancel}
    >
      <ul className="space-y-1.5 rounded-md border bg-muted/40 px-3 py-2.5 text-xs leading-snug text-muted-foreground">
        {EFFECT_KEYS.map((key) => (
          <li key={key} className="flex items-start gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-current" />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>

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
