import React, { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { CredentialFormFields } from "./CredentialFormFields"
import { PLATFORMS } from "../connections/platforms"
import { capture } from "../../lib/analytics"
import { cn } from "../../lib/utils"
import type {
  ConnectionTestResult,
  CredentialKind,
  CredentialSummary,
} from "../../types"
import type { ToastType } from "../../hooks/useToast"

export interface CredentialDraft {
  id?: string
  provider: string
  kind: CredentialKind
  label: string
  secret?: string
  shared: boolean
  scopes: string[]
}

interface Props {
  open: boolean
  onClose: () => void
  initial?: CredentialSummary | null
  onSaved: (cred: CredentialSummary) => void
  showToast: (msg: string, type?: ToastType) => void
  /** When set, locks the provider dropdown to this value (used by ConnectionsHub). */
  lockedProvider?: string
}

export function CredentialEditor({
  open,
  onClose,
  initial,
  onSaved,
  showToast,
  lockedProvider,
}: Props): React.JSX.Element {
  const { t } = useTranslation()
  const defaults = useMemo<CredentialDraft>(() => {
    if (initial) {
      return {
        id: initial.id,
        provider: initial.provider,
        kind: initial.kind,
        label: initial.label,
        secret: "",
        shared: initial.shared,
        scopes: initial.scopes || [],
      }
    }
    const provider = lockedProvider || "openai"
    const def = PLATFORMS.find((p) => p.id === provider)
    return {
      provider,
      kind: def?.defaultCredentialKind || "api_key",
      label: def ? `${def.label} default` : "",
      secret: "",
      shared: true,
      scopes: [],
    }
  }, [initial, lockedProvider])

  const [draft, setDraft] = useState<CredentialDraft>(defaults)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)

  useEffect(() => {
    if (open) {
      setDraft(defaults)
      setTestResult(null)
    }
  }, [open, defaults])

  const updateProvider = (provider: string): void => {
    const def = PLATFORMS.find((p) => p.id === provider)
    setDraft((d) => ({
      ...d,
      provider,
      kind: def?.defaultCredentialKind ?? d.kind,
      label: d.label || (def ? `${def.label} default` : ""),
    }))
    setTestResult(null)
  }

  const handleTest = async (): Promise<void> => {
    if (!draft.secret && !draft.id) {
      showToast(t("credentials.editor.toasts.enterSecretToTest"), "warning")
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await window.api.testCredential({
        id: draft.id,
        provider: draft.provider,
        secret: draft.secret || undefined,
      })
      setTestResult(res)
      showToast(
        res.ok
          ? res.account
            ? t("credentials.editor.toasts.connectedAccount", { account: res.account })
            : t("credentials.editor.toasts.connected")
          : t("credentials.editor.toasts.testFailed", {
              detail: res.detail || res.status,
            }),
        res.ok ? "success" : "error",
      )
    } catch (err) {
      const msg = (err as Error).message
      setTestResult({ ok: false, status: "error", detail: msg })
      showToast(t("credentials.editor.toasts.testFailedError", { message: msg }), "error")
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!draft.label.trim()) {
      showToast(t("credentials.editor.toasts.labelRequired"), "warning")
      return
    }
    if (!draft.id && !draft.secret) {
      showToast(t("credentials.editor.toasts.secretRequired"), "warning")
      return
    }
    setSaving(true)
    try {
      const res = await window.api.upsertCredential({
        id: draft.id,
        provider: draft.provider,
        kind: draft.kind,
        label: draft.label.trim(),
        secret: draft.secret || undefined,
        shared: draft.shared,
        scopes: draft.scopes,
      })
      if (res.ok && res.record) {
        capture("credential_saved", {
          provider: draft.provider,
          kind: draft.kind,
          is_update: !!draft.id,
        })
        onSaved(res.record)
        showToast(
          draft.id
            ? t("credentials.editor.toasts.updated")
            : t("credentials.editor.toasts.added"),
          "success",
        )
        onClose()
      } else {
        showToast(res.error || t("credentials.editor.toasts.saveFailed"), "error")
      }
    } catch (err) {
      showToast(
        t("credentials.editor.toasts.error", { message: (err as Error).message }),
        "error",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {draft.id
              ? t("credentials.editor.editTitle")
              : t("credentials.editor.addTitle")}
          </DialogTitle>
        </DialogHeader>

        <DialogBody>
          <CredentialFormFields
            draft={draft}
            onPatch={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onProviderChange={updateProvider}
            providerLocked={!!lockedProvider || !!draft.id}
          />

          {testResult && (
            <p
              className={cn(
                "rounded-sm px-3 py-2 text-xs",
                testResult.ok
                  ? "bg-(--success-bg) text-(--success-text)"
                  : "bg-(--danger-bg) text-(--danger-text)",
              )}
            >
              {testResult.ok
                ? testResult.account
                  ? t("credentials.editor.testOkAccount", { account: testResult.account })
                  : t("credentials.editor.testOk")
                : t("credentials.editor.testFailedResult", {
                    detail: testResult.detail || testResult.status,
                  })}
            </p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("credentials.editor.cancel")}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || saving}>
            {testing
              ? t("credentials.editor.testing")
              : t("credentials.editor.testConnection")}
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("credentials.editor.saving") : t("credentials.editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
