import React from "react"
import { Download, RefreshCw, Trash2, Undo2, Wand2 } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@renderer/components/ui/button"
import { Skeleton } from "@renderer/components/ui/skeleton"
import { Spinner } from "@renderer/components/ui/spinner"
import type { CatalogEntry, InstalledAgentRecord } from "@renderer/types"
import type { InstallJob } from "@renderer/store/install"
import { isUpgradeAvailable } from "../../../../shared/version-compare"

import { isJobBusy } from "../entry-meta"

interface Props {
  entry: CatalogEntry
  /** This agent's installed/latest versions are still being read. */
  loading: boolean
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

const BUSY_LABEL: Record<InstallJob["verb"], string> = {
  install: "agents.actions.installing",
  update: "agents.actions.updating",
  uninstall: "agents.actions.uninstalling",
  rollback: "agents.actions.rollingBack",
}

/**
 * The rail's action stack. Full-width buttons in a fixed order — primary move
 * first, destructive last — so the same action never changes position between
 * two agents.
 *
 * Button matrix:
 *   not installed              → [Install]
 *   managed, update available  → [Update to v…] [Setup?] [Roll back?] [Uninstall]
 *   managed, up to date        → [Reinstall] [Setup?] [Roll back?] [Uninstall]
 *   global (unmanaged)         → [Reinstall] [Setup?]   (bundled npm can't
 *                                                        remove a system-wide
 *                                                        install)
 */
export function DetailActions({
  entry,
  loading,
  installed,
  job,
  latestVersion,
  currentVersion,
  onInstall,
  onUpdate,
  onUninstall,
  onRollback,
  onOpenWizard,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const isInstalled = entry.installed
  const isManaged = entry.managed !== false
  const busy = isJobBusy(job)
  const hasUpdate = isUpgradeAvailable(currentVersion, latestVersion)

  // A rollback target must be a DIFFERENT version than what's installed right
  // now; otherwise a stale `previousVersion` pointer keeps the button around
  // and "rolls back" by reinstalling the same version.
  const canRollback =
    (installed?.history || []).some(
      (h) => h.version && h.version !== currentVersion,
    ) ||
    (!!installed?.previousVersion && installed.previousVersion !== currentVersion)

  if (busy && job) {
    return (
      <Button variant="secondary" className="w-full" disabled>
        <Spinner />
        {t(BUSY_LABEL[job.verb])}
      </Button>
    )
  }

  // Which buttons belong here is decided by facts that arrive from IPC —
  // installed version, latest version, rollback history. Rendering the default
  // set meanwhile put "Reinstall" under an agent that had an update pending,
  // then swapped it out; the user opened this page BECAUSE of that update.
  // Placeholders until we know: only the count is guessed, from the catalog.
  if (loading) {
    return (
      <>
        {Array.from({ length: entry.installed ? 3 : 1 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </>
    )
  }

  return (
    <>
      {!isInstalled && (
        <Button className="w-full" onClick={onInstall}>
          <Download />
          {t("agents.actions.install")}
        </Button>
      )}

      {isInstalled && isManaged && hasUpdate && (
        <Button className="w-full" onClick={onUpdate}>
          <RefreshCw />
          {t("agents.actions.updateToVersion", { version: latestVersion })}
        </Button>
      )}

      {isInstalled && !(isManaged && hasUpdate) && (
        <Button variant="outline" className="w-full" onClick={onInstall}>
          <RefreshCw />
          {t("agents.actions.reinstall")}
        </Button>
      )}

      {isInstalled && onOpenWizard && (
        <Button variant="outline" className="w-full" onClick={onOpenWizard}>
          <Wand2 />
          {t("agents.actions.setupWizard")}
        </Button>
      )}

      {isInstalled && isManaged && canRollback && (
        <Button variant="outline" className="w-full" onClick={onRollback}>
          <Undo2 />
          {t("agents.actions.rollBack")}
        </Button>
      )}

      {isInstalled && isManaged && (
        <Button
          variant="destructive-ghost"
          className="w-full border border-destructive/25"
          onClick={onUninstall}
        >
          <Trash2 />
          {t("agents.actions.uninstall")}
        </Button>
      )}
    </>
  )
}
