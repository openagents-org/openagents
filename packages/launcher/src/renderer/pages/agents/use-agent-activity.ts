import { useCallback, useEffect, useRef, useState } from "react"

/** Workspaces scanned per pass, newest-first, and messages read from each. */
const WORKSPACE_LIMIT = 10
const MESSAGE_LIMIT = 100

/** Message scanning is expensive; nothing here changes minute to minute. */
const POLL_MS = 60_000

/**
 * Last time each agent said something, as an ISO timestamp keyed by agent name.
 *
 * Derived from workspace messages because the daemon tracks no per-agent
 * activity of its own: `senderName` on an agent message is the agent's name, so
 * the newest such message is the best "last active" the launcher can know.
 * Agents that have never posted are simply absent from the map.
 */
export function useAgentActivity(): Record<string, string> {
  const [lastActive, setLastActive] = useState<Record<string, string>>({})
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const workspaces = await window.api.listWorkspaces()
      const next: Record<string, string> = {}
      await Promise.all(
        workspaces.slice(0, WORKSPACE_LIMIT).map(async (ws) => {
          try {
            const msgs = await window.api.chatGetMessages(
              ws.id,
              undefined,
              MESSAGE_LIMIT,
            )
            for (const m of msgs) {
              if (m.senderType !== "agent" || !m.senderName || !m.createdAt)
                continue
              const prev = next[m.senderName]
              if (!prev || new Date(m.createdAt) > new Date(prev))
                next[m.senderName] = m.createdAt
            }
          } catch {}
        }),
      )
      if (mounted.current) setLastActive(next)
    } catch {}
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(id)
  }, [load])

  return lastActive
}
