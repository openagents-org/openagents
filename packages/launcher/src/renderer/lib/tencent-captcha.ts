import React from "react"
import type { CaptchaConfig, CaptchaPass } from "../types"
import { capture } from "./analytics"

/**
 * Tencent Cloud Captcha for the in-app email sign-in / sign-up form.
 *
 * The account service (endpoint.openagents.org) may require a human-
 * verification pass on its email endpoints — it answers 428 without one. Main
 * asks the service whether that is on (`getCaptchaConfig`); when it is, the
 * form calls `verify()` before submitting and sends the resulting ticket +
 * randstr along. The widget is Tencent's TJNCaptcha-global.js, which works from
 * mainland China — the reason it was chosen over Cloudflare Turnstile.
 *
 * Widget contract (checked live 2026-09-22): the constructor takes
 * (container, appId, callback, options) and draws its own dialog;
 * callback ret 0 = passed (ticket + randstr), ret 2 = the person closed it;
 * a `trerror_…` ticket with an errorCode means the widget could not reach
 * Tencent — sent on as-is, the service's policy decides.
 */

export class CaptchaCancelled extends Error {
  constructor() {
    super("captcha_cancelled")
    this.name = "CaptchaCancelled"
  }
}

interface WidgetResult {
  ret: number
  ticket?: string | null
  randstr?: string
  errorCode?: number
}

interface WidgetInstance {
  show: () => void
}

type WidgetCtor = new (...args: unknown[]) => WidgetInstance

declare global {
  interface Window {
    TencentCaptcha?: WidgetCtor
  }
}

const SCRIPT_TIMEOUT_MS = 12000
let scriptPromise: Promise<void> | null = null

function loadScript(url: string): Promise<void> {
  if (window.TencentCaptcha) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script")
    el.src = url // must be Tencent's exact URL; proxying/caching it breaks updates
    el.async = true
    const timer = setTimeout(() => {
      el.remove()
      scriptPromise = null
      reject(new Error("captcha_script_timeout"))
    }, SCRIPT_TIMEOUT_MS)
    el.onload = () => {
      clearTimeout(timer)
      if (window.TencentCaptcha) resolve()
      else {
        scriptPromise = null
        reject(new Error("captcha_script_no_ctor"))
      }
    }
    el.onerror = () => {
      clearTimeout(timer)
      el.remove()
      scriptPromise = null
      reject(new Error("captcha_script_error"))
    }
    document.head.appendChild(el)
  })
  return scriptPromise
}

function disasterPass(appId: string, code: number): CaptchaPass {
  return {
    ticket: `trerror_${code}_${appId}_${Math.floor(Date.now() / 1000)}`,
    randstr: "@" + Math.random().toString(36).slice(2),
  }
}

export interface TencentCaptcha {
  /** The service requires a pass for this form. */
  required: boolean
  /** Mount point the widget may use; render it inside the form. */
  containerRef: React.RefObject<HTMLDivElement>
  /** Fresh pass, or undefined when none is required. Rejects CaptchaCancelled when closed. */
  verify: () => Promise<CaptchaPass | undefined>
}

export function useTencentCaptcha(surface: "register" | "login"): TencentCaptcha {
  const [cfg, setCfg] = React.useState<CaptchaConfig | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    let alive = true
    const read = window.api?.getCaptchaConfig
    if (!read) return
    read.call(window.api).then(
      (c) => {
        if (!alive) return
        setCfg(c)
        if (c?.enabled && c.surfaces?.[surface] && c.scriptUrl) loadScript(c.scriptUrl).catch(() => {})
      },
      () => {
        if (alive) setCfg(null)
      },
    )
    return () => {
      alive = false
    }
  }, [surface])

  const required = !!(cfg?.enabled && cfg.appId && cfg.surfaces?.[surface])

  const verify = React.useCallback(async (): Promise<CaptchaPass | undefined> => {
    if (!required || !cfg?.appId) return undefined
    const appId = cfg.appId
    const started = performance.now()
    const done = (outcome: string, extra: Record<string, unknown> = {}): void =>
      capture("captcha_result", { surface, outcome, ms: Math.round(performance.now() - started), ...extra })

    try {
      await loadScript(cfg.scriptUrl)
    } catch (e) {
      done("load_error", { code: (e as Error).message })
      return disasterPass(appId, 1001)
    }

    return new Promise<CaptchaPass>((resolve, reject) => {
      let settled = false
      const callback = (res: WidgetResult): void => {
        if (settled) return
        settled = true
        if (res.ret === 0 && res.ticket && res.randstr) {
          done(res.errorCode ? "fallback_ticket" : "passed", res.errorCode ? { code: res.errorCode } : {})
          resolve({ ticket: res.ticket, randstr: res.randstr })
        } else if (res.ret === 2) {
          done("closed")
          reject(new CaptchaCancelled())
        } else {
          done("error", { code: res.errorCode, ret: res.ret })
          reject(new Error("SIGN_IN_CAPTCHA_REQUIRED"))
        }
      }
      const options = { userLanguage: navigator.language, needFeedBack: false }
      const Ctor = window.TencentCaptcha as WidgetCtor
      try {
        let instance: WidgetInstance
        try {
          instance = new Ctor(containerRef.current ?? document.body, appId, callback, options)
        } catch {
          instance = new Ctor(appId, callback, options)
        }
        instance.show()
      } catch (e) {
        settled = true
        done("init_error", { code: (e as Error)?.message?.slice(0, 80) })
        resolve(disasterPass(appId, 1001))
      }
    })
  }, [cfg, required, surface])

  return { required, containerRef, verify }
}
