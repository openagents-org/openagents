import React from "react"
import { Download, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react"
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
  /**
   * The update can only be run by the user, as administrator — the rail's
   * notice hands them the command, so no button here pretends otherwise.
   */
  updateBlocked?: boolean
  onInstall: () => void
  onUpdate: () => void
  onUninstall: () => void
  onRollback: () => void
  /** Open the setup form on this type, installing it first if need be. */
  onAddAgent: () => void
}

const BUSY_LABEL: Record<InstallJob["verb"], string> = {
  install: "agents.actions.installing",
  update: "agents.actions.updating",
  uninstall: "agents.actions.uninstalling",
  rollback: "agents.actions.rollingBack",
}

/**
 * The page's action row, under the agent's name where the eye already is.
 * Buttons in a fixed order — primary move first, destructive last — so the
 * same action never changes position between two agents.
 *
 * Button matrix:
 *   not installed              → [Add agent] [Install only]
 *   managed, update available  → [Update to v…] [Add agent] [Roll back?] [Uninstall]
 *   managed, up to date        → [Add agent] [Reinstall] [Roll back?] [Uninstall]
 *   global (unmanaged), old    → [Update to v…] [Add agent]
 *   global (unmanaged), latest → [Add agent] [Reinstall]
 *   Add agent opens the same setup form as Connect Agents — the one way an
 *   agent is created; it installs the runtime first when it is missing, and a
 *   type already installed can be added again as another agent.
 *   An npm global install updates at its original install path; any other
 *   global install gets a managed copy. Uninstall never removes the user's copy.
 *   A user's copy that needs admin rights we cannot ask for: no update button.
 */
export function DetailActions({
  entry,
  loading,
  installed,
  job,
  latestVersion,
  currentVersion,
  updateBlocked = false,
  onInstall,
  onUpdate,
  onUninstall,
  onRollback,
  onAddAgent,
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
      <Button variant="secondary" size="lg" disabled>
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
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: entry.installed ? 3 : 1 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-32" />
        ))}
      </div>
    )
  }

  // The update leads while one is pending; otherwise adding an agent does.
  const updateFirst = isInstalled && hasUpdate && !updateBlocked
  const addAgent = (
    <Button variant={updateFirst ? "outline" : "default"} size="lg" className="min-w-40" onClick={onAddAgent}
      data-testid="detail-add-agent">
      <Plus />
      {t("agents.actions.addAgent")}
    </Button>
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      {updateFirst && (
        <Button size="lg" className="min-w-40" onClick={onUpdate}>
          <RefreshCw />
          {t("agents.actions.updateToVersion", { version: latestVersion })}
        </Button>
      )}

      {addAgent}

      {!isInstalled && (
        <Button variant="outline" size="lg" onClick={onInstall}>
          <Download />
          {t("agents.actions.installOnly")}
        </Button>
      )}

      {isInstalled && !hasUpdate && !updateBlocked && (
        <Button variant="outline" size="lg" onClick={onInstall}>
          <RefreshCw />
          {t("agents.actions.reinstall")}
        </Button>
      )}

      {isInstalled && isManaged && canRollback && (
        <Button variant="outline" size="lg" onClick={onRollback}>
          <Undo2 />
          {t("agents.actions.rollBack")}
        </Button>
      )}

      {isInstalled && isManaged && (
        <Button
          variant="destructive-ghost"
          size="lg"
          className="border border-destructive/25"
          onClick={onUninstall}
        >
          <Trash2 />
          {t("agents.actions.uninstall")}
        </Button>
      )}
    </div>
  )
}
