import { useState } from "react"
import { useTranslation } from "react-i18next"

import type { PlatformDef } from "./platforms"
import type { ConnectionRecord, ConnectionTestResult } from "../../types"
import type { ToastType } from "../../hooks/useToast"

export interface ConnectDraft {
  credentialId: string
  newSecret: string
  newLabel: string
  accountHint: string
}

interface Options {
  platform: PlatformDef
  existing: ConnectionRecord | null
  onSaved: () => Promise<void> | void
  showToast: (msg: string, type?: ToastType) => void
}

interface Connect {
  working: boolean
  result: ConnectionTestResult | null
  reset: () => void
  submit: (draft: ConnectDraft) => Promise<void>
}

/** Saves the credential (creating one if needed), upserts the connection, then tests it. */
export function usePlatformConnect({
  platform,
  existing,
  onSaved,
  showToast,
}: Options): Connect {
  const { t } = useTranslation()
  const [working, setWorking] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)

  const submit = async (draft: ConnectDraft): Promise<void> => {
    setWorking(true)
    setResult(null)
    try {
      // Resolve credential — create one if user picked "new".
      let credId = draft.credentialId
      if (credId === "__new__") {
        if (!draft.newSecret) {
          showToast(t("connections.toast.pasteToken"), "warning")
          return
        }
        const fallbackLabel = t("connections.dialog.defaultLabel", {
          platform: platform.label,
        })
        const created = await window.api.upsertCredential({
          provider: platform.id,
          kind: platform.defaultCredentialKind,
          label: draft.newLabel.trim() || fallbackLabel,
          secret: draft.newSecret,
          shared: true,
        })
        if (!created.ok || !created.record) {
          showToast(created.error || t("connections.toast.saveCredentialFailed"), "error")
          return
        }
        credId = created.record.id
      }

      const upserted = await window.api.upsertConnection({
        id: existing?.id,
        platform: platform.id,
        credentialId: credId,
        account: draft.accountHint.trim() || undefined,
        label: existing?.label,
        status: "disconnected",
      })
      const test = await window.api.testConnection(upserted.id)
      setResult(test)
      if (test.ok) {
        showToast(
          t("connections.toast.connected", { platform: platform.label }),
          "success",
        )
      } else {
        showToast(
          t("connections.toast.testFailed", { detail: test.detail || test.status }),
          "warning",
        )
      }
      await onSaved()
    } catch (err) {
      showToast(
        t("connections.toast.error", { message: (err as Error).message }),
        "error",
      )
    } finally {
      setWorking(false)
    }
  }

  return { working, result, reset: () => setResult(null), submit }
}
