import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "lucide-react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { Button } from "../ui/button"
import { Field, FieldDescription, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import { QuickConnectBrowserTab } from "./QuickConnectBrowserTab"
import { humanizeError } from "./humanize-error"
import type { ToastType } from "../../hooks/useToast"
import { capture } from "../../lib/analytics"

const WORKSPACE_SITE = "https://workspace.openagents.org/"
const MODES = ["paste", "create", "browser"] as const
type Mode = (typeof MODES)[number]

/**
 * Quick-connect surface for stage.md §4.1 — supports:
 *   - paste URL auto-parse (extracts slug + ?token=…)
 *   - paste token auto-detect
 *   - create new workspace
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
  const [mode, setMode] = useState<Mode>("paste")
  const [pasted, setPasted] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ slug?: string; token?: string } | null>(null)

  useEffect(() => {
    if (open) {
      setPasted("")
      setName("")
      setResult(null)
      setMode("paste")
    }
  }, [open])

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
      setBusy(false)
    }
  }

  const handleCreate = async (): Promise<void> => {
    const n = name.trim()
    if (!n) {
      showToast(t("workspaces.quickConnect.toast.enterName"), "warning")
      return
    }
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
      setBusy(false)
    }
  }

  const handleBrowser = (): void => {
    window.api.openExternal(WORKSPACE_SITE)
    showToast(t("workspaces.quickConnect.toast.browserOpened"), "info")
    setMode("paste")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workspaces.quickConnect.title")}</DialogTitle>
        </DialogHeader>

        <DialogBody>
          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            {/* Equal thirds rather than `w-fit`: the three labels differ wildly
                in length, and content-width triggers left the strip lopsided. */}
            <TabsList className="grid w-full grid-cols-3">
              {MODES.map((m) => (
                <TabsTrigger key={m} value={m} className="text-xs">
                  {t(
                    `workspaces.quickConnect.tab${m.charAt(0).toUpperCase()}${m.slice(1)}`,
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="paste">
              <Field>
                <FieldLabel htmlFor="quick-connect-paste">
                  {t("workspaces.quickConnect.pasteLabel")}
                </FieldLabel>
                <Input
                  id="quick-connect-paste"
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  placeholder={t("workspaces.quickConnect.pastePlaceholder")}
                  autoFocus
                />
                <FieldDescription>
                  {t("workspaces.quickConnect.pasteHint")}
                </FieldDescription>
              </Field>
            </TabsContent>

            <TabsContent value="create" className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="quick-connect-name">
                  {t("workspaces.quickConnect.createLabel")}
                </FieldLabel>
                <Input
                  id="quick-connect-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("workspaces.quickConnect.createPlaceholder")}
                  autoFocus
                />
              </Field>
              {result?.token && (
                <div className="rounded-sm bg-(--success-bg) px-3 py-2 text-xs break-all text-(--success-text)">
                  <div className="mb-1 font-semibold">
                    {t("workspaces.quickConnect.ready")}
                  </div>
                  <div className="text-2xs">
                    {t("workspaces.quickConnect.readySlug", { slug: result.slug })}
                  </div>
                  <div className="text-2xs">
                    {t("workspaces.quickConnect.readyToken", { token: result.token })}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="browser">
              <QuickConnectBrowserTab />
            </TabsContent>
          </Tabs>
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("workspaces.quickConnect.close")}
          </Button>
          {mode === "paste" && (
            <Button onClick={handlePasteConnect} disabled={busy}>
              {busy
                ? t("workspaces.quickConnect.connecting")
                : t("workspaces.quickConnect.connect")}
            </Button>
          )}
          {mode === "create" && (
            <Button onClick={handleCreate} disabled={busy}>
              {busy
                ? t("workspaces.quickConnect.creating")
                : t("workspaces.quickConnect.createBtn")}
            </Button>
          )}
          {mode === "browser" && (
            <Button onClick={handleBrowser}>
              <ExternalLink />
              {t("workspaces.quickConnect.openSite")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
