import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import type { CatalogEntry } from "../../types"

const SECTION = "px-4.5 py-4 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm"
const SECTION_H4 = "text-xs font-semibold uppercase tracking-wider text-(--text-secondary) m-0 mb-2.5"

interface AgentChangelogProps {
  versions: Array<{ version: string; date?: string }>
  loading: boolean
  error?: string
  homepage?: string
  entry?: CatalogEntry
  currentVersion?: string | null
}

/**
 * Derive a GitHub releases URL from registry metadata when available.
 *
 *   1. explicit `entry.github` → `<repo>/releases/tag/v{version}`
 *   2. homepage that looks like github.com/owner/repo → same path
 *   3. otherwise null — caller falls back to homepage / npm.
 */
function deriveReleaseUrl(version: string, entry?: CatalogEntry): string | null {
  const candidates = [entry?.github, entry?.homepage].filter(Boolean) as string[]
  for (const u of candidates) {
    const m = u.match(/github\.com\/([^/?#]+\/[^/?#]+)/i)
    if (m) {
      const repo = m[1].replace(/\.git$/, "")
      return `https://github.com/${repo}/releases/tag/v${version}`
    }
  }
  return null
}

function npmVersionUrl(name: string, version: string): string {
  return `https://www.npmjs.com/package/${encodeURIComponent(name)}/v/${encodeURIComponent(version)}`
}

/**
 * Version history + release-notes preview (stage.md §2.6).
 *
 * Each version row collapses to a one-line summary; clicking expands an
 * inline preview that surfaces:
 *
 *   - the full timestamp
 *   - a placeholder Features / Fixes / Breaking layout (npm registry doesn't
 *     publish categorised changelogs — we render the section headers so the
 *     spec's content slots exist, and link out to the canonical release notes
 *     for the actual text)
 *   - "View on GitHub" / "View on npm" deep links
 *
 * We deliberately don't fetch the release body — it would require a GitHub
 * token for rate-limited unauthenticated requests, and parsing arbitrary
 * markdown into Features / Fixes / Breaking is fuzzy at best. Linking out
 * is the honest delivery of the spec's "preview".
 */
export function AgentChangelog({
  versions,
  loading,
  error,
  homepage,
  entry,
  currentVersion,
}: AgentChangelogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null)

  if (loading) {
    return (
      <div className={SECTION}>
        <h4 className={SECTION_H4}>{t("agents.changelog.title")}</h4>
        <p className="hint m-0">{t("agents.changelog.loading")}</p>
      </div>
    )
  }
  if (error && versions.length === 0) {
    return (
      <div className={SECTION}>
        <h4 className={SECTION_H4}>{t("agents.changelog.title")}</h4>
        <p className="hint m-0">{error}</p>
      </div>
    )
  }
  if (versions.length === 0) return null

  return (
    <div className={SECTION}>
      <div className="flex items-center justify-between mb-2.5">
        <h4 className={`${SECTION_H4} m-0`}>{t("agents.changelog.title")}</h4>
        {homepage && (
          <a
            href="#"
            className="text-2xs"
            onClick={(e) => { e.preventDefault(); window.api.openExternal(homepage) }}
          >
            {t("agents.changelog.viewOnNpm")}
          </a>
        )}
      </div>
      <ul className="list-none m-0 p-0 max-h-105 overflow-auto text-xs">
        {versions.slice(0, 20).map((v) => {
          const expanded = expandedVersion === v.version
          const isCurrent = currentVersion === v.version
          const releaseUrl = deriveReleaseUrl(v.version, entry)
          return (
            <li
              key={v.version}
              className="border-b border-(--border) last:border-b-0"
            >
              <button
                type="button"
                onClick={() => setExpandedVersion(expanded ? null : v.version)}
                className="w-full flex items-center justify-between gap-2 py-1.5 px-0 bg-transparent border-0 cursor-pointer text-left hover:bg-(--bg-input)/40 transition-colors"
                aria-expanded={expanded}
              >
                <span className="font-mono text-(--text-primary) flex items-center gap-2">
                  <span className="text-3xs text-(--text-tertiary)">
                    {expanded ? "▾" : "▸"}
                  </span>
                  v{v.version}
                  {isCurrent && (
                    <span className="text-3xs px-1.5 py-0.5 rounded-(--radius) bg-(--accent-bg) text-(--accent) border border-(--accent-border)">
                      {t("agents.changelog.installed")}
                    </span>
                  )}
                </span>
                {v.date && (
                  <span className="text-(--text-tertiary)">
                    {new Date(v.date).toLocaleDateString()}
                  </span>
                )}
              </button>

              {expanded && (
                <div className="pb-3 pl-4 pr-1 flex flex-col gap-2 text-2xs">
                  {v.date && (
                    <div className="text-(--text-tertiary)">
                      {t("agents.changelog.released", { date: new Date(v.date).toLocaleString() })}
                    </div>
                  )}

                  {/* Stage.md §2.6 — Features / Fixes / Breaking sections.
                     npm doesn't publish a structured changelog, so we link
                     to the canonical source. The slot headings stay so
                     users know what to look for on the linked page. */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
                    {(["features", "fixes", "breakingChanges"] as const).map((heading) => (
                      <div
                        key={heading}
                        className="px-2.5 py-2 bg-(--bg-input) border border-(--border) rounded-(--radius)"
                      >
                        <div className="text-3xs uppercase tracking-wider text-(--text-tertiary) mb-1">
                          {t(`agents.changelog.${heading}`)}
                        </div>
                        <div className="text-(--text-secondary)">
                          {t("agents.changelog.seeReleaseNotes")}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 flex-wrap mt-1">
                    {releaseUrl && (
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); window.api.openExternal(releaseUrl) }}
                      >
                        {t("agents.changelog.releaseNotesGithub")}
                      </a>
                    )}
                    {entry?.name && (
                      <a
                        href="#"
                        onClick={(e) => {
                          e.preventDefault()
                          window.api.openExternal(npmVersionUrl(entry.name, v.version))
                        }}
                      >
                        {t("agents.changelog.viewOnNpm")}
                      </a>
                    )}
                    {entry?.homepage && !releaseUrl && (
                      <a
                        href="#"
                        onClick={(e) => { e.preventDefault(); window.api.openExternal(entry.homepage!) }}
                      >
                        {t("agents.changelog.homepage")}
                      </a>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
