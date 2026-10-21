import React from "react"

import { cn } from "@renderer/lib/utils"
import type {
  AgentUpdateTarget,
  CatalogEntry,
  InstalledAgentRecord,
} from "@renderer/types"

import { RailCard } from "./detail-section"
import { DependenciesCard, SystemRequirementsCard } from "./detail-requirements"
import { UnmanagedNotice } from "./detail-unmanaged-notice"

interface Props {
  entry: CatalogEntry
  installed: InstalledAgentRecord | null
  /** Where the CLI actually resolved to, for an install we do not manage. */
  binaryPath: string | null
  /** Where Update goes, for an install we do not manage; see useUpdateTarget. */
  updateTarget: AgentUpdateTarget | null
  className?: string
}

/**
 * Right-hand rail: the facts you check before acting on an agent. The actions
 * themselves sit under the header, on the side the page is read from. It does
 * not scroll with the main column.
 */
export function DetailRail({
  entry,
  installed,
  binaryPath,
  updateTarget,
  className,
}: Props): React.JSX.Element {
  // An install we did not place: the action row is missing Uninstall, and
  // only this can say why.
  const unmanaged = entry.installed && entry.managed === false

  return (
    <aside className={cn("flex flex-col gap-3", className)}>
      {unmanaged && (
        <RailCard>
          <UnmanagedNotice
            entry={entry}
            binaryPath={binaryPath}
            target={updateTarget}
          />
        </RailCard>
      )}

      <SystemRequirementsCard entry={entry} updatedAt={installed?.installedAt} />
      <DependenciesCard entry={entry} />
    </aside>
  )
}
