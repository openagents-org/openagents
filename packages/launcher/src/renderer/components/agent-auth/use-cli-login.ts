import { useCallback, useEffect, useRef, useState } from "react"

import type { CliLoginEvent } from "@renderer/types"

export type CliLoginPhase = CliLoginEvent["phase"] | "idle"

export interface CliLoginApi {
  phase: CliLoginPhase
  /** The authorize URL, once the CLI has printed it. */
  url: string | null
  /** The CLI's own words on failure, or why it fell back to a terminal. */
  message: string | null
  /** A sign-in is in flight — the caller should show the login card. */
  active: boolean
  /** The CLI is blocked on stdin waiting for the code from the browser. */
  needsCode: boolean
  start: (opts?: { terminal?: boolean }) => Promise<void>
  submitCode: (code: string) => Promise<void>
  cancel: () => Promise<void>
  /** Open the authorize URL again — the rescue when the browser didn't. */
  reopen: () => void
  reset: () => void
}

const LIVE: ReadonlySet<CliLoginPhase> = new Set([
  "starting",
  "browser",
  "code",
  "verifying",
])

/**
 * Client for the in-app CLI sign-in (main/cli-login.ts): starts the flow, tracks
 * the phase the main process reports, and hands back the URL / code prompt for
 * the card to render. Every login entry point in the app (onboarding, the
 * post-install wizard, the Configure dialog) drives it through this hook so
 * they behave identically.
 */
export function useCliLogin({
  agentType,
  onSuccess,
}: {
  /** Agent type id, e.g. "claude". Null disables the hook. */
  agentType: string | null
  onSuccess?: () => void
}): CliLoginApi {
  const [phase, setPhase] = useState<CliLoginPhase>("idle")
  const [url, setUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Read inside the IPC listener, which is registered once and must not go
  // stale when the caller re-renders with a new callback.
  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess
  const typeRef = useRef(agentType)
  typeRef.current = agentType
  const phaseRef = useRef<CliLoginPhase>(phase)
  phaseRef.current = phase

  useEffect(() => {
    const off = window.api.onCliLoginEvent((ev) => {
      if (!ev || ev.agentType !== typeRef.current) return
      setPhase(ev.phase)
      if (ev.url) setUrl(ev.url)
      setMessage(ev.message || null)
      if (ev.phase === "success") onSuccessRef.current?.()
    })
    return off
  }, [])

  // Leaving the screen mid-login must not leave a CLI child holding stdin for
  // the full five-minute poll window. A terminal fallback is left alone — that
  // window is the user's now.
  useEffect(() => {
    return () => {
      if (LIVE.has(phaseRef.current) && typeRef.current)
        void window.api.cancelCliLogin(typeRef.current)
    }
  }, [])

  const start = useCallback(
    async (opts?: { terminal?: boolean }): Promise<void> => {
      if (!agentType) return
      setUrl(null)
      setMessage(null)
      setPhase("starting")
      try {
        await window.api.startCliLogin(agentType, opts)
      } catch (e) {
        setPhase("failed")
        setMessage((e as Error).message)
      }
    },
    [agentType],
  )

  const submitCode = useCallback(
    async (code: string): Promise<void> => {
      if (!agentType || !code.trim()) return
      setPhase("verifying")
      await window.api.submitCliLoginCode(agentType, code.trim())
    },
    [agentType],
  )

  const cancel = useCallback(async (): Promise<void> => {
    if (!agentType) return
    await window.api.cancelCliLogin(agentType)
    setPhase("idle")
  }, [agentType])

  const reopen = useCallback((): void => {
    if (url) void window.api.openExternal(url)
  }, [url])

  const reset = useCallback((): void => {
    setPhase("idle")
    setUrl(null)
    setMessage(null)
  }, [])

  return {
    phase,
    url,
    message,
    active: LIVE.has(phase),
    needsCode: phase === "code",
    start,
    submitCode,
    cancel,
    reopen,
    reset,
  }
}
