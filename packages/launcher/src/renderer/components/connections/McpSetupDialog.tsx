import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Check } from "lucide-react"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Label } from "../ui/Label"
import type { PlatformDef } from "./platforms"
import type { ConnectionRecord, McpTargetState } from "../../types"
import type { ToastType } from "../../hooks/useToast"

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
}: {
  open: boolean
  onClose: () => void
  platform: PlatformDef
  connection: ConnectionRecord | null
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
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
    <Modal
      open={open}
      onClose={onClose}
      title={t("connections.mcp.title", { platform: platform.label })}
    >
      <div className="flex flex-col gap-4">
        <p className="text-[12px] text-(--text-secondary) m-0 leading-relaxed">
          {t("connections.mcp.description", { platform: platform.label })}
        </p>

        <div>
          <Label className="mb-1.5">{t("connections.mcp.targetsLabel")}</Label>
          {loading ? (
            <div className="text-[12px] text-(--text-tertiary) px-3 py-2 bg-(--bg-input) rounded-sm">
              {t("connections.mcp.loading")}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {targets.map((target) => {
                const active = selected.has(target.id)
                return (
                  <button
                    key={target.id}
                    type="button"
                    disabled={!!target.error}
                    onClick={() => toggle(target.id)}
                    className={`flex items-start gap-2.5 text-left px-3 py-2 rounded-sm border transition-all duration-150 ${
                      target.error
                        ? "bg-(--bg-input) border-transparent cursor-not-allowed opacity-70"
                        : active
                          ? "bg-(--accent-bg) border-(--accent-border) cursor-pointer"
                          : "bg-(--bg-input) border-transparent hover:border-(--accent-border) cursor-pointer"
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-3.5 h-3.5 shrink-0 rounded-[3px] flex items-center justify-center ${
                        active ? "bg-(--accent)" : "border border-(--border)"
                      }`}
                    >
                      {active && <Check className="w-2.5 h-2.5 text-white" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[12px] font-medium text-(--text-primary)">
                          {target.label}
                        </span>
                        {target.configured && (
                          <span className="text-[10px] text-(--success-text)">
                            {t("connections.mcp.alreadyConfigured")}
                          </span>
                        )}
                        {!target.detected && !target.error && (
                          <span className="text-[10px] text-(--text-tertiary)">
                            {t("connections.mcp.notDetected")}
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] text-(--text-tertiary) truncate mt-0.5">
                        {target.error
                          ? t("connections.mcp.unreadable", { detail: target.error })
                          : target.file}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="flex items-start gap-2 text-[11px] text-(--warning-text) bg-(--warning-bg) px-3 py-2 rounded-sm leading-relaxed">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{t("connections.mcp.secretWarning")}</span>
        </div>
      </div>

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t("connections.mcp.cancel")}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={busy || loading}>
          {busy ? t("connections.mcp.saving") : t("connections.mcp.save")}
        </Button>
      </ModalActions>
    </Modal>
  )
}
