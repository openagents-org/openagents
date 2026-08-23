import React, { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CornerDownLeft, Laptop, Link2 } from "lucide-react"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { Button } from "@renderer/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"
import { SearchInput } from "@renderer/components/ui-kit"
import { PairPanel } from "@renderer/components/workspaces/quick-connect-panels"
import { ManualDeprecationNotice } from "@renderer/components/workspaces/manual-deprecation-notice"
import { humanizeError } from "@renderer/components/workspaces/humanize-error"
import {
  PAIRING_CODE_LENGTH,
  normalizeCode,
} from "@renderer/lib/pairing-code"
import { useAgentsStore } from "@renderer/store/agents"
import { capture, group } from "@renderer/lib/analytics"
import { cn } from "@renderer/lib/utils"
import type { ToastType } from "@renderer/hooks/useToast"

interface WorkspaceOption {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token?: string
}

export function ConnectWorkspaceDialog({
  open,
  agentName,
  onClose,
  showToast,
  onConnected,
}: {
  open: boolean
  agentName: string
  onClose: () => void
  showToast: (msg: string, type?: ToastType) => void
  onConnected: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const agents = useAgentsStore((s) => s.agents)
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [view, setView] = useState<"list" | "pair" | "token">("list")
  const [token, setToken] = useState("")
  const [code, setCode] = useState("")
  const [pairError, setPairError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setView("list")
    setToken("")
    setCode("")
    setPairError(null)
    setBusy(false)
    setQuery("")
    setCursor(0)
    window.api.listWorkspaces().then(setWorkspaces).catch(() => {})
  }, [open])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter((ws) =>
      [ws.name, ws.slug, ws.id].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [workspaces, query])

  // Keep the cursor inside the result set as the query narrows it.
  useEffect(() => setCursor(0), [query])

  // Follow the keyboard cursor when it walks past the visible window.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [cursor])

  const doConnect = async (slug: string): Promise<void> => {
    try {
      showToast(
        t("agents.connectDialog.toast.connecting", { name: agentName }),
        "info",
      )
      await window.api.connectWorkspace(agentName, slug)
      capture("workspace_connected", { agent_name: agentName })
      window.api.signalReload()
      showToast(t("agents.connectDialog.toast.connectedTo", { slug }), "success")
      onConnected()
      onClose()
    } catch (err: unknown) {
      showToast(
        t("agents.connectDialog.toast.error", {
          message: (err as Error).message,
        }),
        "error",
      )
    }
  }

  // Pair this device with a workspace, then bind the agent to it in the same
  // motion — pairing from this dialog means "connect my agent there".
  const doPair = async (): Promise<void> => {
    const normalized = normalizeCode(code)
    if (normalized.length !== PAIRING_CODE_LENGTH) {
      setPairError(t("workspaces.quickConnect.pairError"))
      return
    }
    if (busy) return
    setBusy(true)
    setPairError(null)
    try {
      const node = await window.api.connectNode(normalized)
      const label =
        node.workspaceName ||
        node.workspaceSlug ||
        t("workspaces.quickConnect.fallbackLabel")
      if (node.workspaceSlug) group("workspace", node.workspaceSlug)
      capture("node_connected", {
        source: "agents_connect_dialog",
        workspace_id: node.workspaceSlug,
      })
      showToast(t("workspaces.quickConnect.toast.paired", { label }), "success")
      if (node.warning) showToast(node.warning, "warning")
      if (node.workspaceSlug) {
        await doConnect(node.workspaceSlug)
      } else {
        // Pairing succeeded but the slug is missing — fall back to the picker
        // with a fresh list rather than guessing.
        window.api.listWorkspaces().then(setWorkspaces).catch(() => {})
        setView("list")
      }
    } catch (err) {
      setPairError(humanizeError(err, t))
    } finally {
      setBusy(false)
    }
  }

  const doJoinToken = async (): Promise<void> => {
    const trimmedToken = token.trim()
    if (!trimmedToken) {
      showToast(t("agents.connectDialog.toast.urlOrTokenRequired"), "warning")
      return
    }
    try {
      showToast(t("agents.connectDialog.toast.joining"), "info")
      // Whole-URL, bare-token and self-hosted-link inputs all go through the
      // same call: the main process pulls the token (or slug) out of a link
      // and registers a custom endpoint when there is one. Splitting that
      // decision across both sides is what let a pasted hosted URL reach the
      // backend intact and come back "Invalid or expired token".
      await window.api.connectWorkspace(agentName, trimmedToken)
      window.api.signalReload()
      capture("manual_connect_used", { agent_name: agentName })
      showToast(t("agents.connectDialog.toast.joined"), "success")
      onConnected()
      onClose()
    } catch (err: unknown) {
      showToast(humanizeError(err, t), "error")
    }
  }

  const onSearchKeyDown = (e: React.KeyboardEvent): void => {
    if (filtered.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setCursor((c) => (c + 1) % filtered.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setCursor((c) => (c - 1 + filtered.length) % filtered.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const ws = filtered[cursor]
      if (ws) void doConnect(ws.slug || ws.id)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("agents.connectDialog.title", { name: agentName })}
          </DialogTitle>
          {view === "list" && workspaces.length > 0 && (
            <DialogDescription>
              {t("agents.connectDialog.keyboardHint")}
            </DialogDescription>
          )}
        </DialogHeader>

        {view === "list" && workspaces.length === 0 ? (
          /* Not paired anywhere yet — the picker would be an empty list, so
             lead straight to pairing instead of making the user find it. */
          <>
            <DialogBody className="items-center gap-2 py-10 text-center">
              <Laptop className="size-6 text-muted-foreground" />
              <p className="m-0 text-sm font-medium">
                {t("agents.connectDialog.emptyTitle")}
              </p>
              <p className="m-0 max-w-sm text-xs text-muted-foreground">
                {t("agents.connectDialog.emptyBody")}
              </p>
              <Button className="mt-3" onClick={() => setView("pair")}>
                {t("agents.connectDialog.pairNew")}
              </Button>
            </DialogBody>
            <DialogFooter className="flex-col gap-0 p-0 sm:flex-col sm:*:flex-none">
              <Button
                variant="ghost"
                data-testid="ws-join-toggle"
                onClick={() => setView("token")}
                className="w-full justify-start rounded-none px-6 py-3 font-normal text-muted-foreground"
              >
                <Link2 />
                {t("agents.connectDialog.manualDeprecated")}
              </Button>
              <Button
                variant="ghost"
                onClick={onClose}
                className="w-full rounded-none border-t px-6 py-3"
              >
                {t("agents.connectDialog.cancel")}
              </Button>
            </DialogFooter>
          </>
        ) : view === "list" ? (
          <>
            {/* Outside DialogBody on purpose: the field and the two entry
                points below stay put, only the result list scrolls. */}
            <div className="shrink-0 border-b px-6 py-3">
              <SearchInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClear={() => setQuery("")}
                onKeyDown={onSearchKeyDown}
                placeholder={t("agents.connectDialog.searchPlaceholder")}
                autoFocus
              />
            </div>

            <DialogBody ref={listRef} className="gap-1 py-3">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {t("agents.connectDialog.noMatch")}
                </p>
              ) : (
                filtered.map((ws, i) => {
                  const shortId = ws.slug || ws.id
                  const active = i === cursor
                  // Green when an agent already sits in this workspace — the
                  // dialog has no health of its own to report.
                  const inUse = agents.some(
                    (a) => a.network === ws.slug || a.network === ws.id,
                  )
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      data-active={active}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => doConnect(shortId)}
                      className={cn(
                        "flex w-full shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-left transition-colors",
                        // `active` is the cursor, not a stored choice, so this
                        // takes the hover state the menus and the rail use —
                        // written out rather than via ROW_HOVER because the
                        // cursor here is a prop, not `:focus`.
                        active && "bg-row-hover text-row-hover-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          inUse ? "bg-success" : "bg-muted-foreground/40",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {ws.name || shortId}
                      </span>
                      <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                        {shortId}
                      </span>
                      {active && (
                        <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                    </button>
                  )
                })
              )}
            </DialogBody>

            {/* Pairing is the blessed way in; manual token connect stays
                functional but demoted (deprecation, not removal). */}
            <DialogFooter className="flex-col gap-0 p-0 sm:flex-col sm:*:flex-none">
              <Button
                variant="ghost"
                data-testid="ws-pair-toggle"
                onClick={() => setView("pair")}
                className="w-full justify-start rounded-none px-6 py-3 font-normal"
              >
                <Laptop />
                {t("agents.connectDialog.pairNew")}
              </Button>
              <Button
                variant="ghost"
                data-testid="ws-join-toggle"
                onClick={() => setView("token")}
                className="w-full justify-start rounded-none px-6 py-3 font-normal text-muted-foreground"
              >
                <Link2 />
                {t("agents.connectDialog.manualDeprecated")}
              </Button>
              {/* Ruled off from the entry points above — leaving without
                  connecting is a different kind of choice. Full foreground
                  colour, not muted: muted reads as disabled. */}
              <Button
                variant="ghost"
                onClick={onClose}
                className="w-full rounded-none border-t px-6 py-3"
              >
                {t("agents.connectDialog.cancel")}
              </Button>
            </DialogFooter>
          </>
        ) : view === "pair" ? (
          <>
            <DialogBody>
              <PairPanel
                code={code}
                onChange={setCode}
                onSubmit={() => void doPair()}
                error={pairError}
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={() => setView("list")}>
                {t("agents.connectDialog.back")}
              </Button>
              <Button
                data-testid="ws-pair"
                onClick={() => void doPair()}
                disabled={
                  busy || normalizeCode(code).length !== PAIRING_CODE_LENGTH
                }
              >
                {t("agents.connectDialog.pairAndConnect")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody>
              <ManualDeprecationNotice />
              <Field>
                <FieldLabel htmlFor="workspace-url-or-token">
                  {t("agents.connectDialog.pasteUrlOrToken")}
                </FieldLabel>
                <Input
                  id="workspace-url-or-token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder={t("agents.connectDialog.pasteUrlPlaceholder")}
                  autoFocus
                />
                {/* A browser link only carries a token when it was opened
                    from one, so the field has to say where the token lives —
                    otherwise a slug-only URL fails and there is nothing on
                    screen to tell the user what to paste instead. */}
                <FieldDescription>
                  {t("agents.connectDialog.tokenHint")}
                </FieldDescription>
              </Field>
            </DialogBody>

            <DialogFooter>
              <Button variant="outline" onClick={() => setView("list")}>
                {t("agents.connectDialog.back")}
              </Button>
              <Button data-testid="ws-join" onClick={doJoinToken}>
                {t("agents.connectDialog.join")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
