import React from "react"
import { useShallow } from "zustand/react/shallow"

import { Spinner } from "@renderer/components/ui/spinner"
import { useAccountStore } from "@renderer/store/account"
import { useModalOpen } from "@renderer/hooks/useModalOpen"
import type { ToastType } from "@renderer/hooks/useToast"
import AccountWorkspaces from "../account-workspaces"
import { DeviceBanner } from "./device-banner"
import { WorkspaceSignIn } from "./sign-in"

/**
 * The Workspace half of the app, end to end.
 *
 * Three states, in the order a user meets them:
 *
 *   no account          the sign-in
 *   account, none open  the workspaces this account belongs to
 *   a workspace open    that workspace, filling the pane
 *
 * All of it lives on this side. My Agents is the machine and says nothing about
 * an account; this is the account and says nothing about the machine's own
 * agents — except on the cards, where whether THIS MACHINE has joined is the
 * one thing the hosted app cannot tell you.
 *
 * The hosted workspace gets the full width because it is a full application
 * with its own rail: sharing the pane with the launcher's left it rendering the
 * layout it keeps for phones, a hamburger where its navigation should be. The
 * only chrome above it is the mode bar, which the window needs anyway for the
 * OS's buttons.
 */
export default function WorkspacePage({
  showToast,
}: {
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { account, active } = useAccountStore(
    useShallow((s) => ({ account: s.account, active: s.active })),
  )
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [authorized, setAuthorized] = React.useState(true)
  // A native view paints above the page, dialogs included — so it steps aside
  // while one is open and comes back where it was afterwards.
  const modalOpen = useModalOpen()

  // Always a real workspace: the empty case is the list above, which is ours
  // rather than the hosted app's home page.
  const target = active?.slug || active?.workspaceId || ""

  // Does THIS MACHINE belong to the workspace? Membership (account scope) and
  // pairing (device scope) are independent, and the answer decides whether the
  // banner appears at all.
  const checkAuthorization = React.useCallback(async (): Promise<void> => {
    if (!active) return
    try {
      const node = await window.api.getNodeStatus()
      setAuthorized(
        (node.workspaces || []).some(
          (w) => w.workspaceId === active.workspaceId,
        ),
      )
    } catch {
      // Unknown is not "unauthorized": a failed local read must not accuse the
      // machine of something and offer to fix it.
      setAuthorized(true)
    }
  }, [active?.workspaceId])

  React.useEffect(() => {
    void checkAuthorization()
  }, [checkAuthorization])

  // Keep the view pinned to the hole below the strip. One observer covers the
  // window resizing and the banner appearing or going.
  React.useEffect(() => {
    const host = hostRef.current
    // Only when a workspace is actually open. Signed out, this pane holds the
    // sign-in; signed in with nothing chosen, it holds our own list — and in
    // neither case is there a host rect to draw into.
    if (!host || !account || !active) return
    if (modalOpen) {
      void window.api.hideWorkspaceView()
      return
    }

    let shown = false
    const push = (): void => {
      const rect = host.getBoundingClientRect()
      const bounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      }
      if (shown) {
        void window.api.setWorkspaceViewBounds(bounds)
        return
      }
      shown = true
      void window.api.showWorkspaceView(target, bounds, active?.token ?? null)
    }

    push()
    const observer = new ResizeObserver(push)
    observer.observe(host)
    window.addEventListener("resize", push)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", push)
      // Hidden, not destroyed: coming back to this workspace should be
      // instant, with its scroll position and open channel intact.
      void window.api.hideWorkspaceView()
    }
  }, [account, active?.workspaceId, target, active?.token, modalOpen])

  if (!account) return <WorkspaceSignIn />
  if (!active) return <AccountWorkspaces showToast={showToast} />

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <DeviceBanner
        workspace={active}
        authorized={authorized}
        onAuthorized={() => void checkAuthorization()}
        showToast={showToast}
      />
      {/* The measured hole. Its only content is what shows while the workspace
          loads; the native view paints over it on the first frame. */}
      <div ref={hostRef} className="relative min-h-0 flex-1">
        <div className="flex h-full items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      </div>
    </div>
  )
}
