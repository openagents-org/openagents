import { useCallback, useEffect, useMemo, useState } from "react"

import { hasPendingUpdate, useInstallStore } from "@renderer/store/install"
import type { CatalogEntry, InstalledAgentRecord } from "@renderer/types"
import type { MarketplaceCounts } from "@renderer/pages/install/components/marketplace-stats"

/** Same cadence as the marketplace, which this replaces as the way in. */
const REFRESH_MS = 30_000

/**
 * The agent types on offer and how many are installed or out of date — the
 * marketplace's own counters, read the same way, so both pages agree. Types,
 * not instances: three Codex agents still count as one installed type.
 */
export function useAgentCatalog(): {
  catalog: CatalogEntry[]
  counts: MarketplaceCounts
  loading: boolean
} {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const installed = useInstallStore((s) => s.installed)
  const updates = useInstallStore((s) => s.updates)
  const jobs = useInstallStore((s) => s.jobs)

  const load = useCallback(async () => {
    try {
      const [cat, inst] = await Promise.all([
        window.api.getCatalog(),
        window.api.getInstalledAgents().catch(() => [] as InstalledAgentRecord[]),
      ])
      setCatalog(cat)
      useInstallStore.getState().setInstalled(inst)
      // The npm probe is slow on a cold start; the counters fill in after.
      window.api
        .checkAgentUpdates()
        .then((next) => useInstallStore.getState().setUpdates(next))
        .catch(() => {})
    } catch {
      /* keep what is on screen */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  // A finished install flips a type to installed; re-read so the cards and
  // counters follow without waiting for the next poll.
  const finished = Object.values(jobs).filter((j) => j.phase === "done" || j.phase === "error").length
  useEffect(() => {
    if (finished) void load()
  }, [finished, load])

  const counts = useMemo(
    () => ({
      available: catalog.filter((c) => !c.comingSoon).length,
      installed: installed.length,
      updatable: catalog.filter((c) => hasPendingUpdate(updates, c.name)).length,
    }),
    [catalog, installed, updates],
  )

  return { catalog, counts, loading }
}

