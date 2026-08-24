import React, { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { PairPanel } from "./quick-connect-panels"
import { humanizeError } from "./humanize-error"
import type { ToastType } from "../../hooks/useToast"
import { capture, group } from "../../lib/analytics"
import { PAIRING_CODE_LENGTH, normalizeCode } from "../../lib/pairing-code"

/**
 * The dialog behind "Add workspace" — one form, one way in: redeem a pairing
 * code and this device joins the workspace as a node, after which agents can be
 * installed on it from there.
 *
 * Everything else is gone. Workspaces are created on the web after signing in
 * (the form links there), and the manual paths that predated pairing — a
 * workspace link, a bare invitation token, a "sign in with the browser" tab —
 * are retired: they registered a workspace this device was never paired with,
 * which is a state the daemon can no longer get credentials for.
 */
export function WorkspaceQuickConnect({
  open,
  onClose,
  onCreated,
  showToast,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  // `disabled={busy}` only takes effect on the next render, so a fast double
  // click fired the request twice. This latch closes in the same tick.
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCode("")
      setError(null)
    }
  }, [open])

  // Redeeming a code registers this device as a node AND saves the workspace
  // locally, so it lands in the list ready to use.
  const handlePair = async (): Promise<void> => {
    const normalized = normalizeCode(code)
    if (normalized.length !== PAIRING_CODE_LENGTH) {
      setError(t("workspaces.quickConnect.pairError"))
      return
    }
    if (inFlight.current) return
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
      capture("node_connected", {
        source: "quick_connect",
        workspace_id: node.workspaceSlug,
      })
      showToast(t("workspaces.quickConnect.toast.paired", { label }), "success")
      if (node.warning) showToast(node.warning, "warning")
      onCreated()
      onClose()
    } catch (err) {
      setError(humanizeError(err, t))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workspaces.quickConnect.title")}</DialogTitle>
          <DialogDescription>
            {t("workspaces.quickConnect.subtitle")}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <PairPanel
            code={code}
            onChange={(v) => {
              setCode(v)
              setError(null)
            }}
            onSubmit={() => void handlePair()}
            error={error}
          />
          {/* Workspace creation lives on the web (after signing in) — the
              launcher only joins existing ones. */}
          <p className="mt-4 mb-0 text-xs text-muted-foreground">
            {t("workspaces.quickConnect.createOnWeb")}{" "}
            <button
              type="button"
              onClick={() =>
                window.api.openExternal("https://workspace.openagents.org")
              }
              className="cursor-pointer border-0 bg-transparent p-0 text-xs text-(--accent) underline underline-offset-2"
            >
              workspace.openagents.org
            </button>
          </p>
        </DialogBody>

        <DialogFooter>
          {/* "Cancel", not "Close": the form is waiting to be submitted, so the
              button backs out of an action rather than dismissing a notice. */}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("workspaces.quickConnect.cancel")}
          </Button>
          <Button
            onClick={() => void handlePair()}
            disabled={busy || normalizeCode(code).length !== PAIRING_CODE_LENGTH}
          >
            {busy
              ? t("workspaces.quickConnect.connecting")
              : t("workspaces.quickConnect.pairBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
