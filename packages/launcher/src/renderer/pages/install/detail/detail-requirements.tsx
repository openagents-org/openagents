import React from "react"
import { useTranslation } from "react-i18next"

import { Badge } from "@renderer/components/ui/badge"
import type { CatalogEntry } from "@renderer/types"

import { platformsOf, runtimeOf } from "../entry-meta"
import { RailCard, RailRow } from "./detail-section"

function detectPlatform(): "macos" | "linux" | "windows" {
  if (typeof navigator === "undefined") return "linux"
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes("win")) return "windows"
  if (ua.includes("mac")) return "macos"
  return "linux"
}

/**
 * "Can my machine run this?" — platforms, runtime, what lands on PATH, and
 * when it was last installed. Deliberately separate from the dependencies
 * card below, which answers "what will it actually run?".
 */
export function SystemRequirementsCard({
  entry,
  updatedAt,
}: {
  entry: CatalogEntry
  updatedAt?: string | null
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const platforms = platformsOf(entry)
  const runtime = runtimeOf(entry)
  const binary = entry.install?.binary
  const apiOnly = !!entry.install?.api_only

  if (!platforms.length && !runtime && !binary && !apiOnly) return null

  return (
    <RailCard title={t("agents.requirements.title")}>
      {platforms.length > 0 && (
        <RailRow label={t("agents.requirements.platforms")}>
          {platforms.join(" · ")}
        </RailRow>
      )}
      {runtime && (
        <RailRow label={t("agents.requirements.runtime")}>
          <span className="font-mono">{runtime}</span>
        </RailRow>
      )}
      {binary && (
        <RailRow label={t("agents.requirements.binary")}>
          <span className="font-mono">{binary}</span>
        </RailRow>
      )}
      {apiOnly && (
        <RailRow label={t("agents.requirements.installMode")}>
          {t("agents.requirements.apiOnly")}
        </RailRow>
      )}
      {updatedAt && (
        <RailRow label={t("agents.requirements.updatedAt")}>
          {new Date(updatedAt).toLocaleDateString()}
        </RailRow>
      )}
    </RailCard>
  )
}

/**
 * The command that actually runs on this machine when the user clicks
 * Install, plus the registry tags that classify the agent.
 */
export function DependenciesCard({
  entry,
}: {
  entry: CatalogEntry
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const command = entry.install?.[detectPlatform()]
  const tags = entry.tags || []

  if (!command && tags.length === 0) return null

  return (
    <RailCard title={t("agents.dependencies.title")}>
      {command && (
        <code className="block font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
          {command}
        </code>
      )}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="muted" size="sm" className="font-mono">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </RailCard>
  )
}
