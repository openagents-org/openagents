import React from "react"
import { useTranslation } from "react-i18next"
import AgentIcon from "../AgentIcon"
import { Badge } from "../shadcn/badge"
import type { CatalogEntry, InstalledAgentRecord } from "../../types"

interface AgentHeaderProps {
  entry: CatalogEntry
  installed: InstalledAgentRecord | null
  currentVersion: string | null
  latestVersion: string | null
  homepage?: string
  github?: string
  docs?: string
  installedAtLabel?: string | null
}

/**
 * Top-of-page presentation block: icon, title, description, status badges,
 * version info, external links. Pure display — install/uninstall actions
 * live in AgentInstallActions so this can be reused on smaller surfaces.
 */
export function AgentHeader({
  entry,
  installed,
  currentVersion,
  latestVersion,
  homepage,
  github,
  docs,
  installedAtLabel,
}: AgentHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  const isInstalled = entry.installed
  const isManaged = entry.managed !== false
  const hasUpdate = !!(currentVersion && latestVersion && currentVersion !== latestVersion)

  const externals = [
    homepage && { label: homepage.replace(/^https?:\/\//, ""), url: homepage },
    github && { label: t("agents.header.github"), url: github },
    docs && { label: t("agents.header.docs"), url: docs },
  ].filter(Boolean) as Array<{ label: string; url: string }>

  return (
    <div className="flex items-start gap-4 pt-1 pb-3 border-b border-(--border)">
      <AgentIcon type={entry.name} size={56} />
      <div className="flex-1 min-w-0">
        <h2 className="text-xl font-bold tracking-tight m-0 mb-1 flex items-center gap-2">
          <span className="truncate">{entry.label || entry.name}</span>
          {entry.featured && (
            <span className="text-2xs text-(--accent)" title={t("agents.header.featured")}>★</span>
          )}
        </h2>
        <p className="text-sm text-(--text-secondary) leading-snug m-0 mb-2">
          {entry.description || t("agents.header.noDescription")}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {isInstalled ? (
            isManaged
              ? <Badge variant="success">{t("agents.header.installed")}</Badge>
              : <Badge variant="outline" title={t("agents.header.globalTitle")}>{t("agents.header.global")}</Badge>
          ) : (
            <Badge variant="warning">{t("agents.header.notInstalled")}</Badge>
          )}
          {hasUpdate && (
            <Badge variant="warning">{t("agents.header.updateAvailable", { version: latestVersion })}</Badge>
          )}
          {currentVersion && (
            <span className="text-2xs text-(--text-tertiary)">
              v{currentVersion}
            </span>
          )}
          {installedAtLabel && (
            <span
              className="text-2xs text-(--text-tertiary)"
              title={t("agents.header.installedAt")}
            >
              {installedAtLabel}
            </span>
          )}
          {(entry.tags || []).slice(0, 5).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-muted px-2 py-0.5 text-3xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
        {externals.length > 0 && (
          <div className="mt-2 flex items-center gap-3 flex-wrap text-2xs">
            {externals.map((e) => (
              <a
                key={e.url}
                href="#"
                onClick={(ev) => { ev.preventDefault(); window.api.openExternal(e.url) }}
              >
                {e.label} ↗
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
