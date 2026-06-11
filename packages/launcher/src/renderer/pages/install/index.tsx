import React, { useCallback, useEffect, useMemo, useState } from "react"
import AgentDetail from "../../components/agent-detail/AgentDetail"
import SetupWizard from "../../components/setup-wizard/SetupWizard"
import {
  MarketplaceFilter,
  CATEGORIES,
} from "../../components/install/MarketplaceFilter"
import { MarketplaceSearch } from "../../components/install/MarketplaceSearch"
import { MarketplaceSort } from "../../components/install/MarketplaceSort"
import { MarketplaceViewToggle } from "../../components/install/MarketplaceViewToggle"
import { AgentCard } from "../../components/install/AgentCard"
import { AgentRow } from "../../components/install/AgentRow"
import AgentIcon from "../../components/AgentIcon"
import { useMarketplacePrefs } from "../../hooks/useMarketplacePrefs"
import { hasPendingUpdate, useInstallStore } from "../../store/install"
import { useAgentsStore } from "../../store/agents"
import { useUiStore } from "../../store/ui"
import type { CatalogEntry, InstalledAgentRecord } from "../../types"
import type { ToastType } from "../../hooks/useToast"
import { Button } from "../../components/ui/Button"
import { Checkbox } from "../../components/ui/Checkbox"
import { Modal, ModalTitle } from "../../components/ui/Modal"
import { InstallConfirmModal } from "../../components/agent-detail/InstallConfirmModal"
import { TopBar } from "../../components/TopBar"
import { FeaturedBanner } from "../../components/install/FeaturedBanner"
import { installErrorMessage, throwIfInstallFailed } from "../../utils/installErrors"
import { capture } from "../../lib/analytics"

interface InstallProps {
  showToast: (msg: string, type?: ToastType) => void
}

function SkeletonCard(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 px-4.5 py-4 min-h-[170px] bg-(--bg-card) border border-(--border) rounded-(--radius) shadow-sm">
      <div className="skeleton-shimmer rounded-full h-3 w-[60%] mb-2" />
      <div className="skeleton-shimmer rounded-full h-2 w-[80%]" />
      <div className="skeleton-shimmer rounded-full h-2 w-[40%]" />
      <div className="skeleton-shimmer rounded-full h-2 w-[60%] mt-auto" />
    </div>
  )
}

/**
 * Agent Marketplace (stage.md §2.1). Composes the filter / search / sort /
 * view-toggle primitives over the catalog returned by window.api.getCatalog().
 * The install lifecycle stays untouched — Install / Uninstall / Update
 * dispatch into the same legacy installAgentTypeStreaming /
 * uninstallAgentTypeStreaming IPC; this layer just rearranges the UI.
 */
