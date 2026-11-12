import React from "react"
import { useTranslation } from "react-i18next"
import { QRCodeSVG } from "qrcode.react"
import { CheckCircle2, QrCode, RefreshCw, Smartphone } from "lucide-react"

import { capture } from "@renderer/lib/analytics"

type Status = "loading" | "pending" | "scanned" | "approved" | "cancelled" | "expired" | "error"

/** Fresh codes shown in a row before waiting for a click — nobody is looking. */
const MAX_AUTO_RENEWALS = 4

/**
 * QR-code login is hidden until the mobile app can scan. Turn it on for
 * testing by starting the app with OPENAGENTS_QR_LOGIN=1, or by setting
 * localStorage `oa_qr_login` to "1" in this window's devtools.
 */
function useQrSignInEnabled(): boolean {
  const [enabled, setEnabled] = React.useState(false)
  React.useEffect(() => {
    let live = true
    let local = false
    try {
      local = localStorage.getItem("oa_qr_login") === "1"
    } catch {
      /* storage unavailable */
    }
    if (local) setEnabled(true)
    else
      void window.api?.qrSignInEnabled?.().then(
        (on) => { if (live) setEnabled(on === true) },
        () => {},
      )
    return () => { live = false }
  }, [])
  return enabled
}

/** The code the OpenAgents app scans; signing in arrives through onAccountChanged. */
function QrSignInPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [code, setCode] = React.useState<{ id: string; qrUrl: string; pollIntervalMs: number } | null>(null)
  const [status, setStatus] = React.useState<Status>("loading")
  const [generation, setGeneration] = React.useState(0)
  const [tick, setTick] = React.useState(0)
  const renewals = React.useRef(0)

  React.useEffect(() => {
    let live = true
    setStatus("loading")
    window.api.startQrSignIn().then(
      (c) => { if (live) { setCode(c); setStatus("pending") } },
      () => { if (live) setStatus("error") },
    )
    return () => { live = false }
  }, [generation])

  React.useEffect(() => {
    if (!code || (status !== "pending" && status !== "scanned")) return
    let live = true
    const timer = setTimeout(async () => {
      try {
        const next = await window.api.pollQrSignIn(code.id)
        if (!live) return
        if (next === "approved") {
          setStatus("approved")
          capture("sign_in", { method: "qr" })
        } else if (next === "expired" && status === "pending" && renewals.current < MAX_AUTO_RENEWALS) {
          renewals.current += 1
          setGeneration((g) => g + 1)
        } else {
          setStatus(next)
          setTick((n) => n + 1)
        }
      } catch {
        // A dropped poll is retried; the code is still valid.
        if (live) setTick((n) => n + 1)
      }
    }, code.pollIntervalMs)
    return () => { live = false; clearTimeout(timer) }
  }, [code, status, tick])

  const renew = (): void => { renewals.current = 0; setGeneration((g) => g + 1) }
  const faded = status === "scanned" || status === "approved" || status === "expired" || status === "cancelled"

  return (
    <div className="flex flex-col items-center gap-3" data-testid="qr-sign-in-panel">
      <div className="relative rounded-lg border bg-white p-3">
        {code ? (
          <QRCodeSVG value={code.qrUrl} size={176} level="M" marginSize={1} className={faded ? "opacity-15" : ""} />
        ) : (
          <div className="size-[176px] animate-pulse rounded bg-muted" />
        )}
        {faded && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm font-medium text-neutral-900">
            {status === "scanned" && <><Smartphone className="size-7" />{t("account.qrSignIn.scanned")}</>}
            {status === "approved" && <><CheckCircle2 className="size-7 text-green-600" />{t("account.signingIn")}</>}
            {(status === "expired" || status === "cancelled") && (
              <button type="button" onClick={renew} className="flex flex-col items-center gap-2 underline-offset-4 hover:underline">
                <RefreshCw className="size-6" />
                {t(status === "expired" ? "account.qrSignIn.expired" : "account.qrSignIn.cancelled")}
              </button>
            )}
          </div>
        )}
      </div>
      <p className="max-w-[16rem] text-center text-2xs text-muted-foreground">
        {t(status === "scanned" ? "account.qrSignIn.confirmOnPhone" : "account.qrSignIn.instructions")}
      </p>
      {status === "error" && (
        <p role="alert" className="text-center text-2xs text-destructive">
          {t("account.qrSignIn.unavailable")}{" "}
          <button type="button" onClick={renew} className="underline underline-offset-4">{t("account.qrSignIn.retry")}</button>
        </p>
      )}
    </div>
  )
}

/** "Sign in with QR code" on the sign-in form; nothing while the option is off. */
export function QrSignInOption(): React.JSX.Element | null {
  const { t } = useTranslation()
  const enabled = useQrSignInEnabled()
  const [open, setOpen] = React.useState(false)
  if (!enabled) return null
  return (
    <div className="mt-4 flex flex-col items-center">
      {open ? (
        <QrSignInPanel />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          data-testid="qr-sign-in-open"
        >
          <QrCode className="size-4" />
          {t("account.qrSignIn.open")}
        </button>
      )}
    </div>
  )
}
