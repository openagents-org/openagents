import { useEffect, useState } from "react"

import type { AgentUpdateTarget, CatalogEntry } from "@renderer/types"

/**
 * Where "Update" will put this agent's new version. Only asked for an install
 * the launcher did not place — for its own copies the answer is always the
 * managed runtime. Re-read after a job finishes (`jobPhase`), since an update
 * can change which copy is in play.
 */
export function useUpdateTarget(
  entry: CatalogEntry,
  jobPhase: string | undefined,
): AgentUpdateTarget | null {
  const unmanaged = !!entry.installed && entry.managed === false
  const [target, setTarget] = useState<{
    name: string
    value: AgentUpdateTarget
  } | null>(null)

  useEffect(() => {
    if (!unmanaged) return
    let cancelled = false
    window.api
      .getAgentUpdateTarget(entry.name)
      .then((value) => {
        if (!cancelled) setTarget({ name: entry.name, value })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [entry.name, unmanaged, jobPhase])

  return unmanaged && target?.name === entry.name ? target.value : null
}
