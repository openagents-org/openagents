import React from "react"
import { useShallow } from "zustand/react/shallow"
import { Spinner } from "@renderer/components/ui/spinner"
import { useAccountStore } from "@renderer/store/account"
import { useModalOpen } from "@renderer/hooks/useModalOpen"
import type { ToastType } from "@renderer/hooks/useToast"
import { DeviceBanner } from "./device-banner"

/**
 * The workspace itself, embedded.
 *
 * Nothing of the workspace app is reimplemented here: the page is a hole in
 * the launcher's layout, and the main process draws the real web app into it
 * as a WebContentsView (see main/workspace-host.ts). This component's whole
 * job is to say WHERE that hole is and to keep saying it as the window, the
 * rail and the banner above change its size.
 *
 * Signed out, the same hole shows the account site's own login page. Signing
 * in is therefore not a thing the launcher implements either — the page does
 * it, in the view whose storage the workspace will read a moment later.
 *
 * The view is a sibling of the renderer, not a child of this DOM node, so it
 * paints above everything here — which is why the launcher's own chrome for
 * this screen (header, device banner) sits outside the measured rectangle
 * rather than over it.
 */
export default function WorkspacePage({
  showToast,
}: {
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { active, account } = useAccountStore(
    useShallow((s) => ({ active: s.active, account: s.account })),
  )
  const hostRef = React.useRef<HTMLDivElement>(null)
  const [authorized, setAuthorized] = React.useState(true)
  // A native view paints above the page, dialogs included — so it steps aside
  // while one is open and comes back where it was afterwards.
  const modalOpen = useModalOpen()

  // Nothing selected means the workspace's own home: the list of memberships
  // when signed in, its sign-in gate when not.
  const target = active?.slug || active?.workspaceId || ""

  // Does THIS MACHINE belong to the workspace? Membership (account scope) and
  // pairing (device scope) are independent, and the answer decides whether the
  // banner above the view appears at all.
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

  // Keep the view pinned to this element's rectangle. One observer covers the
  // window resizing, the rail collapsing and the banner appearing or going.
  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return
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
      // Hidden, not destroyed: coming back to this workspace should be instant,
      // with its scroll position and open channel intact.
      void window.api.hideWorkspaceView()
    }
  }, [target, active?.token, modalOpen])

  return (
    <div className="flex h-full flex-col">
      {/* Only ever about a workspace that is open: the banner is the seam
          between being a member and this machine being authorized, and neither
          question exists on the sign-in page. */}
      {active && (
        <DeviceBanner
          workspace={active}
          authorized={authorized}
          onAuthorized={() => void checkAuthorization()}
          showToast={showToast}
        />
      )}
      {/* The measured hole. Its only content is what shows while the embedded
          page is still loading — the view paints over it the moment it has a
          first frame. */}
      <div ref={hostRef} className="relative min-h-0 flex-1">
        <div className="flex h-full items-center justify-center">
          <Spinner className="size-5 text-muted-foreground" />
        </div>
      </div>
    </div>
  )
}
