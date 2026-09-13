import { useCallback, useEffect, useState } from "react"

import type { ImportCandidate } from "../../../shared/credential-import"

export interface CredentialImportApi {
  candidates: ImportCandidate[]
  scanning: boolean
  /** The scan for this opening has finished, whatever it found. */
  scanned: boolean
  selected: string | null
  select: (id: string) => void
  /** Reads pasted text; false when nothing this agent can use was in it. */
  parse: (text: string) => Promise<boolean>
  /** The picked candidate as form values, or null when main no longer holds it. */
  resolve: () => Promise<Record<string, string> | null>
}

/**
 * One import dialog's state. A scan runs each time the dialog opens: keys change
 * between visits, and main only resolves what its latest scan found.
 */
export function useCredentialImport(
  agentType: string,
  open: boolean,
): CredentialImportApi {
  const [candidates, setCandidates] = useState<ImportCandidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setScanning(true)
    setScanned(false)
    setCandidates([])
    setSelected(null)
    window.api
      .scanCredentialImports(agentType)
      .then((found) => {
        if (cancelled) return
        // Anything pasted while the scan ran stays on top.
        setCandidates((pasted) => [...pasted, ...found])
        // One offer is the obvious pick; several are the user's to choose.
        setSelected((current) =>
          current ?? (found.length === 1 ? found[0].id : null),
        )
      })
      .catch(() => {})
      .finally(() => {
        if (cancelled) return
        setScanning(false)
        setScanned(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, agentType])

  const parse = useCallback(
    async (text: string): Promise<boolean> => {
      const found = await window.api
        .parseCredentialImport(agentType, text)
        .catch(() => [] as ImportCandidate[])
      if (!found.length) return false
      setCandidates((prev) => [...found, ...prev])
      setSelected(found[0].id)
      return true
    },
    [agentType],
  )

  const resolve = useCallback(
    async (): Promise<Record<string, string> | null> =>
      selected
        ? window.api
            .resolveCredentialImport(agentType, selected)
            .catch(() => null)
        : null,
    [agentType, selected],
  )

  return {
    candidates,
    scanning,
    scanned,
    selected,
    select: setSelected,
    parse,
    resolve,
  }
}
