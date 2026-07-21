import React, { useEffect, useState } from "react"
import { useTranslation, Trans } from "react-i18next"
import type { TFunction } from "i18next"
import { ExternalLink, Globe } from "lucide-react"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { Tabs, TabsList, TabsTrigger } from "../ui/Tabs"
import { Label } from "../ui/Label"
import type { ToastType } from "../../hooks/useToast"
import { capture } from "../../lib/analytics"

function humanizeError(err: unknown, t: TFunction): string {
  const raw = (err as Error)?.message ?? String(err)
  if (/ERR_TLS_CERT_ALTNAME_INVALID|altnames/i.test(raw)) {
    return t("workspaces.quickConnect.error.tls")
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return t("workspaces.quickConnect.error.dns")
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out/i.test(raw)) {
    return t("workspaces.quickConnect.error.timeout")
  }
  const cleaned = raw.replace(/^Error invoking remote method '[^']+':\s*/i, "")
  return cleaned.length > 220 ? `${cleaned.slice(0, 220)}…` : cleaned
}

/**
 * Quick-connect surface for stage.md §4.1 — supports:
 *   - paste URL auto-parse (extracts slug + ?token=…)
 *   - paste token auto-detect
 *   - create new workspace
 *
 * Deep-link / OAuth jumps are intentionally stubs for now; we expose a
 * "Connect with browser" button that just opens the workspace landing page —
 * once the workspace site supports a return scheme we can wire it up.
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
  const [mode, setMode] = useState<"paste" | "create" | "browser">("paste")
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
        parsed.customUrl
          ? { url: parsed.url }
          : { url: parsed.url, token, slug },
      )
      const label =
        ws.name || ws.slug || slug || t("workspaces.quickConnect.fallbackLabel")
      showToast(
        t("workspaces.quickConnect.toast.registered", { label }),
        "success",
      )
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
    window.api.openExternal("https://workspace.openagents.org/")
    showToast(t("workspaces.quickConnect.toast.browserOpened"), "info")
    setMode("paste")
  }

  return (
    <Modal open={open} onClose={onClose} title={t("workspaces.quickConnect.title")}>
      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v as typeof mode)}
        className="mb-4 w-fit"
      >
        <TabsList>
          {(["paste", "create", "browser"] as const).map((m) => (
            <TabsTrigger key={m} value={m} className="px-3 py-1 text-[11px]">
              {m === "paste"
                ? t("workspaces.quickConnect.tabPaste")
                : m === "create"
                  ? t("workspaces.quickConnect.tabCreate")
                  : t("workspaces.quickConnect.tabBrowser")}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {mode === "paste" && (
        <div className="flex flex-col gap-3">
          <div>
            <Label className="mb-1.5">{t("workspaces.quickConnect.pasteLabel")}</Label>
            <Input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={t("workspaces.quickConnect.pastePlaceholder")}
              autoFocus
            />
            <div className="text-[11px] text-(--text-tertiary) mt-1.5">
              {t("workspaces.quickConnect.pasteHint")}
            </div>
          </div>
        </div>
      )}

      {mode === "create" && (
        <div className="flex flex-col gap-3">
          <div>
            <Label className="mb-1.5">{t("workspaces.quickConnect.createLabel")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("workspaces.quickConnect.createPlaceholder")}
              autoFocus
            />
          </div>
          {result?.token && (
            <div className="px-3 py-2 bg-(--success-bg) text-(--success-text) rounded-sm text-[12px] break-all">
              <div className="font-semibold mb-1">{t("workspaces.quickConnect.ready")}</div>
              <div className="text-[11px]">{t("workspaces.quickConnect.readySlug", { slug: result.slug })}</div>
              <div className="text-[11px]">{t("workspaces.quickConnect.readyToken", { token: result.token })}</div>
            </div>
          )}
        </div>
      )}

      {mode === "browser" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 p-3 rounded-(--radius-sm) bg-(--bg-input) border border-(--border)">
            <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full bg-(--accent)/10 text-(--accent) flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-(--text-primary) mb-0.5">
                {t("workspaces.quickConnect.browserHeading")}
              </div>
              <div className="text-[11px] text-(--text-secondary) leading-relaxed break-all">
                <Trans
                  i18nKey="workspaces.quickConnect.browserBody"
                  components={[<code className="inline-code" />]}
                />
              </div>
            </div>
          </div>

          <ol className="m-0 p-0 list-none flex flex-col gap-2">
            {[
              t("workspaces.quickConnect.step1"),
              t("workspaces.quickConnect.step2"),
              t("workspaces.quickConnect.step3"),
            ].map((step, i) => (
              <li
                key={step}
                className="flex items-start gap-2.5 text-[11px] text-(--text-secondary) leading-relaxed"
              >
                <span className="shrink-0 w-4.5 h-4.5 rounded-full bg-(--bg-input) text-(--text-primary) text-[10px] font-semibold flex items-center justify-center">
                  {i + 1}
                </span>
                <span className="pt-px">{step}</span>
              </li>
            ))}
          </ol>

          <Button variant="primary" onClick={handleBrowser} className="self-start">
            <ExternalLink className="w-3.5 h-3.5" />
            {t("workspaces.quickConnect.openSite")}
          </Button>
        </div>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          {t("workspaces.quickConnect.close")}
        </Button>
        {mode === "paste" && (
          <Button variant="primary" onClick={handlePasteConnect} disabled={busy}>
            {busy ? t("workspaces.quickConnect.connecting") : t("workspaces.quickConnect.connect")}
          </Button>
        )}
        {mode === "create" && (
          <Button variant="primary" onClick={handleCreate} disabled={busy}>
            {busy ? t("workspaces.quickConnect.creating") : t("workspaces.quickConnect.createBtn")}
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}
