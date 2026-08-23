import React, { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Link2 } from "lucide-react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { PairPanel, PastePanel } from "./quick-connect-panels"
import { ManualDeprecationNotice } from "./manual-deprecation-notice"
import { humanizeError } from "./humanize-error"
import type { ToastType } from "../../hooks/useToast"
import { capture, group } from "../../lib/analytics"
import {
  PAIRING_CODE_LENGTH,
  cleanIpcError,
  normalizeCode,
} from "../../lib/pairing-code"

export const QUICK_CONNECT_MODES = ["pair", "paste"] as const
export type QuickConnectMode = (typeof QUICK_CONNECT_MODES)[number]

/**
 * The dialog behind "Add workspace" — pairing-first.
 *
 *   - **pair**   (default) redeem a pairing code: this device joins the
 *                workspace as a node, and agents can then be installed on it
 *                from there.
 *   - **paste**  the deprecated manual path — a workspace link or token —
 *                reachable only through the demoted link under the pair form.
 *                Kept functional for existing users, with a dismissible
 *                retirement notice.
 *
 * The create tab is gone: workspaces are created on the web after signing in
 * (the pair panel links there). A "sign in with the browser" tab predating
 * that met the same fate for the same reason.
 */
export function WorkspaceQuickConnect({
  open,
  defaultMode = "pair",
  onClose,
  onCreated,
  showToast,
}: {
  open: boolean
  /** Which view the button that opened this dialog is asking for. */
  defaultMode?: QuickConnectMode
  onClose: () => void
  onCreated: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<QuickConnectMode>(defaultMode)
  const [pasted, setPasted] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  // `disabled={busy}` only takes effect on the next render, so a fast double
  // click fired the request twice. This latch closes in the same tick.
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPasted("")
      setCode("")
      setError(null)
      setMode(defaultMode)
    }
  }, [open, defaultMode])

  const parseInput = (
    raw: string,
  ): { url?: string; slug?: string; token?: string; customUrl?: boolean } => {
    const v = raw.trim()
    if (!v) return {}
    try {
      const u = new URL(v)
      const slug = u.pathname.replace(/^\//, "").split("/")[0] || undefined
      const token = u.searchParams.get("token") || undefined
      return {
        url: v,
        slug,
        token,
        customUrl: u.hostname.toLowerCase() !== "workspace.openagents.org",
      }
    } catch {}
    return { token: v }
  }

  const handlePasteConnect = async (): Promise<void> => {
    const parsed = parseInput(pasted)
    const { slug, token } = parsed
    if (!parsed.url && !slug && !token) {
      showToast(t("workspaces.quickConnect.toast.pasteFirst"), "warning")
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const ws = await window.api.registerWorkspaceFromToken(
        parsed.customUrl ? { url: parsed.url } : { url: parsed.url, token, slug },
      )
      const label =
        ws.name || ws.slug || slug || t("workspaces.quickConnect.fallbackLabel")
      capture("manual_connect_used", { source: "quick_connect" })
      showToast(t("workspaces.quickConnect.toast.registered", { label }), "success")
      onCreated()
      onClose()
    } catch (err) {
      showToast(humanizeError(err, t), "error")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  // Redeeming a code registers this device as a node AND saves the workspace
  // locally, so it lands in the list exactly like the manual path.
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
      setError(cleanIpcError((err as Error).message || ""))
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
        </DialogHeader>

        <DialogBody>
          {mode === "pair" ? (
            <>
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
              <button
                type="button"
                data-testid="qc-manual-toggle"
                onClick={() => {
                  setMode("paste")
                  setError(null)
                }}
                className="mt-2 flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-xs text-muted-foreground hover:text-foreground"
              >
                <Link2 className="size-3" />
                {t("workspaces.quickConnect.manualDeprecated")}
              </button>
            </>
          ) : (
            <>
              <ManualDeprecationNotice />
              <PastePanel value={pasted} onChange={setPasted} />
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {/* "Cancel", not "Close": both panels are forms waiting to be
              submitted, so the button backs out of an action rather than
              dismissing a notice. */}
          {mode === "pair" ? (
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {t("workspaces.quickConnect.cancel")}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                setMode("pair")
                setError(null)
              }}
              disabled={busy}
            >
              {t("workspaces.quickConnect.back")}
            </Button>
          )}
          {mode === "paste" ? (
            <Button onClick={handlePasteConnect} disabled={busy}>
              {busy
                ? t("workspaces.quickConnect.connecting")
                : t("workspaces.quickConnect.connect")}
            </Button>
          ) : (
            <Button
              onClick={() => void handlePair()}
              disabled={busy || normalizeCode(code).length !== PAIRING_CODE_LENGTH}
            >
              {busy
                ? t("workspaces.quickConnect.connecting")
                : t("workspaces.quickConnect.pairBtn")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
