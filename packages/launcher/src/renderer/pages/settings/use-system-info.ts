import { useEffect, useRef, useState } from "react"

import type { SystemInfo } from "@renderer/types"

/** Memory and CPU move; re-read them while the Runtime section is on screen. */
const POLL_MS = 4000

/**
 * Host snapshot for Settings → Runtime. Only polls while `active`, so the
 * handler isn't running every few seconds behind an unrelated section.
 */
export function useSystemInfo(active: boolean): SystemInfo | null {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!active) return
    const read = (): void => {
      window.api
        .systemInfo()
        .then((next) => {
          if (mounted.current) setInfo(next)
        })
        .catch(() => {})
    }
    read()
    const id = setInterval(read, POLL_MS)
    return () => clearInterval(id)
  }, [active])

  return info
}
