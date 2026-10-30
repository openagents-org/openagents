import { useEffect, useState } from "react"

/**
 * The set of workspace slugs/ids this device is paired to, for telling a
 * paired connection apart from a legacy manual-token one. Read once per
 * mount — pairing changes are rare and every consumer re-mounts on
 * navigation.
 */
export function usePairedWorkspaces(): Set<string> | null {
  // null until the node has answered. An empty set is a real answer — this
  // device is in no workspace — and the two must not be confused: treating
  // "not yet" as "in none" flags every agent as unconnected for a frame.
  const [paired, setPaired] = useState<Set<string> | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .getNodeStatus()
      .then((s) => {
        if (cancelled) return
        const keys = new Set<string>()
        for (const w of s.workspaces || []) {
          if (w.workspaceSlug) keys.add(w.workspaceSlug)
          if (w.workspaceId) keys.add(w.workspaceId)
        }
        setPaired(keys)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return paired
}
