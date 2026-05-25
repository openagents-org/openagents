import React, { useEffect, useState } from "react"
import { ExternalLink, Globe } from "lucide-react"
import { Modal, ModalActions } from "../ui/Modal"
import { Button } from "../ui/Button"
import { Input } from "../ui/Input"
import { Label } from "../ui/Label"
import type { ToastType } from "../../hooks/useToast"

function humanizeError(err: unknown): string {
  const raw = (err as Error)?.message ?? String(err)
  if (/ERR_TLS_CERT_ALTNAME_INVALID|altnames/i.test(raw)) {
    return "Workspace service is temporarily unreachable (TLS certificate mismatch). Please try again later or contact support."
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) {
    return "Cannot reach the workspace service. Check your internet connection and try again."
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|timed out/i.test(raw)) {
    return "Workspace service didn't respond in time. Please try again in a moment."
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
      showToast("Paste a workspace URL or token", "warning")
      return
    }
    setBusy(true)
    try {
      const ws = await window.api.registerWorkspaceFromToken(
        parsed.customUrl
          ? { url: parsed.url }
          : { url: parsed.url, token, slug },
      )
      const label = ws.name || ws.slug || slug || "workspace"
      showToast(
        `Registered ${label}. Open Agents tab to connect an agent.`,
        "success",
      )
      onCreated()
      onClose()
    } catch (err) {
      showToast(humanizeError(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const handleCreate = async (): Promise<void> => {
    const n = name.trim()
    if (!n) {
      showToast("Enter a workspace name", "warning")
      return
    }
    setBusy(true)
    try {
      const r = (await window.api.createWorkspace(n)) as {
        token?: string
        slug?: string
      }
      setResult(r)
      onCreated()
      showToast("Workspace created", "success")
    } catch (err) {
      showToast(humanizeError(err), "error")
    } finally {
      setBusy(false)
    }
  }

  const handleBrowser = (): void => {
    window.api.openExternal("https://workspace.openagents.org/")
    showToast(
      "Opened workspace site in your browser. Paste the URL back here when done.",
      "info",
    )
    setMode("paste")
  }

  return (
    <Modal open={open} onClose={onClose} title="Quick connect">
      <div className="flex gap-1 p-1 rounded-(--radius-sm) bg-(--bg-input) mb-4 w-fit">
        {(["paste", "create", "browser"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1 text-[11px] font-medium rounded-sm cursor-pointer border-0 ${
              mode === m
                ? "bg-(--bg-card) text-(--text-primary) shadow-sm"
                : "bg-transparent text-(--text-secondary)"
            }`}
          >
            {m === "paste"
              ? "Paste URL / token"
              : m === "create"
                ? "Create new"
                : "Browser auth"}
          </button>
        ))}
      </div>

      {mode === "paste" && (
        <div className="flex flex-col gap-3">
          <div>
            <Label className="mb-1.5">Workspace URL or invitation token</Label>
            <Input
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="https://workspace.openagents.org/my-team?token=… or http://localhost:8000/my-team?token=…"
              autoFocus
            />
            <div className="text-[11px] text-(--text-tertiary) mt-1.5">
              Hosted URLs use remote token resolution. Custom URLs use the URL origin, first path segment, and token query parameter.
            </div>
          </div>
        </div>
      )}

      {mode === "create" && (
        <div className="flex flex-col gap-3">
          <div>
            <Label className="mb-1.5">Workspace name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Team"
              autoFocus
            />
          </div>
          {result?.token && (
            <div className="px-3 py-2 bg-(--success-bg) text-(--success-text) rounded-sm text-[12px] break-all">
              <div className="font-semibold mb-1">Workspace ready</div>
              <div className="text-[11px]">slug: {result.slug}</div>
              <div className="text-[11px]">token: {result.token}</div>
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
                Sign in via your browser
              </div>
              <div className="text-[11px] text-(--text-secondary) leading-relaxed break-all">
                Opens <code className="inline-code">workspace.openagents.org</code> so you can sign in or accept an invite.
              </div>
            </div>
          </div>

          <ol className="m-0 p-0 list-none flex flex-col gap-2">
            {[
              "Open the workspace site in your browser.",
              "Sign in or accept the invite.",
              "Copy the workspace URL and paste it in the “Paste URL / token” tab.",
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
            Open workspace site
          </Button>
        </div>
      )}

      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Close
        </Button>
        {mode === "paste" && (
          <Button variant="primary" onClick={handlePasteConnect} disabled={busy}>
            {busy ? "Connecting..." : "Connect"}
          </Button>
        )}
        {mode === "create" && (
          <Button variant="primary" onClick={handleCreate} disabled={busy}>
            {busy ? "Creating..." : "Create"}
          </Button>
        )}
      </ModalActions>
    </Modal>
  )
}
