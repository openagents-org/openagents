import React, { useEffect, useRef, useState } from "react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import {
  CreatePanel,
  PairPanel,
  PastePanel,
} from "./quick-connect-panels"
import { humanizeError } from "./humanize-error"
import type { ToastType } from "../../hooks/useToast"
import { capture, group } from "../../lib/analytics"
import {
  PAIRING_CODE_LENGTH,
  cleanIpcError,
  normalizeCode,
} from "../../lib/pairing-code"

export const QUICK_CONNECT_MODES = ["pair", "paste", "create"] as const
export type QuickConnectMode = (typeof QUICK_CONNECT_MODES)[number]

/**
 * The one dialog behind both header buttons — Join workspace opens it on
 * `pair`, Create workspace on `create`.
 *
 *   - **pair**   redeem a pairing code: this device joins the workspace as a
 *                node, and agents can then be installed on it from there.
 *   - **paste**  a workspace link or token (slug + ?token=… auto-parsed).
 *   - **create** a brand new workspace.
 *
 * A fourth tab used to offer "sign in with the browser", which only opened
 * workspace.openagents.org and told the user to come back and paste — the paste
 * tab with extra steps. Pairing is the thing that link was standing in for.
 */
export function WorkspaceQuickConnect({
  open,
  defaultMode = "pair",
  onClose,
  onCreated,
  showToast,
}: {
  open: boolean
  /** Which tab the button that opened this dialog is asking for. */
  defaultMode?: QuickConnectMode
  onClose: () => void
  onCreated: () => void
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<QuickConnectMode>(defaultMode)
  const [pasted, setPasted] = useState("")
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  // `disabled={busy}` only takes effect on the next render, so a fast double
  // click fired the request twice. This latch closes in the same tick.
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ slug?: string; token?: string } | null>(null)

  useEffect(() => {
    if (open) {
      setPasted("")
      setCode("")
      setName("")
      setResult(null)
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

  const handleCreate = async (): Promise<void> => {
    const n = name.trim()
    if (!n) {
      showToast(t("workspaces.quickConnect.toast.enterName"), "warning")
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const r = (await window.api.createWorkspace(n)) as {
        token?: string
        slug?: string
      }
      setResult(r)
      capture("workspace_created", { source: "quick_connect" })
      onCreated()
      showToast(t("workspaces.quickConnect.toast.created"), "success")
    } catch (err) {
      showToast(humanizeError(err, t), "error")
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  // Redeeming a code registers this device as a node AND saves the workspace
  // locally, so it lands in the list exactly like the other two paths.
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
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as QuickConnectMode)
              setError(null)
            }}
          >
            {/* Equal thirds rather than `w-fit`: the three labels differ wildly
                in length, and content-width triggers left the strip lopsided. */}
            <TabsList className="grid w-full grid-cols-3">
              {QUICK_CONNECT_MODES.map((m) => (
                <TabsTrigger key={m} value={m} className="text-xs">
                  {t(
                    `workspaces.quickConnect.tab${m.charAt(0).toUpperCase()}${m.slice(1)}`,
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="pair">
              <PairPanel
                code={code}
                onChange={(v) => {
                  setCode(v)
                  setError(null)
                }}
                onSubmit={() => void handlePair()}
                error={error}
              />
            </TabsContent>

            <TabsContent value="paste">
              <PastePanel value={pasted} onChange={setPasted} />
            </TabsContent>

            <TabsContent value="create" className="flex flex-col gap-3">
              <CreatePanel name={name} onChange={setName} result={result} />
            </TabsContent>
          </Tabs>
        </DialogBody>

        <DialogFooter>
          {!(mode === "create" && result) && (
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              {t("workspaces.quickConnect.close")}
            </Button>
          )}
          {mode === "paste" && (
            <Button onClick={handlePasteConnect} disabled={busy}>
              {busy
                ? t("workspaces.quickConnect.connecting")
                : t("workspaces.quickConnect.connect")}
            </Button>
          )}
          {mode === "create" && result && (
            <Button onClick={onClose}>
              {t("workspaces.quickConnect.done")}
            </Button>
          )}
          {mode === "create" && !result && (
            <Button onClick={handleCreate} disabled={busy}>
              {busy
                ? t("workspaces.quickConnect.creating")
                : t("workspaces.quickConnect.createBtn")}
            </Button>
          )}
          {mode === "pair" && (
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
