import React from "react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/button"
import type { CatalogEntry, InstalledAgentRecord } from "../../types"
import type { InstallJob } from "../../store/install"
import { isUpgradeAvailable } from "../../../shared/version-compare"

interface AgentInstallActionsProps {
  entry: CatalogEntry
  installed: InstalledAgentRecord | null
  job: InstallJob | undefined
  latestVersion: string | null
  currentVersion: string | null
  onInstall: () => void
  onUpdate: () => void
  onUninstall: () => void
  onRollback: () => void
  onOpenWizard?: () => void
}

/**
 * Compact horizontal action group used as the top-right control rail of the
 * detail page (next to the agent header). Replaces the earlier sticky right
 * column to avoid full-width stretched buttons.
 *
 * Button matrix:
 *   not installed              → [Install]
 *   managed, update available  → [Update to v…] [Setup] [Roll back?] [Uninstall]
 *   managed, up to date        → [Setup] [Roll back?] [Uninstall]   (no Update —
 *                                                                    "Update" +
 *                                                                    "Up to date"
 *                                                                    was contradictory)
 *   global (unmanaged)         → [Reinstall] [Setup]                (no Uninstall —
 *                                                                    bundled npm
 *                                                                    can't remove
 *                                                                    a system-wide
 *                                                                    install)
 *
 * All buttons size to their content; Uninstall uses the destructive variant.
 */
export function AgentInstallActions({
  entry,
  installed,
  job,
  latestVersion,
  currentVersion,
  onInstall,
  onUpdate,
  onUninstall,
  onRollback,
  onOpenWizard,
}: AgentInstallActionsProps): React.JSX.Element {
  const { t } = useTranslation()
  const isInstalled = entry.installed
  const isManaged = entry.managed !== false
  const isBusy =
    !!job && job.phase !== "done" && job.phase !== "error"
  const hasUpdate = isUpgradeAvailable(currentVersion, latestVersion)
  // A valid rollback target must actually be a DIFFERENT version than what's
  // installed right now. Without that guard, a stale `previousVersion`
  // pointer (or a history entry equal to current) keeps the Roll back button
  // visible and "rolls back" by reinstalling the same version.
  const hasOtherHistory = (installed?.history || []).some(
    (h) => h.version && h.version !== currentVersion,
  )
  const hasOtherPrev =
    !!installed?.previousVersion && installed.previousVersion !== currentVersion
  const canRollback = hasOtherHistory || hasOtherPrev

  const busyLabel =
    job?.verb === "uninstall" ? t("agents.actions.uninstalling")
    : job?.verb === "rollback" ? t("agents.actions.rollingBack")
    : job?.verb === "update" ? t("agents.actions.updating")
    : t("agents.actions.installing")

  return (
    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
      {/* Not installed → single primary */}
      {!isInstalled && (
        <Button size="default" variant="default" onClick={onInstall} disabled={isBusy}>
          {isBusy ? busyLabel : t("agents.actions.install")}
        </Button>
      )}

      {/* Managed install with an actual update available */}
      {isInstalled && isManaged && hasUpdate && (
        <Button size="default" variant="default" onClick={onUpdate} disabled={isBusy}>
          {isBusy ? busyLabel : t("agents.actions.updateToVersion", { version: latestVersion })}
        </Button>
      )}

      {/* Global / unmanaged install — surface a Reinstall instead of Update */}
      {isInstalled && !isManaged && (
        <Button size="default" variant="default" onClick={onInstall} disabled={isBusy}>
          {isBusy ? busyLabel : t("agents.actions.reinstall")}
        </Button>
      )}

      {/* Secondary utilities (visible when installed in any mode) */}
      {isInstalled && onOpenWizard && (
        <Button size="default" variant="default" onClick={onOpenWizard} disabled={isBusy}>
          {t("agents.actions.setupWizard")}
        </Button>
      )}

      {isInstalled && isManaged && canRollback && (
        <Button size="default" variant="default" onClick={onRollback} disabled={isBusy}>
          {t("agents.actions.rollBack")}
        </Button>
      )}

      {/* Destructive at the end, proper variant — no fake ghost-with-red-text */}
      {isInstalled && isManaged && (
        <Button size="default" variant="destructive" onClick={onUninstall} disabled={isBusy}>
          {t("agents.actions.uninstall")}
        </Button>
      )}
    </div>
  )
}
