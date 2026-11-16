import React, { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react"

import AgentIcon from "@renderer/components/AgentIcon"
import { Button } from "@renderer/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@renderer/components/ui/item"
import { AgentStatusBadge } from "@renderer/pages/install/components/agent-status-badge"
import { describeEntry, entryStatus } from "@renderer/pages/install/entry-meta"
import { hasPendingUpdate, useInstallStore } from "@renderer/store/install"
import type { CatalogEntry } from "@renderer/types"

/** The agents the page leads with, in this order. */
export const RECOMMENDED_TYPES = ["codex", "claude", "opencode", "hermes"]
/** Cards on screen at once; the arrows step through them one at a time. */
const VISIBLE = 2
/** Tiles in the compact row: three, so each is wide enough for its full name. */
const COMPACT_SHOWN = 3

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
    // A heading row with the way into the marketplace on its right, then the
    // first three types as equal tiles in one row. A filled panel with the
    // chips wrapping beside a large button left half its width empty and made
    // "more" louder than the choices; four tiles across cut their names short.
    return (
      <section
        className="@container mb-6"
        aria-label={t("agents.shared.recommended.label")}
        data-testid="recommended-agents"
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="m-0 text-base font-semibold">{t("agents.shared.recommended.label")}</h2>
          {/* Styled like Workspaces' "+ Join workspace": each page's one way
              to add more of what it lists looks the same. */}
          <Button className="shrink-0" onClick={onMore} data-testid="new-agent-open">
            <Plus data-icon="inline-start" />
            {t("agents.shared.recommended.more")}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-3">
          {entries.slice(0, COMPACT_SHOWN).map((entry) => (
            <RecommendedChip key={entry.name} entry={entry} onInstall={() => onInstall(entry.name)} />
          ))}
        </div>
      </section>
    )
  }

  return (
    // One card holds the whole block — heading, cards, arrows and the way into
    // the marketplace — so it reads apart from the agent list below.
    <Card
      className="@container mb-6"
      aria-label={t("agents.shared.recommended.label")}
      data-testid="recommended-agents"
    >
      <CardHeader>
        <CardTitle>{t("agents.shared.recommended.label")}</CardTitle>
        <CardDescription>{t("agents.shared.recommended.hint")}</CardDescription>
      </CardHeader>
      {shown.length > 0 && (
        <CardContent className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            className="shrink-0 rounded-full"
            aria-label={t("agents.shared.recommended.prev")}
            title={t("agents.shared.recommended.prev")}
            disabled={first === 0}
            onClick={() => setStart(first - 1)}
          >
            <ChevronLeft />
          </Button>
          {/* Side by side once both cards fit with their name and action;
              stacked below that rather than squeezing the name away. */}
          <ItemGroup className="grid min-w-0 flex-1 grid-cols-1 gap-3 @2xl:grid-cols-2">
            {shown.map((entry) => (
              <RecommendedCard key={entry.name} entry={entry} onInstall={() => onInstall(entry.name)}
                onUpdate={() => onUpdate(entry.name)} />
            ))}
          </ItemGroup>
          <Button
            variant="outline"
            size="icon-sm"
            className="shrink-0 rounded-full"
            aria-label={t("agents.shared.recommended.next")}
            title={t("agents.shared.recommended.next")}
            disabled={first >= last}
            onClick={() => setStart(first + 1)}
          >
            <ChevronRight />
          </Button>
        </CardContent>
      )}
      <CardFooter className="justify-center">
        <Button size="lg" className="w-full @md:w-auto" onClick={onMore} data-testid="new-agent-open">
          <Plus data-icon="inline-start" />
          {t("agents.shared.recommended.more")}
        </Button>
      </CardFooter>
    </Card>
  )
}

/**
 * A recommended type in the compact row: its mark and name, then what a click
 * does, in words — a bare plus or download arrow left people guessing.
 */
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
    <Item variant="outline" size="sm" asChild>
      <button type="button" onClick={onInstall} title={`${action} · ${name}`} data-testid={`recommended-add-${entry.name}`}
        className="min-w-0 text-left hover:bg-muted">
        <ItemMedia>
          <AgentIcon type={entry.name} size={32} />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="truncate">{name}</ItemTitle>
        </ItemContent>
        <ItemActions className="gap-1 text-xs text-muted-foreground">
          {available ? <Download className="size-3.5" /> : <Plus className="size-3.5" />}
          {action}
        </ItemActions>
      </button>
    </Item>
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
    <Item variant="outline" role="listitem" data-testid={`recommended-${entry.name}`} className="min-w-0 flex-nowrap">
      <ItemMedia>
        <AgentIcon type={entry.name} size={48} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0">
          <span className="truncate">{entry.label || entry.name}</span>
          {status === "update" ? (
            <button type="button" className="shrink-0" onClick={onUpdate} title={t("agents.shared.recommended.update")}
              data-testid={`recommended-update-${entry.name}`}>
              <AgentStatusBadge status={status} className="cursor-pointer" />
            </button>
          ) : status === "installed" ? (
            <AgentStatusBadge status={status} className="shrink-0" />
          ) : null}
        </ItemTitle>
        <ItemDescription className="line-clamp-1" title={describeEntry(entry, t) || undefined}>
          {describeEntry(entry, t) || t("install.card.noDescription")}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button variant="outline" onClick={onInstall} data-testid={`recommended-add-${entry.name}`}>
          {status === "available" ? <Download data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
          {t(status === "available" ? "agents.shared.recommended.installNow" : "agents.actions.addAgent")}
        </Button>
      </ItemActions>
    </Item>
  )
}
