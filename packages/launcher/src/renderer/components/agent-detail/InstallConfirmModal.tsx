import React from "react"
import { Trans, useTranslation } from "react-i18next"
import { ConfirmDialog } from "../ui-kit"
import AgentIcon from "../AgentIcon"
import { displayInstallCommand } from "../../../shared/npm-install-spec"
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
  // Show what will actually run, not what the registry literally says. An
  // update of a bare `npm install -g <pkg>` agent is dispatched with `@latest`
  // pinned (see AgentManager.updateAgentTypeStreaming) — without mirroring
  // that here, this dialog promises a command the launcher does not run.
  const installCmd = displayInstallCommand(
    entry.install?.[platformKey],
    verb,
  )
  const verbLabel = verb === "update"
    ? t("agents.installConfirm.update")
    : t("agents.installConfirm.install")
  const label = entry.label || entry.name

  return (
    <ConfirmDialog
      open={open}
      icon={<AgentIcon type={entry.name} size={40} />}
      title={t("agents.installConfirm.confirmTitle", {
        verb: verbLabel,
        name: label,
      })}
      description={
        <>
          {installCmd ? (
            <>{t("agents.installConfirm.willRunCommand")}</>
          ) : (
            <Trans
              i18nKey="agents.installConfirm.willInstall"
              values={{ verb: verbLabel.toLowerCase(), name: label }}
              components={{ 1: <strong className="text-foreground" /> }}
            />
          )}
          {installCmd && (
            <code className="mt-2 block rounded-md bg-muted px-2.5 py-1.5 text-center font-mono text-2xs break-all whitespace-pre-wrap text-foreground">
              {installCmd}
            </code>
          )}
        </>
      }
      confirmLabel={verbLabel}
      cancelLabel={t("agents.installConfirm.cancel")}
      destructive={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
