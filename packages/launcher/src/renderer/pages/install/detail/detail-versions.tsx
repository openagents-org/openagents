import React, { useState } from "react"
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@renderer/components/ui/badge"
import { cn } from "@renderer/lib/utils"
import type { CatalogEntry } from "@renderer/types"

export interface VersionEntry {
  version: string
  date?: string
}

interface Props {
  versions: VersionEntry[]
  loading: boolean
  error?: string
  entry?: CatalogEntry
  currentVersion?: string | null
}

/** Recent history is the useful part; the rest is a wall nobody reads. */
export const MAX_VERSIONS = 5

/**
 * Version history. npm publishes no structured changelog, so a row expands to
 * the timestamp plus deep links to the canonical release notes rather than
 * pretending to summarise them.
 */
export function DetailVersions({
  versions,
  loading,
  error,
  entry,
  currentVersion,
}: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<string | null>(null)

  if (loading)
    return (
      <p className="m-0 text-xs text-muted-foreground">
        {t("agents.changelog.loading")}
      </p>
    )
  if (error && versions.length === 0)
    return <p className="m-0 text-xs text-muted-foreground">{error}</p>
  if (versions.length === 0) return null

  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
      {versions.slice(0, MAX_VERSIONS).map((v) => {
        const open = expanded === v.version
        const isCurrent = currentVersion === v.version
        return (
          <li key={v.version}>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setExpanded(open ? null : v.version)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                open ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {open ? (
                  <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-mono text-xs">v{v.version}</span>
                {isCurrent && (
                  <Badge variant="default" size="sm">
                    {t("agents.changelog.installed")}
                  </Badge>
                )}
              </span>
              {v.date && (
                <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                  {new Date(v.date).toLocaleDateString()}
                </span>
              )}
            </button>

            {open && <VersionLinks version={v} entry={entry} />}
          </li>
        )
      })}
    </ul>
  )
}

/** Deep links for one release — GitHub tag when derivable, npm otherwise. */
function VersionLinks({
  version,
  entry,
}: {
  version: VersionEntry
  entry?: CatalogEntry
}): React.JSX.Element {
  const { t } = useTranslation()
  const repo = [entry?.github, entry?.homepage]
    .filter((u): u is string => !!u)
    .map((u) => u.match(/github\.com\/([^/?#]+\/[^/?#]+)/i)?.[1])
    .find(Boolean)

  const links = [
    repo && {
      label: t("agents.changelog.releaseNotesGithub"),
      url: `https://github.com/${repo.replace(/\.git$/, "")}/releases/tag/v${version.version}`,
    },
    entry?.name && {
      label: t("agents.changelog.viewOnNpm"),
      url: `https://www.npmjs.com/package/${encodeURIComponent(entry.name)}/v/${encodeURIComponent(version.version)}`,
    },
  ].filter((l): l is { label: string; url: string } => !!l)

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-8 pt-1.5 pb-3 text-2xs">
      {version.date && (
        <span className="text-muted-foreground">
          {t("agents.changelog.released", {
            date: new Date(version.date).toLocaleString(),
          })}
        </span>
      )}
      {links.map((l) => (
        <a
          key={l.url}
          href="#"
          className="inline-flex items-center gap-1"
          onClick={(e) => {
            e.preventDefault()
            window.api.openExternal(l.url)
          }}
        >
          {l.label}
          <ExternalLink className="size-3" />
        </a>
      ))}
    </div>
  )
}