export default function Install({
  showToast,
}: InstallProps): React.JSX.Element {
  const { prefs, setView, setSort, setCategory } = useMarketplacePrefs()
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [wizardEntry, setWizardEntry] = useState<CatalogEntry | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState<CatalogEntry | null>(
    null,
  )
  // Two-step confirmation before install / update kicks off — matches
  // launcher-legacy's installCatalogItem() flow.
  const [confirmInstall, setConfirmInstall] = useState<{
    entry: CatalogEntry
    verb: "install" | "update"
  } | null>(null)

  const setInstalled = useInstallStore((s) => s.setInstalled)
  const setUpdates = useInstallStore((s) => s.setUpdates)
  const updates = useInstallStore((s) => s.updates)
  const installedList = useInstallStore((s) => s.installed)
  const jobs = useInstallStore((s) => s.jobs)
  const setStoreAgents = useAgentsStore((s) => s.setAgents)

  // The wizard's last step is `addAgent`, so closing the wizard is the moment
  // the agents store may have just gained an entry. Refresh so the
  // hasInstance selector in AgentDetail flips immediately instead of waiting
  // for the next 5s poll from another tab.
  const refreshAgentsStore = useCallback(async () => {
    try {
      const list = await window.api.listAgents()
      setStoreAgents(list)
    } catch {
      /* non-fatal */
    }
  }, [setStoreAgents])

  const installFocusAgent = useUiStore((s) => s.installFocusAgent)
  const setInstallFocusAgent = useUiStore((s) => s.setInstallFocusAgent)
  const installListSignal = useUiStore((s) => s.installListSignal)

  // Tray menu / Dashboard banner deep-link: open straight into a specific
  // agent's detail page, then clear the request flag so a subsequent tab
  // click brings the user back to the list.
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

  const loadAll = useCallback(async () => {
    try {
      // Fast path: catalog + installed records so list state reflects
      // install/uninstall immediately. The npm update probe is slow on
      // first call and runs in the background.
      const [cat, inst] = await Promise.all([
        window.api.getCatalog(),
        window.api
          .getInstalledAgents()
          .catch(() => [] as InstalledAgentRecord[]),
      ])
      setCatalog(cat)
      setInstalled(inst)
      setLoading(false)
      // Keep the shared agents store warm so AgentDetail.hasInstance is
      // correct on first navigation even if the user landed here before
      // visiting Agents/Dashboard.
      refreshAgentsStore()
      window.api
        .checkAgentUpdates()
        .then((u) => setUpdates(u))
        .catch(() => {
          /* non-fatal */
        })
    } catch {
      setLoading(false)
    }
  }, [setInstalled, setUpdates, refreshAgentsStore])

  useEffect(() => {
    loadAll()
    // Light periodic refresh while the marketplace is mounted.
    const id = setInterval(loadAll, 30_000)
    return () => clearInterval(id)
  }, [loadAll])

  // Re-pull catalog + installed list whenever a job finishes so badges flip.
  useEffect(() => {
    const finished = Object.values(jobs).filter(
      (j) => j.phase === "done" || j.phase === "error",
    )
    if (finished.length > 0) loadAll()
  }, [jobs, loadAll])

  // The actual install IPC — only invoked after the confirm modal resolves.
  const runInstall = useCallback(
    async (entry: CatalogEntry, verb: "install" | "update") => {
      setSelectedName(entry.name)
      const wasInstalled = installedList.some((r) => r.name === entry.name)
      useInstallStore.getState().startJob({ agent: entry.name, verb })
      try {
        const result = await window.api.installAgentTypeStreaming(entry.name)
        throwIfInstallFailed(result)
        capture("agent_installed", { agent_type: entry.name, verb })
        showToast(
          `${entry.label || entry.name} ${verb === "update" ? "updated" : "installed"}`,
          "success",
        )
        if (!wasInstalled && verb === "install") setWizardEntry(entry)
      } catch (e: unknown) {
        showToast(`${verb} failed: ${installErrorMessage(e)}`, "error")
      }
    },
    [showToast, installedList],
  )

  // Entry point bound to the card / row primary action: open the confirm
  // modal first, never spawn the install pipeline directly.
  const handleInstall = useCallback(
    (entry: CatalogEntry, verb: "install" | "update") => {
      setConfirmInstall({ entry, verb })
    },
    [],
  )

  const handleUninstall = useCallback((entry: CatalogEntry) => {
    setConfirmUninstall(entry)
  }, [])

  const performUninstall = useCallback(
    async (wipeEnv: boolean) => {
      const entry = confirmUninstall
      if (!entry) return
      setConfirmUninstall(null)
      useInstallStore
        .getState()
        .startJob({ agent: entry.name, verb: "uninstall" })
      try {
        await window.api.uninstallAgentTypeStreaming(entry.name)
        capture("agent_uninstalled", { agent_type: entry.name, wipe_env: wipeEnv })
        if (wipeEnv) {
          try {
            await window.api.deleteAgentEnv(entry.name)
          } catch {
            /* non-fatal — uninstall already succeeded */
          }
        }
        showToast(`${entry.label || entry.name} uninstalled`, "success")
      } catch (e: unknown) {
        showToast(`Uninstall failed: ${(e as Error).message}`, "error")
      } finally {
        await loadAll()
      }
    },
    [confirmUninstall, showToast, loadAll],
  )

  const filteredSorted = useMemo(() => {
    const cat =
      CATEGORIES.find((c) => c.key === prefs.category) || CATEGORIES[0]
    const q = search.trim().toLowerCase()
    const result = catalog.filter((c) => {
      if (!cat.match(c)) return false
      if (!q) return true
      const haystack =
        `${c.name} ${c.label || ""} ${c.description || ""} ${(c.tags || []).join(" ")}`.toLowerCase()
      return haystack.includes(q)
    })

    const byName = (a: CatalogEntry, b: CatalogEntry): number =>
      (a.label || a.name).localeCompare(b.label || b.name)

    if (prefs.sort === "featured") {
      result.sort((a, b) => {
        const ac = a.comingSoon ? 1 : 0
        const bc = b.comingSoon ? 1 : 0
        if (ac !== bc) return ac - bc
        const ao = typeof a.coreOrder === "number" ? a.coreOrder : 999
        const bo = typeof b.coreOrder === "number" ? b.coreOrder : 999
        if (ao !== bo) return ao - bo
        return byName(a, b)
      })
    } else if (prefs.sort === "newest") {
      result.sort((a, b) => {
        const ar =
          installedList.find((r) => r.name === a.name)?.installedAt || ""
        const br =
          installedList.find((r) => r.name === b.name)?.installedAt || ""
        if (ar !== br) return br.localeCompare(ar)
        return byName(a, b)
      })
    } else if (prefs.sort === "popular") {
      result.sort((a, b) => {
        const ai = a.installed ? 1 : 0
        const bi = b.installed ? 1 : 0
        if (ai !== bi) return bi - ai
        return byName(a, b)
      })
    } else if (prefs.sort === "name") {
      result.sort(byName)
    }

    // Coming-soon agents always sink below the supported core set, whatever the
    // chosen sort. Applied last; Array.sort is stable so in-group order holds.
    result.sort((a, b) => (a.comingSoon ? 1 : 0) - (b.comingSoon ? 1 : 0))

    return result
  }, [catalog, search, prefs, installedList])

  const selected = selectedName
    ? catalog.find((c) => c.name === selectedName)
    : null
  if (selected) {
    return (
      <section className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto px-9 py-6">
          <AgentDetail
            entry={selected}
            onBack={() => setSelectedName(null)}
            onAfterInstall={(e) => {
              // Optimistically reflect the just-finished job in local state so
              // pressing Back immediately shows the right badge before
              // loadAll() resolves.
              const job = useInstallStore.getState().jobs[e.name]
              if (
                job?.verb === "install" ||
                job?.verb === "update" ||
                job?.verb === "rollback"
              ) {
                setCatalog((prev) =>
                  prev.map((c) =>
                    c.name === e.name ? { ...c, installed: true } : c,
                  ),
                )
              } else if (job?.verb === "uninstall") {
                setCatalog((prev) =>
                  prev.map((c) =>
                    c.name === e.name ? { ...c, installed: false } : c,
                  ),
                )
              }
              loadAll()
              if (!installedList.find((r) => r.name === e.name))
                setWizardEntry(e)
            }}
            onOpenWizard={(e) => setWizardEntry(e)}
            showToast={showToast}
          />
        </div>
        <SetupWizard
          entry={wizardEntry}
          open={!!wizardEntry}
          onClose={() => {
            setWizardEntry(null)
            refreshAgentsStore()
          }}
          showToast={showToast}
        />
      </section>
    )
  }

  return (
    <section className="flex flex-col h-full">
      <TopBar
        title="Marketplace"
        subtitle="— Discover and install AI agents"
        showSearch
      />
      <div className="flex-1 overflow-y-auto px-9 py-6 flex flex-col gap-3.5">
        <FeaturedBanner catalog={catalog} onOpen={setSelectedName} />

        <div className="flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold text-(--text-primary) m-0">
            All agents
          </h2>
          {loading ? (
            <span className="skeleton-shimmer rounded-full h-3 w-30" />
          ) : (
            <span className="hint m-0">
              {catalog.length} agents · {installedList.length} installed
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 [&>*]:shrink-0">
          <div className="flex-1 min-w-[180px]">
            <MarketplaceSearch value={search} onChange={setSearch} />
          </div>
          <MarketplaceSort value={prefs.sort} onChange={setSort} />
          <MarketplaceViewToggle value={prefs.view} onChange={setView} />
        </div>

        <MarketplaceFilter
          catalog={catalog}
          category={prefs.category}
          onCategoryChange={setCategory}
        />

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1920px]:grid-cols-6 min-[2400px]:grid-cols-7 min-[2880px]:grid-cols-8 gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        ) : filteredSorted.length === 0 ? (
          <div className="py-10 text-center">
            <p className="hint m-0">No agents match the current filters.</p>
            {(search || prefs.category !== "all") && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch("")
                  setCategory("all")
                }}
                className="mt-2"
              >
                Reset filters
              </Button>
            )}
          </div>
        ) : prefs.view === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 min-[1920px]:grid-cols-6 min-[2400px]:grid-cols-7 min-[2880px]:grid-cols-8 gap-3">
            {filteredSorted.map((c) => (
              <AgentCard
                key={c.name}
                entry={c}
                job={jobs[c.name]}
                hasUpdate={hasPendingUpdate(updates, c.name)}
                onOpen={() => setSelectedName(c.name)}
                onInstall={() =>
                  handleInstall(
                    c,
                    c.installed && c.managed !== false ? "update" : "install",
                  )
                }
                onUninstall={() => handleUninstall(c)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {filteredSorted.map((c) => (
              <AgentRow
                key={c.name}
                entry={c}
                job={jobs[c.name]}
                hasUpdate={hasPendingUpdate(updates, c.name)}
                onOpen={() => setSelectedName(c.name)}
                onInstall={() =>
                  handleInstall(
                    c,
                    c.installed && c.managed !== false ? "update" : "install",
                  )
                }
                onUninstall={() => handleUninstall(c)}
              />
            ))}
          </div>
        )}
      </div>

      <InstallConfirmModal
        open={!!confirmInstall}
        verb={confirmInstall?.verb || "install"}
        entry={confirmInstall?.entry || null}
        onConfirm={() => {
          const pending = confirmInstall
          setConfirmInstall(null)
          if (pending) runInstall(pending.entry, pending.verb)
        }}
        onCancel={() => setConfirmInstall(null)}
      />

      {confirmUninstall && (
        <UninstallConfirmModal
          entry={confirmUninstall}
          onConfirm={performUninstall}
          onCancel={() => setConfirmUninstall(null)}
        />
      )}

      <SetupWizard
        entry={wizardEntry}
        open={!!wizardEntry}
        onClose={() => setWizardEntry(null)}
        showToast={showToast}
      />
    </section>
  )
}

