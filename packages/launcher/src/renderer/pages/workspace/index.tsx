import React from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import { useAccountStore } from "@renderer/store/account"
import { useModalOpen } from "@renderer/hooks/useModalOpen"
import type { ToastType } from "@renderer/hooks/useToast"
import { WORKSPACE_BUNDLE_MISSING } from "../../../shared/workspace-view"
import WelcomePage from "../welcome"
import { WorkspaceSignIn } from "./sign-in"

/**
 * The Workspace half of the window: Welcome and sign-in while signed out, then a
 * measured native view hosting the web app, including its membership home.
 */
export default function WorkspacePage(_props: {
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const account = useAccountStore((s) => s.account)
  const authMode = useAccountStore((s) => s.authMode)
  const targetSignal = useAccountStore((s) => s.workspaceTargetSignal)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const modalOpen = useModalOpen()
  // "missing": the installed app has no Workspace bundle, and retrying cannot help.
  const [error, setError] = React.useState<"failed" | "missing" | null>(null)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    const host = hostRef.current
    if (!host || !account) return
    if (modalOpen) { void window.api.hideWorkspaceView(); return }
    let cancelled = false
    let shown = false
    setError(null)
    const push = (): void => {
      const { left: x, top: y, width, height } = host.getBoundingClientRect()
      const bounds = { x, y, width, height }
      if (shown) { void window.api.setWorkspaceViewBounds(bounds); return }
      shown = true
      // A workspace asked for from This Computer; otherwise resume the page.
      const target = useAccountStore.getState().workspaceTarget
      void window.api.showWorkspaceView(target?.slug ?? null, bounds, target?.token ?? null).then(() => {
        // Loaded: coming back later resumes wherever the user has gone since.
        if (!cancelled && target) useAccountStore.getState().clearWorkspaceTarget()
      }).catch((err: unknown) => {
        if (cancelled) return
        void window.api.hideWorkspaceView()
        setError(String((err as Error)?.message ?? err).includes(WORKSPACE_BUNDLE_MISSING) ? "missing" : "failed")
      })
    }
    push()
    const observer = new ResizeObserver(push)
    observer.observe(host)
    window.addEventListener("resize", push)
    return () => {
      cancelled = true
      observer.disconnect()
      window.removeEventListener("resize", push)
      void window.api.hideWorkspaceView()
    }
  }, [account?.email, modalOpen, attempt, targetSignal])

  if (!account) return authMode === "welcome" ? <WelcomePage /> : <WorkspaceSignIn />
  return <div ref={hostRef} className="relative h-full min-h-0">
    <div className="flex h-full flex-col items-center justify-center gap-3">
      {error === "missing" ? (
        <p className="text-sm text-muted-foreground">{t("account.workspaceBundleMissing")}</p>
      ) : error ? (
        <><p className="text-sm text-muted-foreground">{t("account.workspaceLoadFailed")}</p><Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t("account.workspaces.retry")}</Button></>
      ) : <Spinner className="size-5 text-muted-foreground" />}
    </div>
  </div>
}
