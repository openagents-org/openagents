import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { Skeleton } from "@renderer/components/ui/skeleton"
import { capture } from "@renderer/lib/analytics"
import { ConnectWorkspacePair } from "./connect-workspace-pair"
import { ConnectWorkspacePicker } from "./connect-workspace-picker"
import type { WorkspaceOption } from "./workspace-option-row"
import type { PairedWorkspace } from "@renderer/components/workspaces/use-pair-device"
import type { NodeStatus } from "@renderer/types"
import type { ToastType } from "@renderer/hooks/useToast"

/**
 * The workspaces this device actually holds a pairing for.
 *
 * `listWorkspaces()` returns the core's local entries, which are a separate
 * record from the pairings in node.json and only kept in step by hand — so a
 * workspace that has removed this device stays in it until something notices.
 * Offering one of those to bind to produces a join that cannot authenticate,
 * so the pairing set is what the list is drawn from. No pairings, no options:
 * the empty state takes a pairing code in place.
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
  // Bumped to re-read the pairings after a code joined one this dialog could
  // not name.
  const [reload, setReload] = useState(0)
  // null until the pairings have answered — an empty list is a real answer
  // ("this device is in no workspace") and the two must not read alike.
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[] | null>(null)

  useEffect(() => {
    if (!open) return
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
  }, [open, reload])

  const options = workspaces || []

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

  // A code redeemed in here names its workspace, and this agent joins it in
  // the same step. One that names none just refreshes the list.
  const onPaired = (joined: PairedWorkspace): void => {
    if (joined.workspaceSlug) void doConnect(joined.workspaceSlug)
    else setReload((n) => n + 1)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* The handle is on the shell rather than only on the list, so "the
          dialog never opened" and "it opened with nothing to offer" stay
          separate failures for the e2e matrix. */}
      <DialogContent data-testid="connect-ws">
        <DialogHeader>
          <DialogTitle>
            {t("agents.connectDialog.title", { name: agentName })}
          </DialogTitle>
          {options.length > 0 && (
            <DialogDescription>
              {t("agents.connectDialog.pickHint")}
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
          /* No pairing yet. Joining one is a pairing code away, so the code
             goes in right here; once redeemed, this agent joins that workspace
             in the same step. A workspace that removed this device lands here
             too: it is gone from the list the moment its pairing is. */
          <ConnectWorkspacePair
            onPaired={onPaired}
            onCancel={onClose}
            showToast={showToast}
          />
        ) : (
          <ConnectWorkspacePicker
            options={options}
            onConnect={(slug) => void doConnect(slug)}
            onPaired={onPaired}
            onCancel={onClose}
            showToast={showToast}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
