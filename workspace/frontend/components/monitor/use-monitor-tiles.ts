'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { eventToMessage } from '@/lib/types';
import type { WorkspaceMessage, WorkspaceSession } from '@/lib/types';
import { isControlMessage } from '@/lib/control-messages';

const POLL_INTERVAL = 5_000;

export interface TileData {
  lastUserMessage: WorkspaceMessage | null;
  lastAgentMessage: WorkspaceMessage | null;
  /** Recent thinking/status steps when agent is actively working (newest first) */
  recentSteps: WorkspaceMessage[];
}

/**
 * The last turn of every visible tile, polled. Also keeps each session's
 * fetched messages (chronological) so the overlay opens instantly.
 */
export function useMonitorTiles(topSessions: WorkspaceSession[]) {
  const [tileData, setTileData] = useState<Record<string, TileData>>({});
  const messageCacheRef = useRef<Record<string, WorkspaceMessage[]>>({});

  // Fetch last turn data for all visible tiles
  const fetchTileData = useCallback(async () => {
    const results: Record<string, TileData> = {};
    await Promise.all(
      topSessions.map(async (session) => {
        try {
          const result = await workspaceApi.pollEvents({
            channel: session.sessionId,
            type: 'workspace.message',
            sort: 'desc',
            limit: 50,
          });
          const msgs = result.events.map(eventToMessage);

          // Find indices of key messages (msgs sorted newest-first)
          // A queue cancel is the user's click, not something they said.
          const lastUserIdx = msgs.findIndex((m) => m.senderType !== 'agent' && !isControlMessage(m));
          const lastUser = lastUserIdx >= 0 ? msgs[lastUserIdx] : null;

          // Find last agent chat message (not status/thinking)
          const lastAgentChatIdx = msgs.findIndex(
            (m) => m.senderType === 'agent' && m.messageType !== 'status' && m.messageType !== 'thinking'
          );
          const lastAgentChat = lastAgentChatIdx >= 0 ? msgs[lastAgentChatIdx] : null;

          // Find last agent status/thinking
          const lastAgentStatus = msgs.find(
            (m) => m.senderType === 'agent' && (m.messageType === 'status' || m.messageType === 'thinking')
          ) || null;

          // If the latest agent message is status/thinking, agent is working — show that
          // Otherwise show the final chat response
          const latestAgentAny = msgs.find((m) => m.senderType === 'agent');
          const agentIsWorking = latestAgentAny && (latestAgentAny.messageType === 'status' || latestAgentAny.messageType === 'thinking');

          // Only show agent chat response if it's newer than the last user message
          // (lower index = newer in desc-sorted array). If user message is newer,
          // the old agent response is stale and shouldn't be shown.
          const agentChatIsStale = lastAgentChat && lastUser && lastAgentChatIdx > lastUserIdx;

          // Collect recent thinking/status steps (newest first, deduplicated)
          const recentSteps: WorkspaceMessage[] = [];
          if (agentIsWorking) {
            const seen = new Set<string>();
            for (const m of msgs) {
              if (m.senderType !== 'agent') break; // stop at first non-agent msg
              if (m.messageType === 'status' || m.messageType === 'thinking') {
                // Deduplicate by content (status can repeat)
                const key = m.content.slice(0, 100);
                if (!seen.has(key) && m.content.trim()) {
                  seen.add(key);
                  recentSteps.push(m);
                }
              }
            }
          }

          results[session.sessionId] = {
            lastUserMessage: lastUser,
            lastAgentMessage: agentIsWorking ? lastAgentStatus : (agentChatIsStale ? null : lastAgentChat),
            recentSteps,
          };

          // Cache messages in chronological order for instant overlay loading
          messageCacheRef.current[session.sessionId] = [...msgs].reverse();
        } catch {
          // Keep existing data on error
        }
      })
    );
    setTileData((prev) => ({ ...prev, ...results }));
  }, [topSessions]);

  // Initial fetch + polling
  useEffect(() => {
    if (topSessions.length === 0) return;
    fetchTileData();
    const interval = setInterval(fetchTileData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchTileData, topSessions.length]);

  return { tileData, messageCacheRef };
}
