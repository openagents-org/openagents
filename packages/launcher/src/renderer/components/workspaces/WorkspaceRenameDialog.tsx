import React, { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
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
import { Checkbox } from "../ui/checkbox"
import { Alert, AlertDescription, AlertTitle } from "../ui/alert"
import { Field, FieldDescription, FieldError, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import type { Workspace } from "../../types"

/** Which name the dialog actually changed, so the caller can react. */
export type RenameScope = "local" | "workspace"

/**
 * Rename a workspace. Two very different things behind one dialog:
 *
 * - **local** (default) — an alias in settings.json under
 *   `workspace-aliases:<id>`, read back by the Workspaces page. Nobody else
 *   sees it, and the server keeps its own name.
 * - **workspace** — PATCH /v1/workspaces/{id} through the main process, which
 *   renames it for every member. Opt-in via the checkbox, and warned about,
 *   because it reaches other people's screens.
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
  onSaved: (id: string, name: string, scope: RenameScope) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = useState("")
  const [remote, setRemote] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && workspace) {
      setName(workspace.name || workspace.slug || workspace.id)
      // Never carry the server-rename opt-in across openings: it must be a
      // deliberate choice every single time.
      setRemote(false)
      setError(null)
    }
  }, [open, workspace])

  const handleSave = async (): Promise<void> => {
    if (!workspace) return
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      if (remote) {
        const saved = await window.api.renameWorkspace(workspace.id, trimmed)
        // The real name now matches what the user typed, so a stale local
        // alias would only hide it. Empty string reads as "no alias".
        await window.api
          .setSetting(`workspace-aliases:${workspace.id}`, "")
          .catch(() => {})
        onSaved(workspace.id, saved.name || trimmed, "workspace")
      } else {
        await window.api.setSetting(
          `workspace-aliases:${workspace.id}`,
          trimmed,
        )
        onSaved(workspace.id, trimmed, "local")
      }
      onClose()
    } catch (e) {
      // Stay open on failure — the typed name and the opt-in are still there.
      setError(cleanIpcError((e as Error).message || ""))
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
              {t(
                remote
                  ? "workspaces.rename.labelRemote"
                  : "workspaces.rename.label",
              )}
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
              {t(
                remote
                  ? "workspaces.rename.hintRemote"
                  : "workspaces.rename.hint",
                { slug: workspace?.slug || workspace?.id },
              )}
            </FieldDescription>
          </Field>

          <Field orientation="horizontal" data-disabled={busy || undefined}>
            <Checkbox
              id="workspace-rename-remote"
              checked={remote}
              disabled={busy}
              onCheckedChange={(v) => {
                setRemote(v === true)
                setError(null)
              }}
            />
            <FieldLabel
              htmlFor="workspace-rename-remote"
              className="font-normal"
            >
              {t("workspaces.rename.applyRemote")}
            </FieldLabel>
          </Field>

          {remote && (
            <Alert>
              <AlertTriangle className="text-warning" />
              <AlertTitle>
                {t("workspaces.rename.remoteWarningTitle")}
              </AlertTitle>
              <AlertDescription>
                {t("workspaces.rename.remoteWarningBody", {
                  slug: workspace?.slug || workspace?.id,
                })}
              </AlertDescription>
            </Alert>
          )}

          {error && <FieldError>{error}</FieldError>}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("workspaces.rename.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={busy || !name.trim()}>
            {busy
              ? t("workspaces.rename.saving")
              : t(
                  remote
                    ? "workspaces.rename.saveRemote"
                    : "workspaces.rename.save",
                )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Electron wraps handler rejections; show the server's own message instead. */
function cleanIpcError(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim()
}
