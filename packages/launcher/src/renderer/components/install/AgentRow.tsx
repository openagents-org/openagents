import React from "react"
import AgentIcon from "../AgentIcon"
import { Badge } from "../ui/Badge"
import { Button } from "../ui/Button"
import { cn } from "../../lib/utils"
import { stageOf } from "../install-progress/StagedProgress"
import type { CatalogEntry } from "../../types"
import type { InstallJob } from "../../store/install"

interface AgentRowProps {
  entry: CatalogEntry
  job: InstallJob | undefined
  hasUpdate: boolean
  onOpen: () => void
  onInstall: () => void
  onUninstall: () => void
}

/** List-view row — denser alternative to AgentCard for power users. */
export function AgentRow({
  entry,
  job,
  hasUpdate,
  onOpen,
  onInstall,
  onUninstall,
}: AgentRowProps): React.JSX.Element {
  const isComingSoon = !!entry.comingSoon
  const isInstalled = entry.installed
  const isManaged = entry.managed !== false
  const isBusy = !!job && job.phase !== "done" && job.phase !== "error"
  const verbLabel =
    job?.verb === "uninstall" ? "Uninstalling…"
    : job?.verb === "rollback" ? "Rolling back…"
    : job?.verb === "update" ? "Updating…"
    : "Installing…"
  const stage = stageOf(job)

  return (
    <div
      onClick={isComingSoon ? undefined : onOpen}
      role="button"
      tabIndex={isComingSoon ? -1 : 0}
      aria-disabled={isComingSoon}
      onKeyDown={(e) => { if (!isComingSoon && e.key === "Enter") onOpen() }}
      className={cn(
        "flex items-center gap-3.5 px-4 py-3",
        "bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm",
        "transition-all duration-150",
        isComingSoon
          ? "opacity-60 cursor-default"
          : "hover:shadow-md hover:border-(--border-hover) cursor-pointer",
      )}
    >
      <AgentIcon type={entry.name} size={32} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-(--text-primary) truncate">
            {entry.label || entry.name}
          </span>
          {entry.featured && <span className="text-[11px] text-(--accent)">★</span>}
        </div>
        {entry.description && (
          <span className="block mt-px text-[11.5px] text-(--text-tertiary) line-clamp-1">
            {entry.description}
          </span>
        )}
        <div className="flex flex-wrap gap-1 mt-1">
          {(entry.tags || []).slice(0, 4).map((t) => (
            <span
              key={t}
              className="text-[10px] px-[7px] py-0.5 rounded-[10px] bg-(--bg-input) text-(--text-secondary)"
            >
              {t}
            </span>
          ))}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {isBusy && stage && (
          <span className="text-[10.5px] text-(--accent)" title={job?.detail}>
            {stage.replace(/-/g, " ")}…
          </span>
        )}
        {isComingSoon ? (
          <Badge variant="default">Coming soon</Badge>
        ) : isInstalled ? (
          isManaged
            ? <Badge variant="success">Installed</Badge>
            : <Badge variant="info" title="Installed outside OpenAgents (system/global)">Global</Badge>
        ) : (
          <Badge variant="warning">Not installed</Badge>
        )}
        {hasUpdate && (
          <span className="text-[10px] px-[7px] py-0.5 rounded-[10px] bg-(--warning-bg) text-(--warning-text)">
            Update
          </span>
        )}
      </div>

      <div
        className="shrink-0 flex gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        {isComingSoon ? (
          <Button size="sm" disabled>Coming soon</Button>
        ) : isBusy ? (
          <Button size="sm" disabled>{verbLabel}</Button>
        ) : !isInstalled ? (
          <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); onInstall() }}>
            Install
          </Button>
        ) : isManaged ? (
          <>
            <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); onInstall() }}>
              Update
            </Button>
            <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); onUninstall() }}>
              Uninstall
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); onInstall() }}>
            Reinstall
          </Button>
        )}
      </div>
    </div>
  )
}
