import { useEffect, useState } from "react"

/**
 * The set of workspace slugs/ids this device is paired to, for telling a
 * paired connection apart from a legacy manual-token one. Read once per
 * mount — pairing changes are rare and every consumer re-mounts on
 * navigation.
 */
export function usePairedWorkspaces(): Set<string> {
  const [paired, setPaired] = useState<Set<string>>(() => new Set())

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
