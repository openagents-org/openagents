import React from "react"
import { useTranslation } from "react-i18next"
import type { CatalogEntry } from "../../types"

const SECTION = "px-4.5 py-4 bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm"
const SECTION_H4 = "text-xs font-semibold uppercase tracking-wider text-(--text-secondary) m-0 mb-2.5"
const DL = "grid grid-cols-[max-content_1fr] gap-x-3.5 gap-y-1.5 m-0 text-xs [&>dt]:text-(--text-tertiary) [&>dd]:m-0 [&>dd]:text-(--text-primary) [&>dd]:wrap-break-word"

interface AgentDependenciesProps {
  entry: CatalogEntry
}

function detectPlatform(): "macos" | "linux" | "windows" {
  if (typeof navigator === "undefined") return "linux"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("win")) return "windows"
  if (ua.includes("mac")) return "macos"
  return "linux"
}

/**
 * Stage.md §2.2 requires "System requirements" and "Dependencies" as two
 * distinct items on the detail page. We split them so the user gets a
 * dedicated "can my machine run this?" answer separate from "what does it
 * install?" — even though both are derived from the same registry block.
 */
export function AgentSystemRequirements({
  entry,
}: AgentDependenciesProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const platforms = [
    entry.install?.macos && "macOS",
    entry.install?.linux && "Linux",
    entry.install?.windows && "Windows",
  ].filter(Boolean) as string[]
  const reqs = (entry.install?.requires || []).filter((x): x is string => !!x)
  const apiOnly = !!entry.install?.api_only

  if (platforms.length === 0 && reqs.length === 0 && !apiOnly) return null

  return (
    <div className={SECTION}>
      <h4 className={SECTION_H4}>{t("agents.requirements.title")}</h4>
      <dl className={DL}>
        {platforms.length > 0 && (
          <>
            <dt>{t("agents.requirements.platforms")}</dt>
            <dd>{platforms.join(" · ")}</dd>
          </>
        )}
        {reqs.length > 0 && (
          <>
            <dt>{t("agents.requirements.runtime")}</dt>
            <dd>{reqs.join(", ")}</dd>
          </>
        )}
        {apiOnly && (
          <>
            <dt>{t("agents.requirements.installMode")}</dt>
            <dd>{t("agents.requirements.apiOnly")}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

/**
 * Dependencies = the actual install command for the user's current
 * platform, plus a hint to the binary that will land on PATH. This is what
 * gets executed when the user clicks Install, which is what they really
 * care about in a "dependencies" pane.
 */
export function AgentDependencies({
  entry,
}: AgentDependenciesProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const platformKey = detectPlatform()
  const installCmd = entry.install?.[platformKey]
  const binary = entry.install?.binary

  if (!installCmd && !binary) return null

  return (
    <div className={SECTION}>
      <h4 className={SECTION_H4}>{t("agents.dependencies.title")}</h4>
      <dl className={DL}>
        {binary && (
          <>
            <dt>{t("agents.dependencies.binary")}</dt>
            <dd>
              <code className="text-2xs">{binary}</code>
            </dd>
          </>
        )}
        {installCmd && (
          <>
            <dt>{t("agents.dependencies.install", { platform: platformKey })}</dt>
            <dd>
              <code className="text-2xs whitespace-pre-wrap break-all">
                {installCmd}
              </code>
            </dd>
          </>
        )}
      </dl>
    </div>
  )
}
