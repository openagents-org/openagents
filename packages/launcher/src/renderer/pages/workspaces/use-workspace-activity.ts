import { useCallback, useEffect, useRef, useState } from "react"

import type { Workspace } from "@renderer/types"

/** Days plotted on each card's trend line. */
export const ACTIVITY_DAYS = 7

/**
 * Messages read per workspace. The trend is drawn from whatever this window
 * covers — a busy workspace can push older days out of it, which is why the
 * card labels the chart as "recent messages" rather than a complete history.
 */
const MESSAGE_LIMIT = 200

/** Aggregating across every workspace is expensive; keep it well off the poll. */
const POLL_MS = 60_000

export interface WorkspaceActivity {
  /** One message count per day, oldest first, length ACTIVITY_DAYS. */
  buckets: number[]
  total: number
  /**
   * True when the message window filled up, so days before the oldest message
   * we saw are undercounted rather than genuinely empty.
   */
  truncated: boolean
}

function emptyActivity(): WorkspaceActivity {
  return { buckets: new Array(ACTIVITY_DAYS).fill(0), total: 0, truncated: false }
}

/**
 * Per-workspace message counts for the last {@link ACTIVITY_DAYS} days, keyed
 * by workspace id.
 *
 * One IPC round trip per workspace, so it runs on its own slow interval
 * instead of riding the list poll.
 */
export function useWorkspaceActivity(
  workspaces: Workspace[],
): Record<string, WorkspaceActivity> {
  const [activity, setActivity] = useState<Record<string, WorkspaceActivity>>({})
  const mounted = useRef(true)
  // Read inside the callback so adding a workspace doesn't restart the timer.
  const list = useRef(workspaces)
  list.current = workspaces

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const load = useCallback(async () => {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    // Start of the oldest day still on the chart.
    const windowStart = midnight.getTime() - (ACTIVITY_DAYS - 1) * 86_400_000

    const next: Record<string, WorkspaceActivity> = {}
    await Promise.all(
      list.current.map(async (ws) => {
        try {
          const msgs = await window.api.chatGetMessages(
            ws.id,
            undefined,
            MESSAGE_LIMIT,
          )
          const entry = emptyActivity()
          entry.truncated = msgs.length >= MESSAGE_LIMIT
          for (const m of msgs) {
            const at = m.createdAt ? new Date(m.createdAt).getTime() : 0
            if (!at || at < windowStart) continue
            const day = Math.floor((at - windowStart) / 86_400_000)
            if (day < 0 || day >= ACTIVITY_DAYS) continue
            entry.buckets[day] += 1
            entry.total += 1
          }
          next[ws.id] = entry
        } catch {
          // A workspace that can't be reached simply has no trend to draw.
        }
      }),
    )
    if (mounted.current) setActivity(next)
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(id)
  }, [load])

  // Re-run as soon as the workspace list itself changes, so a freshly joined
  // workspace doesn't sit blank for a minute.
  useEffect(() => {
    void load()
  }, [load, workspaces.length])

  return activity
}
