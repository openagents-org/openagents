import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Card } from "../ui/card"
import AgentIcon from "../AgentIcon"
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

const MAX_TAGS = 4

/** List-view row. Same actions as AgentCard, laid out horizontally. */
export function AgentRow({
  entry,
  job,
  hasUpdate,
  onOpen,
  onInstall,
  onUninstall,
}: AgentRowProps): React.JSX.Element {
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
        "flex-row items-center gap-3.5 px-4 py-3 transition-shadow",
        isComingSoon ? "cursor-default opacity-60" : "cursor-pointer hover:shadow-md",
      )}
    >
      <AgentIcon type={entry.name} size={32} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">
            {entry.label || entry.name}
          </span>
          {entry.featured && <span className="text-2xs text-primary">★</span>}
        </div>
        {entry.description && (
          <span className="mt-px line-clamp-1 block text-2xs text-muted-foreground">
            {entry.description}
          </span>
        )}
        <div className="mt-1 flex flex-wrap gap-1">
          {(entry.tags || []).slice(0, MAX_TAGS).map((tag) => (
            <Badge key={tag} variant="secondary" className="px-1.5 py-0 text-3xs">
              {tag}
            </Badge>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isBusy && stage && (
          <span className="text-3xs text-primary" title={job?.detail}>
            {t(`install.progress.stages.${stage}`)}…
          </span>
        )}
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
          <Badge variant="warning">{t("install.card.notInstalled")}</Badge>
        )}
        {hasUpdate && (
          <Badge variant="warning" className="px-1.5 py-0 text-3xs">
            {t("install.card.updateBadge")}
          </Badge>
        )}
      </div>

      <div className="flex shrink-0 gap-1.5" onClick={(e) => e.stopPropagation()}>
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
            <Button
              size="sm"
              variant="destructive-ghost"
              onClick={stop(onUninstall)}
            >
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
