import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { ConnectionRecord } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

interface Options {
  mcpPlatforms: Set<string>
  refresh: () => Promise<void> | void
  showToast: (msg: string, type?: ToastType) => void
}

interface Disconnect {
  target: ConnectionRecord | null
  busyId: string | null
  request: (conn: ConnectionRecord) => void
  cancel: () => void
  confirm: () => Promise<void>
}

/** Disconnect flow: confirmation target, in-flight id, and the teardown itself. */
export function useDisconnect({ mcpPlatforms, refresh, showToast }: Options): Disconnect {
  const { t } = useTranslation()
  const [target, setTarget] = useState<ConnectionRecord | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const confirm = async (): Promise<void> => {
    if (!target) return
    setBusyId(target.id)
    try {
      // Tear the MCP registrations down first. Leaving them behind would hand
      // agents a server entry pointing at a credential we're about to drop —
      // and doing it before removeConnection means a failure here leaves the
      // connection intact to retry from.
      if (mcpPlatforms.has(target.platform)) {
        const configured = (await window.api.mcpListTargets(target.platform))
          .filter((x) => x.configured)
          .map((x) => x.id)
        if (configured.length > 0) {
          await window.api.mcpRemove({ platform: target.platform, targetIds: configured })
        }
      }
      await window.api.removeConnection(target.id)
      await refresh()
      showToast(t("connections.toast.disconnected"), "success")
    } catch (err) {
      showToast(
        t("connections.toast.error", { message: (err as Error).message }),
        "error",
      )
    } finally {
      setBusyId(null)
      setTarget(null)
    }
  }

  return {
    target,
    busyId,
    request: setTarget,
    cancel: () => setTarget(null),
    confirm,
  }
}
