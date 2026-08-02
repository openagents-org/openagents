import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@renderer/components/layout/page-header"
import { Button } from "@renderer/components/ui/button"
import { Card } from "@renderer/components/ui/card"
import { Skeleton } from "@renderer/components/ui/skeleton"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
} from "@renderer/components/ui/empty"
import AgentDetail from "@renderer/components/agent-detail/AgentDetail"
import SetupWizard from "@renderer/components/setup-wizard/SetupWizard"
import { InstallConfirmModal } from "@renderer/components/agent-detail/InstallConfirmModal"
import { MarketplaceFilter } from "@renderer/components/install/MarketplaceFilter"
import { MarketplaceSearch } from "@renderer/components/install/MarketplaceSearch"
import { MarketplaceSort } from "@renderer/components/install/MarketplaceSort"
import { MarketplaceViewToggle } from "@renderer/components/install/MarketplaceViewToggle"
import { FeaturedBanner } from "@renderer/components/install/FeaturedBanner"
import { AgentCard } from "@renderer/components/install/AgentCard"
import { AgentRow } from "@renderer/components/install/AgentRow"
import { hasPendingUpdate, useInstallStore } from "@renderer/store/install"
import { useUiStore } from "@renderer/store/ui"
import type { CatalogEntry } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"
import { useMarketplace } from "./use-marketplace"
import { useInstallActions } from "./use-install-actions"
import { UninstallDialog } from "./components/uninstall-dialog"

interface InstallProps {
  showToast: (msg: string, type?: ToastType) => void
}

/** Column count climbs with viewport width; breakpoints are @theme tokens. */
const GRID =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 4xl:grid-cols-7 5xl:grid-cols-8"

function SkeletonCard(): React.JSX.Element {
  return (
    <Card className="min-h-42 gap-2 px-4 py-4">
      <Skeleton className="mb-2 h-3 w-3/5" />
      <Skeleton className="h-2 w-4/5" />
      <Skeleton className="h-2 w-2/5" />
      <Skeleton className="mt-auto h-2 w-3/5" />
    </Card>
  )
}

/**
 * Agent Marketplace (stage.md §2.1). Composes the filter / search / sort /
 * view-toggle primitives over the catalog returned by window.api.getCatalog().
 * The install lifecycle stays untouched — Install / Uninstall / Update
 * dispatch into the same legacy installAgentTypeStreaming /
 * uninstallAgentTypeStreaming IPC; this layer just rearranges the UI.
 */
export default function Install({ showToast }: InstallProps): React.JSX.Element {
  const { t } = useTranslation()
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [wizardEntry, setWizardEntry] = useState<CatalogEntry | null>(null)

  const market = useMarketplace()
  const { prefs, setView, setSort, setCategory } = market.prefs
  const updates = useInstallStore((s) => s.updates)
  const installedList = useInstallStore((s) => s.installed)
  const jobs = useInstallStore((s) => s.jobs)

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
  useEffect(() => {
    if (installListSignal > 0) setSelectedName(null)
  }, [installListSignal])

  const verbFor = (c: CatalogEntry): "install" | "update" =>
    c.installed && c.managed !== false ? "update" : "install"

  const selected = selectedName
    ? market.catalog.find((c) => c.name === selectedName)
    : null

  if (selected) {
    return (
      <section className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto px-9 py-6">
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
      />

      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-9 py-6">
        <FeaturedBanner catalog={market.catalog} onOpen={setSelectedName} />

        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-semibold">{t("install.allAgents")}</h2>
          {market.loading ? (
            <Skeleton className="h-3 w-30" />
          ) : (
            <span className="text-2xs text-muted-foreground">
              {t("install.stats", {
                total: market.catalog.length,
                installed: installedList.length,
              })}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 [&>*]:shrink-0">
          <div className="min-w-45 flex-1">
            <MarketplaceSearch value={market.search} onChange={market.setSearch} />
          </div>
          <MarketplaceSort value={prefs.sort} onChange={setSort} />
          <MarketplaceViewToggle value={prefs.view} onChange={setView} />
        </div>

        <MarketplaceFilter
          catalog={market.catalog}
          category={prefs.category}
          onCategoryChange={setCategory}
        />

        {market.loading ? (
          <div className={GRID}>
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : market.filtered.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyDescription>{t("install.empty.noMatch")}</EmptyDescription>
            </EmptyHeader>
            {(market.search || prefs.category !== "all") && (
              <EmptyContent>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    market.setSearch("")
                    setCategory("all")
                  }}
                >
                  {t("install.empty.resetFilters")}
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <div className={prefs.view === "grid" ? GRID : "flex flex-col gap-2.5"}>
            {market.filtered.map((c) => {
              const Item = prefs.view === "grid" ? AgentCard : AgentRow
              return (
                <Item
                  key={c.name}
                  entry={c}
                  job={jobs[c.name]}
                  hasUpdate={hasPendingUpdate(updates, c.name)}
                  onOpen={() => setSelectedName(c.name)}
                  onInstall={() => actions.requestInstall(c, verbFor(c))}
                  onUninstall={() => actions.requestUninstall(c)}
                />
              )
            })}
          </div>
        )}
      </div>

      <InstallConfirmModal
        open={!!actions.confirmInstall}
        verb={actions.confirmInstall?.verb || "install"}
        entry={actions.confirmInstall?.entry || null}
        onConfirm={actions.acceptInstall}
        onCancel={actions.cancelInstall}
      />

      <UninstallDialog
        entry={actions.confirmUninstall}
        onConfirm={actions.acceptUninstall}
        onCancel={actions.cancelUninstall}
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
