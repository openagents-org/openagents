import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import type { ToastType } from "@renderer/hooks/useToast"
import { capture } from "@renderer/lib/analytics"
import type { MemoryImportReceipt, MemoryScan } from "@renderer/types"

export interface OnboardingMemoryApi {
  /** The agent just created — the one memory is brought to. */
  agentName: string | null
  scan: MemoryScan | null
  scanning: boolean
  error: string | null
  picked: ReadonlySet<string>
  toggle: (id: string) => void
  /** Items picked that can still be imported. */
  pickedCount: number
  importing: boolean
  receipt: MemoryImportReceipt | null
  undoing: boolean
  rescan: () => Promise<void>
  importPicked: () => Promise<void>
  undo: () => Promise<void>
  /** Leave without importing; the workspace stops offering it too. */
  skip: () => Promise<void>
  /** Leave after an import. */
  finish: () => void
  preview: (id: string) => Promise<{ path: string; text: string }[]>
}

/**
 * "Bring your memory" — the onboarding step after createAgent. Scans the
 * user's own Claude Code / Codex / OpenClaw setup for what the new agent does
 * not have yet, and copies the picked items into it (all local; see the
 * connector's memory-import.js). A core too old to scan, or a scan that finds
 * nothing new, is not worth a stop: `onNothing` moves the flow on.
 */
export function useOnboardingMemory({
  active,
  agentName,
  showToast,
  onDone,
}: {
  active: boolean
  agentName: string | null
  showToast: (msg: string, type?: ToastType) => void
  onDone: () => void
}): OnboardingMemoryApi {
  const { t } = useTranslation()
  const [scan, setScan] = useState<MemoryScan | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [receipt, setReceipt] = useState<MemoryImportReceipt | null>(null)
  const [undoing, setUndoing] = useState(false)

  const rescan = useCallback(async (): Promise<void> => {
    if (!agentName) return
    setScanning(true)
    setError(null)
    try {
      const result = await window.api.memoryScan(agentName)
      if (!result.supported) {
        // A core without memory import, or an agent type without it: nothing
        // to show, so the step is not one.
        onDone()
        return
      }
      setScan(result)
      setPicked(new Set(result.items.filter((i) => i.selected).map((i) => i.id)))
      capture("onboarding_memory_scanned", {
        importable: result.items.filter((i) => i.status === "importable").length,
        loaded: result.items.filter((i) => i.status === "loaded").length,
        agent_type: result.type,
      })
    } catch (e) {
      setError((e as Error).message || String(e))
    } finally {
      setScanning(false)
    }
  }, [agentName, onDone])

  useEffect(() => {
    if (!active) return
    if (!agentName) {
      onDone()
      return
    }
    if (!scan && !scanning && !error) void rescan()
  }, [active, agentName, scan, scanning, error, rescan, onDone])

  const toggle = useCallback((id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const pickedCount = scan
    ? scan.items.filter((i) => i.status === "importable" && picked.has(i.id)).length
    : 0

  const importPicked = useCallback(async (): Promise<void> => {
    if (!agentName || !scan) return
    const ids = scan.items.filter((i) => i.status === "importable" && picked.has(i.id)).map((i) => i.id)
    if (!ids.length) return
    setImporting(true)
    try {
      const r = await window.api.memoryImport(agentName, ids)
      setReceipt(r)
      capture("onboarding_memory_imported", { items: r.items.length, files: r.files, agent_type: scan.type })
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setImporting(false)
    }
  }, [agentName, scan, picked, showToast])

  const undo = useCallback(async (): Promise<void> => {
    if (!agentName) return
    setUndoing(true)
    try {
      await window.api.memoryUndo(agentName)
      setReceipt(null)
      setScan(null)
      showToast(t("onboarding.flow.memory.undone"), "success")
      capture("onboarding_memory_undone")
      await rescan()
    } catch (e) {
      showToast((e as Error).message, "error")
    } finally {
      setUndoing(false)
    }
  }, [agentName, rescan, showToast, t])

  const skip = useCallback(async (): Promise<void> => {
    if (agentName) {
      capture("onboarding_memory_skipped")
      await window.api.memoryDismiss(agentName).catch(() => {})
    }
    onDone()
  }, [agentName, onDone])

  const preview = useCallback(
    (id: string) => (agentName ? window.api.memoryPreview(agentName, id) : Promise.resolve([])),
    [agentName],
  )

  return {
    agentName,
    scan,
    scanning,
    error,
    picked,
    toggle,
    pickedCount,
    importing,
    receipt,
    undoing,
    rescan,
    importPicked,
    undo,
    skip,
    finish: onDone,
    preview,
  }
}
