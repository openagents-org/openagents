import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { humanizeError } from "./humanize-error"
import type { ToastType } from "../../hooks/useToast"
import { capture, group } from "../../lib/analytics"
import { PAIRING_CODE_LENGTH, normalizeCode } from "../../lib/pairing-code"

export interface PairedWorkspace {
  workspaceSlug?: string | null
  workspaceName?: string | null
}

/**
 * Redeeming a pairing code, shared by every form that takes one — the
 * Workspaces dialog and the empty state of an agent's "add to workspace"
 * dialog. Redeeming registers this device as a node AND saves the workspace
 * locally, so it is ready to use the moment this resolves.
 */
export function usePairDevice(
  source: string,
  showToast: (msg: string, type?: ToastType) => void,
): {
  code: string
  setCode: (v: string) => void
  busy: boolean
  error: string | null
  ready: boolean
  reset: () => void
  /** Resolves with the joined workspace, or null when nothing was joined. */
  pair: () => Promise<PairedWorkspace | null>
} {
  const { t } = useTranslation()
  const [code, setCodeState] = useState("")
  const [busy, setBusy] = useState(false)
  // `disabled={busy}` only takes effect on the next render, so a fast double
  // click fired the request twice. This latch closes in the same tick.
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const setCode = useCallback((v: string) => {
    setCodeState(v)
    setError(null)
  }, [])
  const reset = useCallback(() => {
    setCodeState("")
    setError(null)
  }, [])

  const pair = async (): Promise<PairedWorkspace | null> => {
    const normalized = normalizeCode(code)
    if (normalized.length !== PAIRING_CODE_LENGTH) {
      setError(t("workspaces.quickConnect.pairError"))
      return null
    }
    if (inFlight.current) return null
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const node = await window.api.connectNode(normalized)
      const label =
        node.workspaceName ||
        node.workspaceSlug ||
        t("workspaces.quickConnect.fallbackLabel")
      if (node.workspaceSlug) group("workspace", node.workspaceSlug)
      capture("node_connected", { source, workspace_id: node.workspaceSlug })
      showToast(t("workspaces.quickConnect.toast.paired", { label }), "success")
      if (node.warning) showToast(node.warning, "warning")
      return node
    } catch (err) {
      setError(humanizeError(err, t))
      return null
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return {
    code,
    setCode,
    busy,
    error,
    ready: normalizeCode(code).length === PAIRING_CODE_LENGTH,
    reset,
    pair,
  }
}
