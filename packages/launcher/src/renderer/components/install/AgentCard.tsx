import React from "react"
import { useTranslation } from "react-i18next"
import AgentIcon from "../AgentIcon"
import { Badge } from "../ui/Badge"
import { Button } from "../ui/Button"
import { cn } from "../../lib/utils"
import { stageOf } from "../install-progress/StagedProgress"
import type { CatalogEntry } from "../../types"
import type { InstallJob } from "../../store/install"

interface AgentCardProps {
  entry: CatalogEntry
  job: InstallJob | undefined
  hasUpdate: boolean
  onOpen: () => void
  onInstall: () => void
  onUninstall: () => void
}

/**
 * Grid-view tile, inspired by the Anaconda Navigator app cards in the
 * reference screenshot. Click anywhere → detail page. Inline Install /
 * Update / Uninstall buttons stop propagation so clicking them doesn't also
 * open the detail page.
 */
export function AgentCard({
  entry,
  job,
  hasUpdate,
  onOpen,
  onInstall,
  onUninstall,
}: AgentCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const isComingSoon = !!entry.comingSoon
  const isInstalled = entry.installed
  const isManaged = entry.managed !== false
  const isBusy = !!job && job.phase !== "done" && job.phase !== "error"
  const verbLabel =
    job?.verb === "uninstall" ? t("install.card.verb.uninstalling")
    : job?.verb === "rollback" ? t("install.card.verb.rollingBack")
    : job?.verb === "update" ? t("install.card.verb.updating")
    : t("install.card.verb.installing")
  const stage = stageOf(job)

  return (
    <div
      onClick={isComingSoon ? undefined : onOpen}
      role="button"
      tabIndex={isComingSoon ? -1 : 0}
      aria-disabled={isComingSoon}
      data-testid={`agent-card-${entry.name}`}
      data-installed={isInstalled ? "true" : "false"}
      data-busy={isBusy ? "true" : "false"}
      onKeyDown={(e) => { if (!isComingSoon && e.key === "Enter") onOpen() }}
      className={cn(
        "group flex flex-col gap-2.5 min-h-[170px] px-4.5 py-4",
        "bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm",
        "transition-all duration-200",
        isComingSoon
          ? "opacity-60 cursor-default"
          : "cursor-pointer hover:shadow-md hover:border-(--border-hover) hover:-translate-y-px",
      )}
    >
      <div className="flex items-center gap-2.5">
        <AgentIcon type={entry.name} size={36} />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-(--text-primary) truncate">
            {entry.label || entry.name}
          </div>
          {entry.featured && (
            <div className="text-[10.5px] text-(--accent)" title={t("install.card.featuredTitle")}>{t("install.card.featured")}</div>
          )}
        </div>
        {hasUpdate && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-[10px] bg-(--warning-bg) text-(--warning-text)"
            title={t("install.card.updateAvailable")}
          >
            {t("install.card.updateBadge")}
          </span>
        )}
      </div>

      <p className="text-[11.5px] text-(--text-secondary) leading-snug line-clamp-2 overflow-hidden m-0">
        {entry.description || t("install.card.noDescription")}
      </p>

      <div className="flex flex-wrap gap-1">
        {(entry.tags || []).slice(0, 3).map((t) => (
          <span
            key={t}
            className="text-[10px] px-[7px] py-0.5 rounded-[10px] bg-(--bg-input) text-(--text-secondary)"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between mt-auto text-[11px]">
        <div className="flex items-center gap-1.5">
          {isComingSoon ? (
            <Badge variant="default">{t("install.card.comingSoon")}</Badge>
          ) : isInstalled ? (
            isManaged
              ? <Badge variant="success">{t("install.card.installed")}</Badge>
              : <Badge variant="info" title={t("install.card.globalTitle")}>{t("install.card.global")}</Badge>
          ) : (
            <span className="text-(--text-tertiary)">{t("install.card.notInstalled")}</span>
          )}
        </div>
        {isBusy && stage && (
          <span className="text-[10.5px] text-(--accent) truncate" title={job?.detail}>
            {t(`install.progress.stages.${stage}`)}…
          </span>
        )}
      </div>

      <div
        className="flex gap-1.5 border-t border-(--border) pt-2.5 mt-0.5 [&>button]:flex-1 [&>button]:min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        {isComingSoon ? (
          <Button size="sm" disabled>{t("install.card.comingSoon")}</Button>
        ) : isBusy ? (
          <Button size="sm" disabled>{verbLabel}</Button>
        ) : !isInstalled ? (
          <Button size="sm" variant="primary" data-testid={`install-btn-${entry.name}`} onClick={(e) => { e.stopPropagation(); onInstall() }}>
            {t("install.card.install")}
          </Button>
        ) : isManaged ? (
          <>
            <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); onInstall() }}>
              {t("install.card.update")}
            </Button>
            <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); onUninstall() }}>
              {t("install.card.uninstall")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={(e) => { e.stopPropagation(); onInstall() }}>
            {t("install.card.reinstall")}
          </Button>
        )}
      </div>
    </div>
  )
}
