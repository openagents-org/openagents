import React from "react"

import { Separator } from "@renderer/components/ui/separator"
import { cn } from "@renderer/lib/utils"
import type { CatalogEntry, InstalledAgentRecord } from "@renderer/types"
import type { InstallJob } from "@renderer/store/install"
import type { UpdateChannel } from "@renderer/hooks/useAgentChannel"

import { ChannelSelector } from "./channel-selector"
import { DetailActions } from "./detail-actions"
import { RailCard } from "./detail-section"
import { DependenciesCard, SystemRequirementsCard } from "./detail-requirements"

interface Props {
  entry: CatalogEntry
  installed: InstalledAgentRecord | null
  job: InstallJob | undefined
  currentVersion: string | null
  latestVersion: string | null
  channel: UpdateChannel
  onChannelChange: (next: UpdateChannel) => void
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
  channel,
  onChannelChange,
  className,
  ...actions
}: Props): React.JSX.Element {
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
        {/* The channel only decides what a *future* update pulls, so it sits
            below the actions rather than among them. */}
        {entry.managed !== false && (
          <>
            <Separator />
            <ChannelSelector value={channel} onChange={onChannelChange} />
          </>
        )}
      </RailCard>

      <SystemRequirementsCard entry={entry} updatedAt={installed?.installedAt} />
      <DependenciesCard entry={entry} />
    </aside>
  )
}
