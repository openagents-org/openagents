import React, { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight, Download } from "lucide-react"

import AgentIcon from "@renderer/components/AgentIcon"
import { Badge } from "@renderer/components/ui/badge"
import { Button } from "@renderer/components/ui/button"
import { AgentStatusBadge } from "@renderer/pages/install/components/agent-status-badge"
import { describeEntry, entryStatus } from "@renderer/pages/install/entry-meta"
import { hasPendingUpdate, useInstallStore } from "@renderer/store/install"
import type { CatalogEntry } from "@renderer/types"

/** The agents the page leads with, in this order. */
export const RECOMMENDED_TYPES = ["codex", "claude", "opencode", "hermes"]
/** Cards on screen at once; the arrows step through them one at a time. */
const VISIBLE = 2
const MAX_TAGS = 3

/**
 * The recommended agent types, two at a time. Moved by hand only — the
 * marketplace banner rotated on a timer, which changed the card under someone
 * about to click it. A type not on this computer yet offers Install now, which
 * starts the regular setup form for it; an installed one shows its state the
 * way the marketplace did (installed, or an update pending). Another agent of
 * an installed type is added through Browse and connect more agents.
 */
export function RecommendedAgents({
  catalog,
  onInstall,
  onMore,
}: {
  catalog: CatalogEntry[]
  onInstall: (type: string) => void
  onMore: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const entries = useMemo(
    () =>
      RECOMMENDED_TYPES.map((type) => catalog.find((c) => c.name === type)).filter(
        (c): c is CatalogEntry => !!c && !c.comingSoon,
      ),
    [catalog],
  )
  const [start, setStart] = useState(0)
  const last = Math.max(0, entries.length - VISIBLE)
  const first = Math.min(start, last)
  const shown = entries.slice(first, first + VISIBLE)

  return (
    <section className="mb-8" aria-label={t("agents.shared.recommended.label")} data-testid="recommended-agents">
      {shown.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full"
            aria-label={t("agents.shared.recommended.prev")}
            title={t("agents.shared.recommended.prev")}
            disabled={first === 0}
            onClick={() => setStart(first - 1)}
          >
            <ChevronLeft />
          </Button>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-4">
            {shown.map((entry) => (
              <RecommendedCard key={entry.name} entry={entry} onInstall={() => onInstall(entry.name)} />
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 rounded-full"
            aria-label={t("agents.shared.recommended.next")}
            title={t("agents.shared.recommended.next")}
            disabled={first >= last}
            onClick={() => setStart(first + 1)}
          >
            <ChevronRight />
          </Button>
        </div>
      )}
      <div className="mt-6 flex justify-center">
        <Button size="lg" className="h-11 px-8" onClick={onMore} data-testid="new-agent-open">
          {t("agents.shared.recommended.more")}
        </Button>
      </div>
    </section>
  )
}

function RecommendedCard({
  entry,
  onInstall,
}: {
  entry: CatalogEntry
  onInstall: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const updates = useInstallStore((s) => s.updates)
  const status = entryStatus(entry, hasPendingUpdate(updates, entry.name))
  const tags = (entry.tags || []).slice(0, MAX_TAGS)
  return (
    <div
      data-testid={`recommended-${entry.name}`}
      className="flex min-h-52 flex-col rounded-xl border border-primary/25 bg-linear-to-br from-primary/12 via-primary/5 to-transparent p-6"
    >
      <div className="flex items-start gap-4">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-card/80 shadow-sm">
          <AgentIcon type={entry.name} size={36} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-xl font-bold tracking-tight">{entry.label || entry.name}</h3>
          <p className="m-0 mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {describeEntry(entry, t) || t("install.card.noDescription")}
          </p>
        </div>
      </div>
      {tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag} variant="muted" size="sm" className="font-mono">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-auto pt-5">
        {status === "available" ? (
          <Button onClick={onInstall}>
            <Download />
            {t("agents.shared.recommended.installNow")}
          </Button>
        ) : (
          <AgentStatusBadge status={status} />
        )}
      </div>
    </div>
  )
}
