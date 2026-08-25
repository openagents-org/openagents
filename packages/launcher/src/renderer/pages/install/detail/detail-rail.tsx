import React from "react"

import { cn } from "@renderer/lib/utils"
import type { CatalogEntry, InstalledAgentRecord } from "@renderer/types"
import type { InstallJob } from "@renderer/store/install"

import { DetailActions } from "./detail-actions"
import { RailCard } from "./detail-section"
import { DependenciesCard, SystemRequirementsCard } from "./detail-requirements"
import { UnmanagedNotice } from "./detail-unmanaged-notice"

interface Props {
  entry: CatalogEntry
  installed: InstalledAgentRecord | null
  job: InstallJob | undefined
  currentVersion: string | null
  latestVersion: string | null
  /** Where the CLI actually resolved to, for an install we do not manage. */
  binaryPath: string | null
  onInstall: () => void
  onUpdate: () => void
  onUninstall: () => void
  onRollback: () => void
  onOpenWizard?: () => void
  className?: string
}

/**
 * Right-hand rail: everything you *do* to an agent, and the facts you check
 * before doing it. It does not scroll with the main column — the primary
 * action stays put however far the document beside it runs.
 */
export function DetailRail({
  entry,
  installed,
  job,
  currentVersion,
  latestVersion,
  binaryPath,
  className,
  ...actions
}: Props): React.JSX.Element {
  // An install we did not place: the action list is about to be missing
  // Uninstall, and only this can say why.
  const unmanaged = entry.installed && entry.managed === false

  return (
    <aside className={cn("flex flex-col gap-3", className)}>
      <RailCard>
        <DetailActions
          entry={entry}
          installed={installed}
          job={job}
          currentVersion={currentVersion}
          latestVersion={latestVersion}
          {...actions}
        />
        {unmanaged && <UnmanagedNotice entry={entry} binaryPath={binaryPath} />}
      </RailCard>

      <SystemRequirementsCard entry={entry} updatedAt={installed?.installedAt} />
      <DependenciesCard entry={entry} />
    </aside>
  )
}
