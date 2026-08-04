import React from "react"
import { ExternalLink } from "lucide-react"
import { useTranslation } from "react-i18next"

import AgentIcon from "@renderer/components/AgentIcon"
import type { CatalogEntry } from "@renderer/types"
import { isUpgradeAvailable } from "../../../../shared/version-compare"

import { describeEntry, entryStatus } from "../entry-meta"
import { AgentStatusBadge } from "../components/agent-status-badge"

interface Props {
  entry: CatalogEntry
  currentVersion: string | null
  latestVersion: string | null
  homepage?: string
  github?: string
  docs?: string
  installedAtLabel?: string | null
}

/**
 * Identity block: who this agent is, what state it's in, which version is on
 * the machine and where to read more. Pure display — the install actions sit
 * in the right rail so this stays reusable on narrower surfaces.
 */
export function DetailHeader({
  entry,
  currentVersion,
  latestVersion,
  homepage,
  github,
  docs,
  installedAtLabel,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const status = entryStatus(
    entry,
    isUpgradeAvailable(currentVersion, latestVersion),
  )

  const meta = [
    currentVersion &&
      t("agents.header.currentVersion", { version: currentVersion }),
    latestVersion && t("agents.header.latestVersion", { version: latestVersion }),
    installedAtLabel,
  ].filter((m): m is string => !!m)

  const links = [
    homepage && { label: homepage.replace(/^https?:\/\//, ""), url: homepage },
    github && { label: t("agents.header.github"), url: github },
    docs && { label: t("agents.header.docs"), url: docs },
  ].filter((l): l is { label: string; url: string } => !!l)

  return (
    <header className="flex items-start gap-4 border-b pb-5">
      <AgentIcon type={entry.name} size={56} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="m-0 truncate text-2xl font-bold tracking-tight">
            {entry.label || entry.name}
          </h2>
          <AgentStatusBadge status={status} />
        </div>

        <p className="m-0 mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {describeEntry(entry, t) || t("agents.header.noDescription")}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-2xs text-muted-foreground">
          {meta.map((m, i) => (
            <React.Fragment key={m}>
              {i > 0 && <span className="opacity-40">/</span>}
              <span>{m}</span>
            </React.Fragment>
          ))}
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
      </div>
    </header>
  )
}
