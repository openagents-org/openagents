import React, { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { FilterX, SearchX } from "lucide-react"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { Skeleton } from "@renderer/components/ui/skeleton"
import { EmptyState } from "@renderer/components/ui-kit"
import SetupWizard from "@renderer/components/setup-wizard"
import AgentDetail from "./detail"
import { InstallConfirmDialog } from "./detail/install-confirm-dialog"
import { hasPendingUpdate, useInstallStore } from "@renderer/store/install"
import { useUiStore } from "@renderer/store/ui"
import type { CatalogEntry } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import { useMarketplace, type MarketplaceRow } from "./use-marketplace"
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
  const [wizardEntry, setWizardEntry] = useState<CatalogEntry | null>(null)

  const market = useMarketplace()
  const { prefs, setView, setSort, setCategory } = market.prefs
  const updates = useInstallStore((s) => s.updates)
  const installedList = useInstallStore((s) => s.installed)

  const actions = useInstallActions({
    loadAll: market.loadAll,
    showToast,
    onSelect: setSelectedName,
    onOpenWizard: setWizardEntry,
  })

  const installFocusAgent = useUiStore((s) => s.installFocusAgent)
  const setInstallFocusAgent = useUiStore((s) => s.setInstallFocusAgent)
  const installListSignal = useUiStore((s) => s.installListSignal)

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
  }, [installListSignal])

  const counts = useMemo(
    () => ({
      available: market.catalog.filter((c) => !c.comingSoon).length,
      installed: installedList.length,
      updatable: market.catalog.filter((c) => hasPendingUpdate(updates, c.name))
        .length,
    }),
    [market.catalog, installedList, updates],
  )

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
              if (!installedList.find((r) => r.name === e.name))
                actions.maybeOpenWizard(e)
            }}
            onOpenWizard={setWizardEntry}
            showToast={showToast}
          />
        </div>
        <SetupWizard
          entry={wizardEntry}
          open={!!wizardEntry}
          onClose={() => {
            setWizardEntry(null)
            market.refreshAgentsStore()
          }}
          showToast={showToast}
        />
      </section>
    )
  }

  return (
    <section className="flex h-full flex-col">
      <PageHeader
        title={t("install.topbar.title")}
        subtitle={t("install.topbar.subtitle")}
        actions={market.loading ? null : <MarketplaceStats counts={counts} />}
      />

      {/* A block container, not a flex column: flex children default to
          `shrink: 1`, so inside a scroll box with a definite height they get
          squashed instead of overflowing — which flattened the banner to a
          sliver. `space-y` gives the same rhythm without the shrinking. */}
      <div className="flex-1 space-y-4 overflow-y-auto px-9 py-6">
        <MarketplaceHero
          catalog={market.catalog}
          installed={installedList}
          updates={updates}
          onOpen={setSelectedName}
        />

        <MarketplaceToolbar
          search={market.search}
          onSearchChange={market.setSearch}
          sort={prefs.sort}
          onSortChange={setSort}
          view={prefs.view}
          onViewChange={setView}
        />

        <MarketplaceCategories
          catalog={market.catalog}
          category={prefs.category}
          onCategoryChange={setCategory}
        />

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
              market.search || prefs.category !== "all"
                ? {
                    label: t("install.empty.resetFilters"),
                    onClick: () => {
                      market.setSearch("")
                      setCategory("all")
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

      <SetupWizard
        entry={wizardEntry}
        open={!!wizardEntry}
        onClose={() => setWizardEntry(null)}
        showToast={showToast}
      />
    </section>
  )
}
