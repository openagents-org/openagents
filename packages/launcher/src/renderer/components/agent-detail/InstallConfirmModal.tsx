import React from "react"
import { Trans, useTranslation } from "react-i18next"
import { Modal, ModalTitle } from "../ui/Modal"
import { Button } from "../ui/Button"
import AgentIcon from "../AgentIcon"
import type { CatalogEntry } from "../../types"

interface InstallConfirmModalProps {
  open: boolean
  verb: "install" | "update"
  entry: CatalogEntry | null
  onConfirm: () => void
  onCancel: () => void
}

function detectPlatform(): "macos" | "linux" | "windows" {
  if (typeof navigator === "undefined") return "linux"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("win")) return "windows"
  if (ua.includes("mac")) return "macos"
  return "linux"
}

/**
 * Two-step confirmation modal that mirrors launcher-legacy's
 * `installCatalogItem()` behaviour — surfacing the exact shell command that
 * is about to run on the user's machine so they can opt out before something
 * touches their PATH / system.
 *
 * Shown by:
 *   - AgentDetail (Install / Update button)
 *   - Install marketplace list (AgentCard / AgentRow primary action)
 */
export function InstallConfirmModal({
  open,
  verb,
  entry,
  onConfirm,
  onCancel,
}: InstallConfirmModalProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!entry) return null

  const platformKey = detectPlatform()
  const installCmd = entry.install?.[platformKey]
  const verbLabel = verb === "update"
    ? t("agents.installConfirm.update")
    : t("agents.installConfirm.install")
  const label = entry.label || entry.name

  return (
    <Modal open={open} onClose={onCancel}>
      <div className="flex flex-col items-center py-2">
        <AgentIcon type={entry.name} size={40} />
        <ModalTitle className="mt-3 text-center">
          {t("agents.installConfirm.confirmTitle", { verb: verbLabel, name: label })}
        </ModalTitle>
        <p className="hint mt-3 mb-2 text-center max-w-90">
          {installCmd ? (
            <>{t("agents.installConfirm.willRunCommand")}</>
          ) : (
            <Trans
              i18nKey="agents.installConfirm.willInstall"
              values={{ verb: verbLabel.toLowerCase(), name: label }}
              components={{ 1: <strong /> }}
            />
          )}
        </p>
        {installCmd && (
          <code className="text-[11.5px] px-2.5 py-1.5 bg-(--bg-input) text-(--text-primary) font-mono rounded-(--radius) max-w-[min(420px,80vw)] whitespace-pre-wrap break-all text-center">
            {installCmd}
          </code>
        )}
        <div className="form-actions justify-center mt-5">
          <Button variant="primary" data-testid="install-confirm" onClick={onConfirm}>
            {verbLabel}
          </Button>
          <Button data-testid="install-cancel" onClick={onCancel}>{t("agents.installConfirm.cancel")}</Button>
        </div>
      </div>
    </Modal>
  )
}
