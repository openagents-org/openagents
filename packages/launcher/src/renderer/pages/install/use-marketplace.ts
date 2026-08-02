import { useCallback, useEffect, useMemo, useState } from "react"

import { CATEGORIES } from "@renderer/components/install/MarketplaceFilter"
import { useMarketplacePrefs } from "@renderer/hooks/useMarketplacePrefs"
import { useInstallStore } from "@renderer/store/install"
import { useAgentsStore } from "@renderer/store/agents"
import type { CatalogEntry, InstalledAgentRecord } from "@renderer/types"

/** Light periodic refresh while the marketplace is mounted. */
const REFRESH_MS = 30_000
/** Agents with no explicit order sink below the ordered core set. */
const UNORDERED = 999

type Prefs = ReturnType<typeof useMarketplacePrefs>

interface Marketplace {
  catalog: CatalogEntry[]
  setCatalog: React.Dispatch<React.SetStateAction<CatalogEntry[]>>
  loading: boolean
  search: string
  setSearch: (v: string) => void
  prefs: Prefs
  filtered: CatalogEntry[]
  loadAll: () => Promise<void>
  refreshAgentsStore: () => Promise<void>
}

export function useMarketplace(): Marketplace {
  const prefs = useMarketplacePrefs()
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")

  const setInstalled = useInstallStore((s) => s.setInstalled)
  const setUpdates = useInstallStore((s) => s.setUpdates)
  const installedList = useInstallStore((s) => s.installed)
  const jobs = useInstallStore((s) => s.jobs)
  const setStoreAgents = useAgentsStore((s) => s.setAgents)

  // The wizard's last step is `addAgent`, so closing the wizard is the moment
  // the agents store may have just gained an entry. Refresh so the hasInstance
  // selector in AgentDetail flips immediately instead of waiting for the next
  // 5s poll from another tab.
  const refreshAgentsStore = useCallback(async () => {
    try {
      setStoreAgents(await window.api.listAgents())
    } catch {
      /* non-fatal */
    }
  }, [setStoreAgents])

  const loadAll = useCallback(async () => {
    try {
      // Fast path: catalog + installed records so list state reflects
      // install/uninstall immediately. The npm update probe is slow on first
      // call and runs in the background.
      const [cat, inst] = await Promise.all([
        window.api.getCatalog(),
        window.api.getInstalledAgents().catch(() => [] as InstalledAgentRecord[]),
      ])
      setCatalog(cat)
      setInstalled(inst)
      setLoading(false)
      // Keep the shared agents store warm so AgentDetail.hasInstance is correct
      // on first navigation even if the user landed here before visiting
      // Agents/Dashboard.
      refreshAgentsStore()
      window.api
        .checkAgentUpdates()
        .then(setUpdates)
        .catch(() => {
          /* non-fatal */
        })
    } catch {
      setLoading(false)
    }
  }, [setInstalled, setUpdates, refreshAgentsStore])

  useEffect(() => {
    loadAll()
    const id = setInterval(loadAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [loadAll])

  // Re-pull catalog + installed list whenever a job finishes so badges flip.
  useEffect(() => {
    const finished = Object.values(jobs).some(
      (j) => j.phase === "done" || j.phase === "error",
    )
    if (finished) loadAll()
  }, [jobs, loadAll])

  const filtered = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.key === prefs.prefs.category) || CATEGORIES[0]
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

    if (prefs.prefs.sort === "featured") {
      result.sort((a, b) => {
        const ao = typeof a.coreOrder === "number" ? a.coreOrder : UNORDERED
        const bo = typeof b.coreOrder === "number" ? b.coreOrder : UNORDERED
        return ao !== bo ? ao - bo : byName(a, b)
      })
    } else if (prefs.prefs.sort === "newest") {
      result.sort((a, b) => {
        const ar = installedList.find((r) => r.name === a.name)?.installedAt || ""
        const br = installedList.find((r) => r.name === b.name)?.installedAt || ""
        return ar !== br ? br.localeCompare(ar) : byName(a, b)
      })
    } else if (prefs.prefs.sort === "popular") {
      result.sort((a, b) => {
        const ai = a.installed ? 1 : 0
        const bi = b.installed ? 1 : 0
        return ai !== bi ? bi - ai : byName(a, b)
      })
    } else if (prefs.prefs.sort === "name") {
      result.sort(byName)
    }

    // Coming-soon agents always sink below the supported core set, whatever the
    // chosen sort. Applied last; Array.sort is stable so in-group order holds.
    result.sort((a, b) => (a.comingSoon ? 1 : 0) - (b.comingSoon ? 1 : 0))
    return result
  }, [catalog, search, prefs.prefs, installedList])

  return {
    catalog,
    setCatalog,
    loading,
    search,
    setSearch,
    prefs,
    filtered,
    loadAll,
    refreshAgentsStore,
  }
}
