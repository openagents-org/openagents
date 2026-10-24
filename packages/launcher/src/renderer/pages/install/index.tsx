import React, { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, ChevronRight, FilterX, SearchX } from "lucide-react"

import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { Skeleton } from "@renderer/components/ui/skeleton"
import { EmptyState } from "@renderer/components/ui-kit"
import AgentDetail from "./detail"
import { InstallConfirmDialog } from "./detail/install-confirm-dialog"
import { hasPendingUpdate, useInstallStore } from "@renderer/store/install"
import { useUiStore } from "@renderer/store/ui"
import type { ToastType } from "@renderer/hooks/useToast"
import {
  useMarketplace,
  type MarketplaceRow,
  type StatusFilter,
} from "./use-marketplace"
import { useInstallActions } from "./use-install-actions"
import { GRID, MarketplaceGrid } from "./components/marketplace-grid"
import { MarketplaceCategories } from "./components/marketplace-categories"
import { MarketplaceHero } from "./components/marketplace-hero"
import { MarketplaceStats } from "./components/marketplace-stats"
import { MarketplaceTable } from "./components/marketplace-table"
import { MarketplaceToolbar } from "./components/marketplace-toolbar"

interface InstallProps {
  showToast: (msg: string, type?: ToastType) => void
}

/**
 * Agent marketplace. Composes hero / search / category / view primitives over
 * the catalog returned by window.api.getCatalog(). The install lifecycle is
 * untouched — Install and Update dispatch into the same streaming IPC as
 * before; this layer only decides how the catalog is presented.
 */
