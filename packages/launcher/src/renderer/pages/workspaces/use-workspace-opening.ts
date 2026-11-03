import { useEffect, useRef, useState } from "react"

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
  // Both reads are kept as promises too, so a click that lands before they do
  // can wait for the answer instead of taking "not known yet" for "browser".
  const [endpoint, setEndpoint] = useState<string | undefined>()
  const endpointLoad = useRef<Promise<string | undefined> | null>(null)
  useEffect(() => {
    const load = window.api.getSetting("workspaceEndpoint")
      .then((value) => (typeof value === "string" && value ? value : undefined))
      .catch(() => undefined)
    endpointLoad.current = load
    void load.then(setEndpoint)
  }, [])
  // The account's own workspaces: only those open in the app (see opensInApp).
  // Null until known, and on failure — both mean the browser.
  const [memberOf, setMemberOf] = useState<AccountWorkspace[] | null>(null)
  const memberLoad = useRef<Promise<AccountWorkspace[] | null> | null>(null)
  useEffect(() => {
    setMemberOf(null)
    memberLoad.current = null
    if (!account) return
    let active = true
    const load = window.api.listAccountWorkspaces().catch(() => null)
    memberLoad.current = load
    void load.then((list) => { if (active) setMemberOf(list) })
    return () => { active = false }
  }, [account?.email])
  const canOpenInApp = (ws: Workspace): boolean => opensInApp(ws, endpoint, !!account, memberOf)
  // What the card says when it offers only the browser. Still loading the
  // account's workspaces says nothing — that answer is a moment away.
  const browserOnlyReason = (ws: Workspace): Exclude<InAppBlocker, "unknown"> | null => {
    const reason = inAppBlocker(ws, endpoint, !!account, memberOf)
    return reason === "unknown" ? null : reason
  }
  // Decided on the answers, waiting for any still on the way: a click in the
  // first moment after the page opened used to go to the browser only because
  // the account's workspaces had not loaded yet.
  const openWorkspace = (ws: Workspace): void => {
    void (async () => {
      const url = endpointLoad.current ? await endpointLoad.current : endpoint
      const list = memberOf ?? (memberLoad.current ? await memberLoad.current : null)
      if (!opensInApp(ws, url, !!account, list)) { openInBrowser(ws); return }
      markUsed(ws.id)
      useAccountStore.getState().openWorkspace({ slug: ws.slug || ws.id, name: ws.name, token: ws.token ?? null })
    })()
  }

  return { canOpenInApp, browserOnlyReason, openWorkspace, openInBrowser }
}
