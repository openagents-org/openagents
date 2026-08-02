import React from "react"
import { useTranslation } from "react-i18next"

import type { WorkspaceStats } from "../use-workspaces-data"

interface Props {
  stats: WorkspaceStats
  starred: number
}

export function WorkspacesStats({ stats, starred }: Props): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="mb-4 flex items-center gap-3 text-2xs text-muted-foreground">
      <span>
        <span className="font-semibold text-(--success-text)">{stats.healthy}</span>{" "}
        {t("workspaces.stats.healthy")}
      </span>
      <span>·</span>
      <span>
        <span className="font-semibold text-(--warning-text)">{stats.warning}</span>{" "}
        {t("workspaces.stats.warning")}
      </span>
      <span>·</span>
      <span>
        <span className="font-semibold text-(--danger-text)">{stats.error}</span>{" "}
        {t("workspaces.stats.error")}
      </span>
      <span>·</span>
      <span>{t("workspaces.stats.total", { count: stats.total })}</span>
      {starred > 0 && (
        <>
          <span>·</span>
          <span>
            <span className="font-semibold text-(--warning-text)">{starred}</span>{" "}
            {t("workspaces.stats.starred")}
          </span>
        </>
      )}
    </div>
  )
}
