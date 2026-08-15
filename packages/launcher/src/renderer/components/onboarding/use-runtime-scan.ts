import { useEffect, useState } from "react"

import type { RuntimeInfo, SystemInfo } from "@renderer/types"

export interface RuntimeScan {
  runtime: RuntimeInfo | null
  system: SystemInfo | null
  loading: boolean
}

/**
 * One-shot probe of the local environment for the welcome step. Everything
 * here is read from real IPC — the step never claims to have detected
 * something the launcher cannot actually see.
 */
export function useRuntimeScan(active: boolean): RuntimeScan {
  const [scan, setScan] = useState<RuntimeScan>({
    runtime: null,
    system: null,
    loading: true,
  })

  useEffect(() => {
    if (!active) return
    let cancelled = false
    const read = async (): Promise<void> => {
      const [runtime, system] = await Promise.all([
        window.api.runtimeInfo().catch(() => null),
        window.api.systemInfo().catch(() => null),
      ])
      if (cancelled) return
      setScan({ runtime, system, loading: false })
    }
    void read()
    return () => {
      cancelled = true
    }
  }, [active])

  return scan
}
