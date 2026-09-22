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
 * Widget contract (checked live with the production app id, 2026-09-22): the
 * constructor takes (container, appId, callback, options); show() renders an
 * "I am human" checkbox INSIDE the container. Ticking it yields the callback:
 * ret 0 = passed (ticket + randstr), ret 2 = the person closed the puzzle; a
 * `trerror_…` ticket with an errorCode means the widget could not reach
 * Tencent — sent on as-is, the service's policy decides. Tickets are
 * single-use, so the form calls reset() (widget.reload()) after each attempt.
 */

export class CaptchaCancelled extends Error {
  constructor() {
    super("captcha_cancelled")
    this.name = "CaptchaCancelled"
  }
}

/** Submit pressed before the "I am human" box was ticked; wording via account-errors. */
export class CaptchaNotTicked extends Error {
  constructor() {
    super("SIGN_IN_CAPTCHA_TICK")
    this.name = "CaptchaNotTicked"
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
  reload?: () => void
  destroy?: () => void
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
  /** The person ticked the box; a pass is waiting. */
  ticked: boolean
  /** Mount point for the "I am human" checkbox; render it inside the form. */
  containerRef: (el: HTMLDivElement | null) => void
  /** The pass from the tick, or undefined when none is required. Throws CaptchaNotTicked. */
  verify: () => Promise<CaptchaPass | undefined>
  /** After every submit attempt: tickets are single-use. */
  reset: () => void
}

export function useTencentCaptcha(surface: "register" | "login"): TencentCaptcha {
  const [cfg, setCfg] = React.useState<CaptchaConfig | null>(null)
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null)
  const [ticked, setTicked] = React.useState(false)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const instanceRef = React.useRef<WidgetInstance | null>(null)
  const passRef = React.useRef<CaptchaPass | null>(null)

  const containerRef = React.useCallback((el: HTMLDivElement | null) => setContainer(el), [])

  React.useEffect(() => {
    let alive = true
    const read = window.api?.getCaptchaConfig
    if (!read) return
    read.call(window.api).then(
      (c) => {
        if (alive) setCfg(c)
      },
      () => {
        if (alive) setCfg(null)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const required = !!(cfg?.enabled && cfg.appId && cfg.surfaces?.[surface])

  React.useEffect(() => {
    if (!required || !container || !cfg?.appId) return
    const appId = cfg.appId
    let cancelled = false
    const started = performance.now()
    const done = (outcome: string, extra: Record<string, unknown> = {}): void =>
      capture("captcha_result", { surface, outcome, ms: Math.round(performance.now() - started), ...extra })

    loadScript(cfg.scriptUrl)
      .then(() => {
        if (cancelled || instanceRef.current || !window.TencentCaptcha) return
        const callback = (res: WidgetResult): void => {
          if (res.ret === 0 && res.ticket && res.randstr) {
            passRef.current = { ticket: res.ticket, randstr: res.randstr }
            setTicked(true)
            done(res.errorCode ? "fallback_ticket" : "passed", res.errorCode ? { code: res.errorCode } : {})
          } else if (res.ret === 2) {
            done("closed")
          } else {
            done("error", { code: res.errorCode, ret: res.ret })
          }
        }
        try {
          const instance = new window.TencentCaptcha(container, appId, callback, {
            userLanguage: navigator.language,
            needFeedBack: false,
          })
          instanceRef.current = instance
          instance.show()
        } catch (e) {
          setLoadFailed(true)
          done("init_error", { code: (e as Error)?.message?.slice(0, 80) })
        }
      })
      .catch((e: Error) => {
        if (cancelled) return
        setLoadFailed(true)
        done("load_error", { code: e.message })
      })

    return () => {
      cancelled = true
      try {
        instanceRef.current?.destroy?.()
      } catch {
        // already gone
      }
      instanceRef.current = null
      passRef.current = null
      setTicked(false)
    }
  }, [required, container, cfg, surface])

  const verify = React.useCallback(async (): Promise<CaptchaPass | undefined> => {
    if (!required || !cfg?.appId) return undefined
    if (passRef.current) return passRef.current
    if (loadFailed) return disasterPass(cfg.appId, 1001)
    throw new CaptchaNotTicked()
  }, [required, cfg, loadFailed])

  const reset = React.useCallback(() => {
    passRef.current = null
    setTicked(false)
    try {
      instanceRef.current?.reload?.()
    } catch {
      // nothing to reset
    }
  }, [])

  return { required, ticked, containerRef, verify, reset }
}
