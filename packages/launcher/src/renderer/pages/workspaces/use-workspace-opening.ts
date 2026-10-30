import { useEffect, useState } from "react"

import { inAppBlocker, opensInApp, workspacePageUrl, type InAppBlocker } from "@renderer/lib/workspace-urls"
import { useAccountStore } from "@renderer/store/account"
import type { AccountWorkspace, Workspace } from "@renderer/types"

/**
 * Where a workspace on this page opens. The same app already carries the
 * Workspace, so opening one stays in it; the browser is for what the embedded
 * Workspace cannot show.
 */
export function useWorkspaceOpening(markUsed: (id: string) => void): {
  canOpenInApp: (ws: Workspace) => boolean
  browserOnlyReason: (ws: Workspace) => Exclude<InAppBlocker, "unknown"> | null
  openWorkspace: (ws: Workspace) => void
  openInBrowser: (ws: Workspace) => void
} {
  const openInBrowser = (ws: Workspace): void => {
    markUsed(ws.id)
    window.api.openExternal(workspacePageUrl(ws))
  }

  const account = useAccountStore((s) => s.account)
  const [endpoint, setEndpoint] = useState<string | undefined>()
  useEffect(() => {
    void window.api.getSetting("workspaceEndpoint")
      .then((value) => setEndpoint(typeof value === "string" && value ? value : undefined))
      .catch(() => {})
  }, [])
  // The account's own workspaces: only those open in the app (see opensInApp).
  // Null until known, and on failure — both mean the browser.
  const [memberOf, setMemberOf] = useState<AccountWorkspace[] | null>(null)
  useEffect(() => {
    setMemberOf(null)
    if (!account) return
    let active = true
    void window.api.listAccountWorkspaces()
      .then((list) => { if (active) setMemberOf(list) })
      .catch(() => {})
    return () => { active = false }
  }, [account?.email])
  const canOpenInApp = (ws: Workspace): boolean => opensInApp(ws, endpoint, !!account, memberOf)
  // What the card says when it offers only the browser. Still loading the
  // account's workspaces says nothing — that answer is a moment away.
  const browserOnlyReason = (ws: Workspace): Exclude<InAppBlocker, "unknown"> | null => {
    const reason = inAppBlocker(ws, endpoint, !!account, memberOf)
    return reason === "unknown" ? null : reason
  }
  const openWorkspace = (ws: Workspace): void => {
    if (!canOpenInApp(ws)) { openInBrowser(ws); return }
    markUsed(ws.id)
    useAccountStore.getState().openWorkspace({ slug: ws.slug || ws.id, name: ws.name, token: ws.token ?? null })
  }

  return { canOpenInApp, browserOnlyReason, openWorkspace, openInBrowser }
}
