import React from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@renderer/components/ui/button"
import { Spinner } from "@renderer/components/ui/spinner"
import { useAccountStore } from "@renderer/store/account"
import { useModalOpen } from "@renderer/hooks/useModalOpen"
import type { ToastType } from "@renderer/hooks/useToast"
import { WorkspaceSignIn } from "./sign-in"

/** A measured native view hosting the web app, including its membership home. */
export default function WorkspacePage(_props: {
  showToast: (msg: string, type?: ToastType) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const account = useAccountStore((s) => s.account)
  const hostRef = React.useRef<HTMLDivElement>(null)
  const modalOpen = useModalOpen()
  const [error, setError] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    const host = hostRef.current
    if (!host || !account) return
    if (modalOpen) { void window.api.hideWorkspaceView(); return }
    let cancelled = false
    let shown = false
    setError(false)
    const push = (): void => {
      const { left: x, top: y, width, height } = host.getBoundingClientRect()
      const bounds = { x, y, width, height }
      if (shown) { void window.api.setWorkspaceViewBounds(bounds); return }
      shown = true
      void window.api.showWorkspaceView(null, bounds).catch(() => {
        if (!cancelled) { void window.api.hideWorkspaceView(); setError(true) }
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
  }, [account?.email, modalOpen, attempt])

  if (!account) return <WorkspaceSignIn />
  return <div ref={hostRef} className="relative h-full min-h-0">
    <div className="flex h-full flex-col items-center justify-center gap-3">
      {error ? <><p className="text-sm text-muted-foreground">{t("account.workspaceLoadFailed")}</p><Button variant="outline" onClick={() => setAttempt((n) => n + 1)}>{t("account.workspaces.retry")}</Button></> : <Spinner className="size-5 text-muted-foreground" />}
    </div>
  </div>
}
