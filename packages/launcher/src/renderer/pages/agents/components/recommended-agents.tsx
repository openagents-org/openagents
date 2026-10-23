import React, { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react"

import AgentIcon from "@renderer/components/AgentIcon"
import { Button } from "@renderer/components/ui/button"
import { AgentStatusBadge } from "@renderer/pages/install/components/agent-status-badge"
import { describeEntry, entryStatus } from "@renderer/pages/install/entry-meta"
import { hasPendingUpdate, useInstallStore } from "@renderer/store/install"
import type { CatalogEntry } from "@renderer/types"

/** The agents the page leads with, in this order. */
export const RECOMMENDED_TYPES = ["codex", "claude", "opencode", "hermes"]
/** Cards on screen at once; the arrows step through them one at a time. */
const VISIBLE = 2

/**
 * The recommended agent types, two at a time. Moved by hand only — the
 * marketplace banner rotated on a timer, which changed the card under someone
 * about to click it. Every card opens the regular setup form for its type:
 * Install now for a type not on this computer yet, Add agent for one that is —
 * another agent of an installed type reuses its runtime. An installed type
 * also shows its state; a pending update opens its marketplace page.
 */
export function RecommendedAgents({
  catalog,
  onInstall,
  onUpdate,
  onMore,
  compact = false,
}: {
  catalog: CatalogEntry[]
  onInstall: (type: string) => void
  /** Open the type's marketplace page, where its update runs. */
  onUpdate: (type: string) => void
  onMore: () => void
  /**
   * One row instead of the full panel, for someone who already has agents:
   * the panel is the way in for a first agent, and past that it only pushed
   * the list of their agents down the window.
   */
  compact?: boolean
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

  if (compact) {
    return (
      <section
        className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-primary/20 bg-primary/8 px-5 py-3"
        aria-label={t("agents.shared.recommended.label")}
        data-testid="recommended-agents"
      >
        <h2 className="m-0 shrink-0 text-sm font-semibold">{t("agents.shared.recommended.label")}</h2>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {entries.map((entry) => (
            <RecommendedChip key={entry.name} entry={entry} onInstall={() => onInstall(entry.name)} />
          ))}
        </div>
        <Button size="sm" className="shrink-0" onClick={onMore} data-testid="new-agent-open">
          {t("agents.shared.recommended.more")}
        </Button>
      </section>
    )
  }

  return (
    // One tinted panel holds the whole block — heading, cards, arrows and the
    // way into the marketplace — so it reads apart from the agent list below.
    // The tint is derived from the brand colour, the same family as the
    // marketplace banner, without touching the global button colour.
    <section
      className="@container mb-6 rounded-xl border border-primary/20 bg-primary/8 p-6"
      aria-label={t("agents.shared.recommended.label")}
      data-testid="recommended-agents"
    >
      <div className="mb-4">
        <h2 className="m-0 text-lg font-semibold">{t("agents.shared.recommended.label")}</h2>
        <p className="m-0 mt-1 text-sm text-muted-foreground">{t("agents.shared.recommended.hint")}</p>
      </div>
      {shown.length > 0 && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            className="shrink-0 rounded-full bg-card"
            aria-label={t("agents.shared.recommended.prev")}
            title={t("agents.shared.recommended.prev")}
            disabled={first === 0}
            onClick={() => setStart(first - 1)}
          >
            <ChevronLeft />
          </Button>
          {/* Side by side once both cards fit with their name and action;
              stacked below that rather than squeezing the name away. */}
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 @2xl:grid-cols-2">
            {shown.map((entry) => (
              <RecommendedCard key={entry.name} entry={entry} onInstall={() => onInstall(entry.name)}
                onUpdate={() => onUpdate(entry.name)} />
            ))}
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            className="shrink-0 rounded-full bg-card"
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
        {/* Taller and wider than `size="lg"` on purpose, set here rather than
            on the shared size so no other page's buttons grow with it. */}
        <Button className="h-12 w-full px-8 text-base @md:w-auto @md:min-w-70" onClick={onMore} data-testid="new-agent-open">
          {t("agents.shared.recommended.more")}
        </Button>
      </div>
    </section>
  )
}

/** A recommended type in the compact row: its mark and name, then what a click does. */
function RecommendedChip({
  entry,
  onInstall,
}: {
  entry: CatalogEntry
  onInstall: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const updates = useInstallStore((s) => s.updates)
  const available = entryStatus(entry, hasPendingUpdate(updates, entry.name)) === "available"
  const action = t(available ? "agents.shared.recommended.installNow" : "agents.actions.addAgent")
  const name = entry.label || entry.name
  return (
    <Button variant="outline" size="sm" className="bg-card" onClick={onInstall}
      title={`${action} · ${name}`} data-testid={`recommended-add-${entry.name}`}>
      <AgentIcon type={entry.name} size={16} />
      {name}
      {available ? <Download className="text-muted-foreground" /> : <Plus className="text-muted-foreground" />}
    </Button>
  )
}

function RecommendedCard({
  entry,
  onInstall,
  onUpdate,
}: {
  entry: CatalogEntry
  onInstall: () => void
  onUpdate: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const updates = useInstallStore((s) => s.updates)
  const status = entryStatus(entry, hasPendingUpdate(updates, entry.name))
  return (
    <div
      data-testid={`recommended-${entry.name}`}
      className="flex min-w-0 items-center gap-4 rounded-lg border bg-card p-4"
    >
      <div className="flex size-14 shrink-0 items-center justify-center rounded-md border bg-background">
        <AgentIcon type={entry.name} size={30} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="m-0 truncate text-base font-semibold">{entry.label || entry.name}</h3>
          {status === "update" ? (
            <button type="button" className="shrink-0" onClick={onUpdate} title={t("agents.shared.recommended.update")}
              data-testid={`recommended-update-${entry.name}`}>
              <AgentStatusBadge status={status} className="cursor-pointer" />
            </button>
          ) : status === "installed" ? (
            <AgentStatusBadge status={status} className="shrink-0" />
          ) : null}
        </div>
        <p className="m-0 mt-1 truncate text-sm text-muted-foreground" title={describeEntry(entry, t) || undefined}>
          {describeEntry(entry, t) || t("install.card.noDescription")}
        </p>
      </div>
      <div className="shrink-0">
        <Button variant="outline" className="border-primary text-primary hover:bg-(--accent-bg) hover:text-primary" onClick={onInstall}
          data-testid={`recommended-add-${entry.name}`}>
          {status === "available" ? <Download /> : <Plus />}
          {t(status === "available" ? "agents.shared.recommended.installNow" : "agents.actions.addAgent")}
        </Button>
      </div>
    </div>
  )
}
