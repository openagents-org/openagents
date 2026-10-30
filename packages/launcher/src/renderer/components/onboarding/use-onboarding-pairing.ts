import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import type { ToastType } from "@renderer/hooks/useToast"
import { capture, group } from "@renderer/lib/analytics"
import { useAgentsStore } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import {
  PAIRING_CODE_LENGTH,
  formatCode,
  normalizeCode,
} from "@renderer/lib/pairing-code"
import { humanizeError } from "@renderer/components/workspaces/humanize-error"
import type { NodeStatus } from "@renderer/types"

export interface OnboardingPairingApi {
  /** Display value (XXXX-XXXX); the hook normalizes before sending. */
  code: string
  setCode: (v: string) => void
  deviceName: string
  setDeviceName: (v: string) => void
  /** Filled once we know this device — the hostname seeds the name field. */
  status: NodeStatus | null
  connecting: boolean
  /** The workspace this device is now paired with, after a successful redeem. */
  connected: NodeStatus | null
  error: string | null
  canConnect: boolean
  connect: () => Promise<void>
}

/**
 * The pairing step: redeem a workspace code so this device joins as a node.
 * No agent, no keys — the workspace installs and runs agents here afterwards.
 */
export function useOnboardingPairing({
  active,
  showToast,
}: {
  /** True while the pairing step is on screen. */
  active: boolean
  showToast: (msg: string, type?: ToastType) => void
}): OnboardingPairingApi {
  const { t } = useTranslation()
  const [code, setCodeRaw] = useState("")
  const [deviceName, setDeviceName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  const [status, setStatus] = useState<NodeStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState<NodeStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Read this device's identity when the step opens: it seeds the name field
  // and tells us whether this machine is already paired with a workspace.
  useEffect(() => {
    if (!active || status) return
    window.api
      .refreshNodeStatus(true)
      .then((s) => {
        setStatus(s)
        if (!nameTouched && !deviceName) setDeviceName(s.hostname || "")
        if (s.connected) setConnected(s)
      })
      .catch(() => {})
  }, [active, status, nameTouched, deviceName])

  const setCode = useCallback((v: string): void => {
    setCodeRaw(formatCode(v))
    setError(null)
  }, [])

  const setName = useCallback((v: string): void => {
    setNameTouched(true)
    setDeviceName(v)
  }, [])

  const normalized = normalizeCode(code)
  const canConnect = normalized.length === PAIRING_CODE_LENGTH && !connecting

  const connect = useCallback(async (): Promise<void> => {
    if (normalized.length !== PAIRING_CODE_LENGTH) {
      setError(t("onboarding.flow.pairNode.errors.length"))
      return
    }
    setConnecting(true)
    setError(null)
    try {
      const res = await window.api.connectNode(normalized, {
        name: deviceName.trim() || undefined,
      })
      setConnected(res)
      setStatus(res)
      if (res.workspaceSlug) group("workspace", res.workspaceSlug)
      capture("node_connected", {
        source: "launcher_onboarding",
        workspace_id: res.workspaceSlug,
      })
      // Recorded, not toasted. The step swaps to a full "connected" panel that
      // names the workspace, and the footer turns into "Finish setup" — a
      // bottom-right toast lands exactly on that button and sits there for four
      // seconds, so the one thing left to do is the one thing covered up.
      useUiStore.getState().addActivity(
        t("onboarding.flow.pairNode.toast.connected", {
          name: res.workspaceName || res.workspaceSlug || "",
        }),
      )
      // The daemon was just (re)started, so the agent list on the other side of
      // this wizard should reflect it rather than the pre-pairing snapshot.
      await window.api
        .listAgents()
        .then((a) => useAgentsStore.getState().setAgents(a))
        .catch(() => {})
      if (res.warning) showToast(res.warning, "warning")
    } catch (e) {
      // Server-side reasons ("Invalid pairing code", "already used", "expired")
      // are shown as-is; they are more specific than anything we could write.
      const msg = (e as Error).message || ""
      setError(
        msg.includes("PAIRING_CODE_INVALID_FORMAT")
          ? t("onboarding.flow.pairNode.errors.length")
          : msg.includes("PAIRING_UNSUPPORTED_CORE")
            ? t("onboarding.flow.pairNode.errors.unsupportedCore")
            : humanizeError(e, t),
      )
    } finally {
      setConnecting(false)
    }
  }, [normalized, deviceName, showToast, t])

  return {
    code,
    setCode,
    deviceName,
    setDeviceName: setName,
    status,
    connecting,
    connected,
    error,
    canConnect,
    connect,
  }
}
