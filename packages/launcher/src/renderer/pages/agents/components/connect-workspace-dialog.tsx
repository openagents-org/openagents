import React, { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CornerDownLeft, Laptop, Layers } from "lucide-react"

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
import { Skeleton } from "@renderer/components/ui/skeleton"
import { SearchInput } from "@renderer/components/ui-kit"
import { useAgentsStore } from "@renderer/store/agents"
import { useUiStore } from "@renderer/store/ui"
import { capture } from "@renderer/lib/analytics"
import { cn } from "@renderer/lib/utils"
import type { NodeStatus } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

interface WorkspaceOption {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token?: string
}

/**
 * The workspaces this device actually holds a pairing for.
 *
 * `listWorkspaces()` returns the core's local entries, which are a separate
 * record from the pairings in node.json and only kept in step by hand — so a
 * workspace that has removed this device stays in it until something notices.
 * Offering one of those to bind to produces a join that cannot authenticate,
 * so the pairing set is what the list is drawn from. No pairings, no options:
 * the empty state sends the user to the Workspaces page to join one.
 */
function pairedOnly(
  list: WorkspaceOption[],
  node: NodeStatus | null,
): WorkspaceOption[] {
  const keys = new Set<string>()
  for (const w of node?.workspaces || []) {
    if (w.workspaceSlug) keys.add(w.workspaceSlug)
    if (w.workspaceId) keys.add(w.workspaceId)
  }
  return list.filter((ws) => keys.has(ws.slug) || keys.has(ws.id))
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
  const requestCreate = useUiStore((s) => s.requestCreate)
  // null until the pairings have answered — an empty list is a real answer
  // ("this device is in no workspace") and the two must not read alike.
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[] | null>(null)
  const [query, setQuery] = useState("")
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setCursor(0)
    setWorkspaces(null)
    let cancelled = false

    void (async () => {
      // node.json first: it is on disk, so the list is right without waiting
      // for the network.
      let list: WorkspaceOption[] = []
      let node: NodeStatus | null = null
      try {
        ;[list, node] = await Promise.all([
          window.api.listWorkspaces(),
          window.api.getNodeStatus(),
        ])
      } catch {
        // Either record unreadable — offer nothing. Binding needs a pairing,
        // so an empty list is the honest answer, not a reason to fall back to
        // the unverified one.
      }
      if (cancelled) return
      setWorkspaces(pairedOnly(list, node))

      // Then ask the workspaces themselves, since being removed happens on
      // their side and nothing tells this machine. Until now only the
      // Workspaces page ever asked, so a device removed while the user was
      // anywhere else went on offering the workspace it had lost. `force`
      // skips the once-a-minute throttle that page's polling relies on.
      let fresh: NodeStatus | null = null
      try {
        fresh = await window.api.refreshNodeStatus(true)
      } catch {
        // Offline — what is on disk stands.
      }
      if (cancelled || !fresh) return
      setWorkspaces(pairedOnly(list, fresh))
    })()

    return () => {
      cancelled = true
    }
  }, [open])

  const options = workspaces || []

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((ws) =>
      [ws.name, ws.slug, ws.id].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [options, query])

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
          {options.length > 0 && (
            <DialogDescription>
              {t("agents.connectDialog.keyboardHint")}
            </DialogDescription>
          )}
        </DialogHeader>

        {workspaces === null ? (
          /* Not the empty state: until the pairings answer, "this device is in
             no workspace" is not yet known, and showing it would send the user
             off to re-pair a device that is paired. */
          <DialogBody className="gap-2 py-6">
            <Skeleton className="h-9 shrink-0" />
            <Skeleton className="h-9 shrink-0" />
            <Skeleton className="h-9 shrink-0" />
          </DialogBody>
        ) : options.length === 0 ? (
          /* This dialog picks from the workspaces this device is paired with;
             pairing is the Workspaces page's job, so with none to pick from the
             empty state hands the user over to it rather than growing a second
             pairing form. A workspace that removed this device lands here too:
             it is gone from the list the moment its pairing is. */
          <>
            <DialogBody className="items-center gap-2 py-10 text-center">
              <Laptop className="size-6 text-muted-foreground" />
              <p className="m-0 text-sm font-medium">
                {t("agents.connectDialog.emptyTitle")}
              </p>
              <p className="m-0 max-w-sm text-xs text-muted-foreground">
                {t("agents.connectDialog.emptyBody")}
              </p>
              <Button
                className="mt-3"
                onClick={() => {
                  requestCreate("workspace")
                  onClose()
                }}
              >
                <Layers />
                {t("agents.connectDialog.goToWorkspaces")}
              </Button>
            </DialogBody>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t("agents.connectDialog.cancel")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {/* Outside DialogBody on purpose: the field stays put, only the
                result list scrolls. */}
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

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t("agents.connectDialog.cancel")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
