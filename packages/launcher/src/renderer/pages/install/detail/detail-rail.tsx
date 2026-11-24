import React from "react"

import { cn } from "@renderer/lib/utils"
import type {
  AgentUpdateTarget,
  CatalogEntry,
  InstalledAgentRecord,
} from "@renderer/types"

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
    // Cards keep their own height: in the rail's height-capped scroller a
    // flex column squeezed them, and Card's overflow-hidden cut off the rows
    // and the ring along the bottom.
    <aside className={cn("flex flex-col gap-3 *:shrink-0", className)}>
      {/* The notice is an Alert, already a bordered box of its own; inside a
          RailCard it drew a second frame around itself. */}
      {unmanaged && (
        <UnmanagedNotice
          entry={entry}
          binaryPath={binaryPath}
          target={updateTarget}
        />
      )}

      <SystemRequirementsCard entry={entry} updatedAt={installed?.installedAt} />
      <DependenciesCard entry={entry} />
    </aside>
  )
}
