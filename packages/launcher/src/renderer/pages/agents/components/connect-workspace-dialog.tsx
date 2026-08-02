import React, { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/shadcn/dialog"
import { Button } from "@renderer/components/shadcn/button"
import { capture } from "@renderer/lib/analytics"
import { workspaceWebBaseUrl } from "@renderer/lib/workspace-urls"
import type { ToastType } from "@renderer/hooks/useToast"

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
  const [workspaces, setWorkspaces] = useState<
    Array<{
      id: string
      slug: string
      name?: string
      endpoint?: string
      token?: string
    }>
  >([])
  const [view, setView] = useState<"list" | "create" | "token">("list")
  const [newWsName, setNewWsName] = useState("")
  const [token, setToken] = useState("")

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
    window.api
      .listWorkspaces()
      .then(setWorkspaces)
      .catch(() => {})
  }, [open])

  const doConnect = async (slug: string): Promise<void> => {
    try {
      showToast(
        t("agents.connectDialog.toast.connecting", { name: agentName }),
        "info",
      )
      await window.api.connectWorkspace(agentName, slug)
      capture("workspace_connected", { agent_name: agentName })
      window.api.signalReload()
      showToast(
        t("agents.connectDialog.toast.connectedTo", { slug }),
        "success",
      )
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
      <DialogHeader>

        <DialogTitle>
        {t("agents.connectDialog.title", { name: agentName })}
      </DialogTitle>
        </DialogHeader>
        <DialogBody>
      {view === "list" && (
        <>
          {/* Existing workspaces: their own scroll region so a long list never
              pushes the create/join/cancel actions off-screen. Each row shows
              the name prominently with just the short slug (the full URL is
              redundant — same host for all — and lives in the hover title). */}
          {workspaces.length > 0 && (
            <div className="flex flex-col gap-1 mb-3 max-h-[42vh] overflow-y-auto scrollbar-hide">
              {workspaces.map((ws) => {
                const display = ws.name || ws.slug || ws.id
                const shortId = ws.slug || ws.id
                return (
                  <button
                    key={ws.id}
                    type="button"
                    title={`${workspaceWebBaseUrl(ws.endpoint)}/${shortId}`}
                    className="flex items-center justify-between gap-3 text-left px-3 py-2 text-sm w-full rounded-sm bg-(--bg-card) border border-(--border) cursor-pointer transition-all duration-150 hover:bg-(--accent-bg) hover:border-(--accent-border)"
                    onClick={() => doConnect(ws.slug || ws.id)}
                  >
                    <span className="font-medium truncate">{display}</span>
                    <span className="shrink-0 font-mono text-2xs text-(--text-tertiary)">
                      {shortId}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {/* Actions are visually distinct from workspace rows (dashed border)
              so they don't read as "just another workspace". */}
          <div className="flex flex-col gap-1">
            <button
              type="button"
              className="text-left px-3 py-2 text-sm w-full rounded-sm border border-dashed border-(--border) text-(--accent) font-medium cursor-pointer transition-all duration-150 hover:bg-(--accent-bg) hover:border-(--accent-border)"
              onClick={() => setView("create")}
            >
              {t("agents.connectDialog.createNew")}
            </button>
            <button
              type="button"
              data-testid="ws-join-toggle"
              className="text-left px-3 py-2 text-sm w-full rounded-sm border border-dashed border-(--border) text-(--text-secondary) cursor-pointer transition-all duration-150 hover:bg-(--accent-bg) hover:border-(--accent-border)"
              onClick={() => setView("token")}
            >
              {t("agents.connectDialog.joinWithToken")}
            </button>
          </div>
          <Button onClick={onClose} className="w-full mt-3">
            {t("agents.connectDialog.cancel")}
          </Button>
        </>
      )}
      {view === "create" && (
        <>
          <div className="form-group">
            <label htmlFor="new-workspace-name">
              {t("agents.connectDialog.workspaceName")}
            </label>
            <input
              id="new-workspace-name"
              type="text"
              value={newWsName}
              onChange={(e) => setNewWsName(e.target.value)}
              placeholder={t("agents.connectDialog.workspaceNamePlaceholder")}
            />
          </div>
          <div className="form-actions">
            <Button variant="default" onClick={doCreate}>
              {t("agents.connectDialog.create")}
            </Button>
            <Button onClick={onClose}>
              {t("agents.connectDialog.cancel")}
            </Button>
          </div>
        </>
      )}
      {view === "token" && (
        <>
          <div className="form-group">
            <label htmlFor="workspace-url-or-token">
              {t("agents.connectDialog.pasteUrlOrToken")}
            </label>
            <input
              id="workspace-url-or-token"
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t("agents.connectDialog.pasteUrlPlaceholder")}
            />
          </div>
          <div className="form-actions">
            <Button variant="default" data-testid="ws-join" onClick={doJoinToken}>
              {t("agents.connectDialog.join")}
            </Button>
            <Button onClick={onClose}>
              {t("agents.connectDialog.cancel")}
            </Button>
          </div>
        </>
      )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
