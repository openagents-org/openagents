import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle } from "lucide-react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../shadcn/dialog"
import { Button } from "../shadcn/button"
import { Field, FieldLabel } from "../shadcn/field"
import { McpTargetList } from "./McpTargetList"
import type { PlatformDef } from "./platforms"
import type { ConnectionRecord, McpTargetState } from "../../types"
import type { ToastType } from "../../hooks/useToast"

interface Props {
  open: boolean
  onClose: () => void
  platform: PlatformDef
  connection: ConnectionRecord | null
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Registers the platform's hosted MCP server in each selected agent's own
 * config, so an agent that can't do anything with a bare API key still gets
 * usable tools.
 *
 * Ticking a row writes the entry; unticking a row that was already configured
 * removes it, so this dialog is the single place that owns the state.
 */
export function McpSetupDialog({
  open,
  onClose,
  platform,
  connection,
  showToast,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const [targets, setTargets] = useState<McpTargetState[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    void window.api.mcpListTargets(platform.id).then((list) => {
      setTargets(list)
      // Preselect what's already wired up, plus any agent we can see installed.
      setSelected(
        new Set(list.filter((x) => !x.error && (x.configured || x.detected)).map((x) => x.id)),
      )
      setLoading(false)
    })
  }, [open, platform.id])

  const toggle = (id: string): void => {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const handleSave = async (): Promise<void> => {
    if (!connection) return
    const add = targets.filter((x) => !x.error && selected.has(x.id)).map((x) => x.id)
    const drop = targets
      .filter((x) => !x.error && x.configured && !selected.has(x.id))
      .map((x) => x.id)
    if (add.length === 0 && drop.length === 0) {
      onClose()
      return
    }
    setBusy(true)
    try {
      const errors: string[] = []
      let changed = 0
      if (add.length > 0) {
        const res = await window.api.mcpApply({ connectionId: connection.id, targetIds: add })
        errors.push(...res.errors)
        changed += res.written.length
      }
      if (drop.length > 0) {
        const res = await window.api.mcpRemove({ platform: platform.id, targetIds: drop })
        errors.push(...res.errors)
        changed += res.written.length
      }
      if (errors.length > 0) {
        showToast(errors.join("; "), "error")
      } else {
        showToast(t("connections.mcp.toasts.saved", { count: changed }), "success")
        onClose()
      }
    } catch (err) {
      showToast(t("connections.toast.error", { message: (err as Error).message }), "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("connections.mcp.title", { platform: platform.label })}
          </DialogTitle>
          <DialogDescription>
            {t("connections.mcp.description", { platform: platform.label })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <Field>
            <FieldLabel>{t("connections.mcp.targetsLabel")}</FieldLabel>
            <McpTargetList
              targets={targets}
              selected={selected}
              loading={loading}
              onToggle={toggle}
            />
          </Field>

          <p className="flex items-start gap-2 rounded-sm bg-(--warning-bg) px-3 py-2 text-2xs leading-relaxed text-(--warning-text)">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{t("connections.mcp.secretWarning")}</span>
          </p>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("connections.mcp.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={busy || loading}>
            {busy ? t("connections.mcp.saving") : t("connections.mcp.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
