import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "../shadcn/badge"
import { Button } from "../shadcn/button"
import { Card } from "../shadcn/card"
import AgentIcon from "../AgentIcon"
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

const MAX_TAGS = 3

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
  const stage = stageOf(job)

  const verbLabel =
    job?.verb === "uninstall"
      ? t("install.card.verb.uninstalling")
      : job?.verb === "rollback"
        ? t("install.card.verb.rollingBack")
        : job?.verb === "update"
          ? t("install.card.verb.updating")
          : t("install.card.verb.installing")

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return (
    <Card
      onClick={isComingSoon ? undefined : onOpen}
      role="button"
      tabIndex={isComingSoon ? -1 : 0}
      aria-disabled={isComingSoon}
      data-testid={`agent-card-${entry.name}`}
      data-installed={isInstalled ? "true" : "false"}
      data-busy={isBusy ? "true" : "false"}
      onKeyDown={(e) => {
        if (!isComingSoon && e.key === "Enter") onOpen()
      }}
      className={cn(
        "min-h-42 gap-2.5 px-4 py-4 transition-all",
        isComingSoon
          ? "cursor-default opacity-60"
          : "cursor-pointer hover:-translate-y-px hover:shadow-md",
      )}
    >
      <div className="flex items-center gap-2.5">
        <AgentIcon type={entry.name} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {entry.label || entry.name}
          </div>
          {entry.featured && (
            <div className="text-3xs text-primary" title={t("install.card.featuredTitle")}>
              {t("install.card.featured")}
            </div>
          )}
        </div>
        {hasUpdate && (
          <Badge variant="warning" className="text-3xs" title={t("install.card.updateAvailable")}>
            {t("install.card.updateBadge")}
          </Badge>
        )}
      </div>

      <p className="m-0 line-clamp-2 overflow-hidden text-2xs leading-snug text-muted-foreground">
        {entry.description || t("install.card.noDescription")}
      </p>

      <div className="flex flex-wrap gap-1">
        {(entry.tags || []).slice(0, MAX_TAGS).map((tag) => (
          <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-3xs">
            {tag}
          </Badge>
        ))}
      </div>

      <div className="mt-auto flex items-center justify-between text-2xs">
        <div className="flex items-center gap-1.5">
          {isComingSoon ? (
            <Badge variant="secondary">{t("install.card.comingSoon")}</Badge>
          ) : isInstalled ? (
            isManaged ? (
              <Badge variant="success">{t("install.card.installed")}</Badge>
            ) : (
              <Badge variant="outline" title={t("install.card.globalTitle")}>
                {t("install.card.global")}
              </Badge>
            )
          ) : (
            <span className="text-muted-foreground">
              {t("install.card.notInstalled")}
            </span>
          )}
        </div>
        {isBusy && stage && (
          <span className="truncate text-3xs text-primary" title={job?.detail}>
            {t(`install.progress.stages.${stage}`)}…
          </span>
        )}
      </div>

      <div
        className="mt-0.5 flex gap-1.5 border-t pt-2.5 [&>button]:min-w-0 [&>button]:flex-1"
        onClick={(e) => e.stopPropagation()}
      >
        {isComingSoon ? (
          <Button size="sm" variant="secondary" disabled>
            {t("install.card.comingSoon")}
          </Button>
        ) : isBusy ? (
          <Button size="sm" variant="secondary" disabled>
            {verbLabel}
          </Button>
        ) : !isInstalled ? (
          <Button
            size="sm"
            data-testid={`install-btn-${entry.name}`}
            onClick={stop(onInstall)}
          >
            {t("install.card.install")}
          </Button>
        ) : isManaged ? (
          <>
            <Button size="sm" onClick={stop(onInstall)}>
              {t("install.card.update")}
            </Button>
            <Button size="sm" variant="destructive" onClick={stop(onUninstall)}>
              {t("install.card.uninstall")}
            </Button>
          </>
        ) : (
          <Button size="sm" onClick={stop(onInstall)}>
            {t("install.card.reinstall")}
          </Button>
        )}
      </div>
    </Card>
  )
}