function UninstallConfirmModal({
  entry,
  onConfirm,
  onCancel,
}: {
  entry: CatalogEntry
  onConfirm: (wipeEnv: boolean) => void
  onCancel: () => void
}): React.JSX.Element {
  const [wipeEnv, setWipeEnv] = useState(false)
  return (
    <Modal open onClose={onCancel}>
      <div className="flex flex-col items-center py-2">
        <AgentIcon type={entry.name} size={40} />
        <ModalTitle className="mt-3 text-center">
          Uninstall {entry.label || entry.name}?
        </ModalTitle>
        <p className="hint mt-3 mb-4 text-center">
          This will remove <strong>{entry.label || entry.name}</strong> from
          your system. Configured agents of this type may stop working.
        </p>
        <button
          type="button"
          onClick={() => setWipeEnv((v) => !v)}
          className="flex items-start gap-2.5 w-full mb-5 px-3 py-2.5 rounded-(--radius-sm) border border-(--border) bg-(--bg-input)/40 hover:border-(--border-hover) hover:bg-(--bg-input)/70 transition-colors text-left cursor-pointer"
        >
          <Checkbox
            checked={wipeEnv}
            onCheckedChange={setWipeEnv}
            className="mt-0.5"
          />
          <span className="text-[12px] leading-snug text-(--text-secondary)">
            Also remove saved environment variables{" "}
            <span className="text-(--text-tertiary)">
              (API keys, model selection — kept by default and reappear in the
              setup wizard on reinstall)
            </span>
          </span>
        </button>
        <div className="form-actions justify-center mt-0">
          <Button variant="destructive" onClick={() => onConfirm(wipeEnv)}>
            Uninstall
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
