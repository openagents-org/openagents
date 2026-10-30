import { useEffect, useRef, useCallback } from 'react'
import { useAgentsStore } from '../store/agents'
import { useShallow } from 'zustand/react/shallow'

/**
 * Polls window.api.listAgents() and writes results into the agents store.
 * Dedup via inFlight ref — only one request runs at a time.
 *
 * The footer's agent summary is derived from the agent list (useAgentsSummary), so
 * this hook does not call a separate IPC for it — matches the legacy launcher.
 */
export function useAgents(intervalMs = 5000): void {
  const { setAgents, setCoreVersion, setLauncherVersion } = useAgentsStore(
    useShallow((s) => ({
      setAgents: s.setAgents,
      setCoreVersion: s.setCoreVersion,
      setLauncherVersion: s.setLauncherVersion,
    })),
  )
  const inFlight = useRef(false)
  const queued   = useRef(false)
  const mounted  = useRef(true)

  const refresh = useCallback(async () => {
    if (inFlight.current) { queued.current = true; return }
    inFlight.current = true
    try {
      const [agents, status] = await Promise.all([
        window.api.listAgents(),
        window.api.pythonStatus(),
      ])
      if (!mounted.current) return
      setAgents(agents)
      setCoreVersion(status.sdkVersion)
      setLauncherVersion(`v${status.launcherVersion}`)
    } catch {
      // IPC error — keep stale data
    } finally {
      inFlight.current = false
      if (queued.current) { queued.current = false; refresh() }
    }
  }, [setAgents, setCoreVersion, setLauncherVersion])

  useEffect(() => {
    mounted.current = true
    refresh()
    if (intervalMs <= 0) return
    const id = setInterval(refresh, intervalMs)
    return () => { mounted.current = false; clearInterval(id) }
  }, [refresh, intervalMs])
}
