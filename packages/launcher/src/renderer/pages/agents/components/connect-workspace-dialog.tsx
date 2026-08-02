import React, { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CornerDownLeft, Link2, Plus } from "lucide-react"

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
import { Field, FieldLabel } from "@renderer/components/ui/field"
import { Input } from "@renderer/components/ui/input"
import { SearchInput } from "@renderer/components/ui-kit"
import { useAgentsStore } from "@renderer/store/agents"
import { capture } from "@renderer/lib/analytics"
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
  const [view, setView] = useState<"list" | "create" | "token">("list")
  const [newWsName, setNewWsName] = useState("")
  const [token, setToken] = useState("")
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const parseWorkspaceUrl = (raw: string): URL | null => {
    try {
      return new URL(raw.trim())
    } catch {
      return null
    }
  }

  useEffect(() => {
    if (!open) return
    setView("list")
    setNewWsName("")
    setToken("")
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

  const doCreate = async (): Promise<void> => {
    const name = newWsName.trim()
    if (!name) {
      showToast(
        t("agents.connectDialog.toast.workspaceNameRequired"),
        "warning",
      )
      return
    }
    try {
      showToast(
        t("agents.connectDialog.toast.creatingWorkspace", { name }),
        "info",
      )
      const result = await window.api.createWorkspace(name)
      capture("workspace_created", { source: "agents_page" })
      showToast(
        t("agents.connectDialog.toast.workspaceCreated", { name }),
        "success",
      )
      if (result && result.token && agentName) {
        await window.api.connectWorkspace(agentName, result.token)
        window.api.signalReload()
        showToast(
          t("agents.connectDialog.toast.connectedToName", {
            name: agentName,
            workspace: name,
          }),
          "success",
        )
      }
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

  const doJoinToken = async (): Promise<void> => {
    const trimmedToken = token.trim()
    if (!trimmedToken) {
      showToast(t("agents.connectDialog.toast.urlOrTokenRequired"), "warning")
      return
    }
    try {
      showToast(t("agents.connectDialog.toast.joining"), "info")
      const parsedUrl = parseWorkspaceUrl(trimmedToken)
      if (parsedUrl && parsedUrl.hostname !== "workspace.openagents.org") {
        const ws = await window.api.registerWorkspaceFromToken({
          url: trimmedToken,
        })
        const workspaceKey = ws.slug || ws.id
        if (!workspaceKey) throw new Error("Could not register workspace URL")
        await window.api.connectWorkspace(agentName, workspaceKey)
      } else {
        await window.api.connectWorkspace(agentName, trimmedToken)
      }
      window.api.signalReload()
      showToast(t("agents.connectDialog.toast.joined"), "success")
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
          {view === "list" && (
            <DialogDescription>
              {t("agents.connectDialog.keyboardHint")}
            </DialogDescription>
          )}
        </DialogHeader>

        {view === "list" && (
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
                        active ? "bg-accent" : "hover:bg-accent/60",
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

            {/* Two stacked entry points rather than the shared evenly-split
                button row — these are navigation, not the dialog's action. */}
            <DialogFooter className="flex-col gap-0 p-0 sm:flex-col sm:*:flex-none">
              <Button
                variant="ghost"
                onClick={() => setView("create")}
                className="w-full justify-start rounded-none px-6 py-3 font-normal"
              >
                <Plus />
                {t("agents.connectDialog.createNew")}
              </Button>
              <Button
                variant="ghost"
                data-testid="ws-join-toggle"
                onClick={() => setView("token")}
                className="w-full justify-start rounded-none px-6 py-3 font-normal"
              >
                <Link2 />
                {t("agents.connectDialog.joinWithToken")}
              </Button>
              {/* Ruled off from the two entry points above — leaving without
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
        )}

        {view !== "list" && (
          <>
            <DialogBody>
              {view === "create" ? (
                <Field>
                  <FieldLabel htmlFor="new-workspace-name">
                    {t("agents.connectDialog.workspaceName")}
                  </FieldLabel>
                  <Input
                    id="new-workspace-name"
                    value={newWsName}
                    onChange={(e) => setNewWsName(e.target.value)}
                    placeholder={t(
                      "agents.connectDialog.workspaceNamePlaceholder",
                    )}
                    autoFocus
                  />
                </Field>
              ) : (
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
                </Field>
              )}
            </DialogBody>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t("agents.connectDialog.cancel")}
              </Button>
              {view === "create" ? (
                <Button onClick={doCreate}>
                  {t("agents.connectDialog.create")}
                </Button>
              ) : (
                <Button data-testid="ws-join" onClick={doJoinToken}>
                  {t("agents.connectDialog.join")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