export default function Install({ showToast }: InstallProps): React.JSX.Element {
  const { t } = useTranslation()
  const [selectedName, setSelectedName] = useState<string | null>(null)

  const market = useMarketplace()
  const { prefs, setView, setSort, setCategory } = market.prefs
  const updates = useInstallStore((s) => s.updates)
  const installedList = useInstallStore((s) => s.installed)

  const actions = useInstallActions({
    loadAll: market.loadAll,
    showToast,
    onSelect: setSelectedName,
  })

  const installFocusAgent = useUiStore((s) => s.installFocusAgent)
  const setInstallFocusAgent = useUiStore((s) => s.setInstallFocusAgent)
  const installListSignal = useUiStore((s) => s.installListSignal)
  const installListFilter = useUiStore((s) => s.installListFilter)
  const setCurrentTab = useUiStore((s) => s.setCurrentTab)

  // Tray menu / Dashboard banner deep-link: open straight into a specific
  // agent's detail page, then clear the request flag so a subsequent tab click
  // brings the user back to the list.
  useEffect(() => {
    if (installFocusAgent) {
      setSelectedName(installFocusAgent)
      setInstallFocusAgent(null)
    }
  }, [installFocusAgent, setInstallFocusAgent])

  // Sidebar "Install" tab click bumps installListSignal — return to the list.
  //
  // A *change* in the signal, not its standing value. The counter lives in the
  // store and survives this page unmounting, so `> 0` was true on every mount
  // after the first time the user ever clicked the sidebar's Install item — and
  // this effect then ran on mount and wiped the selection the focus effect above
  // had just made. That is why a "gemini has an update" notification clicked
  // from the dashboard landed on the marketplace list: both effects fire on
  // mount, and this one runs second.
  const lastListSignal = useRef(installListSignal)
  useEffect(() => {
    if (installListSignal === lastListSignal.current) return
    lastListSignal.current = installListSignal
    setSelectedName(null)
    market.setStatusFilter(installListFilter)
  }, [installListSignal, installListFilter, market.setStatusFilter])

  const counts = useMemo(
    () => ({
      available: market.catalog.filter((c) => !c.comingSoon).length,
      installed: installedList.length,
      updatable: market.catalog.filter((c) => hasPendingUpdate(updates, c.name))
        .length,
    }),
    [market.catalog, installedList, updates],
  )

  /**
   * Header counter → catalog filter. The exception that makes the feature worth
   * having: with exactly one agent out of date, "1 待更新" opens THAT agent
   * rather than filtering a list down to a single row the user still has to
   * click. This is the ask from the feedback — the counter said something was
   * out of date but not what, so finding it meant scrolling the whole catalog.
   */
  const selectStatusFilter = (filter: StatusFilter): void => {
    if (filter === "updatable" && market.updatable.length === 1) {
      setSelectedName(market.updatable[0].name)
      return
    }
    market.setStatusFilter(filter)
  }

  const startInstall = (row: MarketplaceRow): void =>
    actions.requestInstall(
      row.entry,
      row.status === "update" ? "update" : "install",
    )

  const selected = selectedName
    ? market.catalog.find((c) => c.name === selectedName)
    : null

  if (selected) {
    return (
      <section className="flex h-full min-h-0 flex-col">
        {/* No padding or scrolling here: the detail page pins its own header
            and scrolls only the document column underneath it. */}
        <div className="min-h-0 flex-1">
          <AgentDetail
            entry={selected}
            onBack={() => setSelectedName(null)}
            onAfterInstall={(e) => {
              // Optimistically reflect the just-finished job in local state so
              // pressing Back immediately shows the right badge before
              // loadAll() resolves.
              const job = useInstallStore.getState().jobs[e.name]
              const installed = ["install", "update", "rollback"].includes(
                job?.verb ?? "",
              )
              if (installed || job?.verb === "uninstall") {
                market.setCatalog((prev) =>
                  prev.map((c) => (c.name === e.name ? { ...c, installed } : c)),
                )
              }
              market.loadAll()
            }}
            onAddAgent={(e) => useUiStore.getState().requestCreate("agent", e.name)}
            showToast={showToast}
          />
        </div>
      </section>
    )
  }

  return (
    <section className="flex h-full flex-col">
      {/* One row: the way back and the title as a breadcrumb, the counts on
          the right. The list has no tab of its own — it opens from Connect
          Agents, so that is where the crumb leads. It used to take three rows
          (back link, title, subtitle) of fixed space above a scrolling page. */}
      <header className="flex shrink-0 items-center justify-between gap-4 px-9 pt-5 pb-1">
        <div className="flex min-w-0 items-center gap-1">
          <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground"
            onClick={() => setCurrentTab("dashboard")} title={t("install.topbar.back")}
            data-testid="marketplace-back">
            <ArrowLeft />
            {t("nav.items.dashboard.label")}
          </Button>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          {/* Crumb-sized, told apart from the link only by weight. A span, not
              an h1: the brand skin sets every h1 at weight 800, which is a
              page title's voice, not a breadcrumb's. */}
          <span aria-current="page" className="truncate pl-1 text-sm font-semibold">{t("install.topbar.title")}</span>
        </div>
        {market.loading ? null : (
          <MarketplaceStats
            counts={counts}
            active={market.statusFilter}
            onSelect={selectStatusFilter}
          />
        )}
      </header>

      {/* A block container, not a flex column: flex children default to
          `shrink: 1`, so inside a scroll box with a definite height they get
          squashed instead of overflowing — which flattened the banner to a
          sliver. `space-y` gives the same rhythm without the shrinking. */}
      {/* No scroll-edge fade here: the filter row below sticks to the top of
          this box, and the fade would wash it out with everything else. */}
      <div className="flex-1 space-y-4 overflow-y-auto px-9 pt-4 pb-6">
        <MarketplaceHero
          catalog={market.catalog}
          installed={installedList}
          updates={updates}
          onOpen={setSelectedName}
        />

        {/* Categories and search in one row that sticks while the catalog
            scrolls: browsing a long list, these are what gets reached for,
            and they used to scroll away with the banner. Bled to the box's
            edges so cards pass under an opaque band. `-top-4` cancels the
            box's `pt-4`: a sticky element stops at the padding edge, which
            left a strip of cards showing above it. */}
        <div className="sticky -top-4 z-10 -mx-9 flex h-14 items-center justify-between gap-6 bg-background px-9">
          <MarketplaceCategories
            catalog={market.catalog}
            category={prefs.category}
            onCategoryChange={setCategory}
          />
          <MarketplaceToolbar
            search={market.search}
            onSearchChange={market.setSearch}
            sort={prefs.sort}
            onSortChange={setSort}
            view={prefs.view}
            onViewChange={setView}
          />
        </div>

        {market.loading ? (
          <div className={GRID}>
            {Array.from({ length: 6 }, (_, i) => (
              <Card key={i} className="min-h-42 gap-2 px-4.5 py-4">
                <Skeleton className="mb-2 h-3 w-3/5" />
                <Skeleton className="h-2 w-4/5" />
                <Skeleton className="h-2 w-2/5" />
                <Skeleton className="mt-auto h-2 w-3/5" />
              </Card>
            ))}
          </div>
        ) : market.rows.length === 0 ? (
          <EmptyState
            icon={market.search.trim() ? <SearchX /> : <FilterX />}
            title={
              market.search.trim()
                ? t("install.empty.noQueryMatchTitle")
                : t("install.empty.noMatchTitle")
            }
            description={
              market.search.trim()
                ? t("install.empty.noQueryMatch", { query: market.search.trim() })
                : t("install.empty.noMatch")
            }
            action={
              market.search ||
              prefs.category !== "all" ||
              market.statusFilter !== "all"
                ? {
                    label: t("install.empty.resetFilters"),
                    onClick: () => {
                      market.setSearch("")
                      setCategory("all")
                      // The header counters are a filter like any other, so
                      // "clear filters" has to clear them too — otherwise the
                      // button appears to do nothing when a counter is what
                      // emptied the list.
                      market.setStatusFilter("all")
                    },
                  }
                : undefined
            }
          />
        ) : prefs.view === "grid" ? (
          <MarketplaceGrid
            rows={market.rows}
            onOpen={setSelectedName}
            onInstall={startInstall}
          />
        ) : (
          <MarketplaceTable
            rows={market.rows}
            onOpen={setSelectedName}
            onInstall={startInstall}
          />
        )}
      </div>

      <InstallConfirmDialog
        open={!!actions.confirmInstall}
        verb={actions.confirmInstall?.verb || "install"}
        entry={actions.confirmInstall?.entry || null}
        onConfirm={actions.acceptInstall}
        onCancel={actions.cancelInstall}
      />
    </section>
  )
}
