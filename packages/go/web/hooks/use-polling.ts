'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { workspaceApi } from '@/lib/api';
import { eventToMessage } from '@/lib/types';
import type { WorkspaceMessage } from '@/lib/types';

interface UsePollingOptions {
  sessionId: string | null;
  enabled?: boolean;
  /** Pre-loaded messages to display immediately (avoids loading state). */
  initialMessages?: WorkspaceMessage[];
}

/** Parse a DM session ID like "dm:agentA,agentB" into agent addresses. */
function parseDMSession(sessionId: string | null): [string, string] | null {
  if (!sessionId?.startsWith('dm:')) return null;
  const parts = sessionId.slice(3).split(',', 2);
  if (parts.length === 2) return [parts[0], parts[1]];
  return null;
}

export function useMessagePolling({ sessionId, enabled = true, initialMessages }: UsePollingOptions) {
  const [messages, setMessages] = useState<WorkspaceMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  // Increments when messages are bulk-replaced (backfill/session switch) to signal scroll-to-bottom
  const [generation, setGeneration] = useState(0);

  // Refs for cursor tracking
  const newestIdRef = useRef<string | null>(null);
  const oldestIdRef = useRef<string | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const historyLoadedRef = useRef(false);
  // Track current session to discard stale responses
  const currentSessionRef = useRef<string | null>(sessionId);

  // Reset when session changes
  useEffect(() => {
    currentSessionRef.current = sessionId;

    if (initialMessages && initialMessages.length > 0) {
      // Seed with cached messages for instant display
      setMessages(initialMessages);
      newestIdRef.current = initialMessages[initialMessages.length - 1].messageId;
      oldestIdRef.current = initialMessages[0].messageId;
      historyLoadedRef.current = true;
      setHasOlder(true); // assume there may be older until proven otherwise
      setLoading(false);
    } else {
      setMessages([]);
      newestIdRef.current = null;
      oldestIdRef.current = null;
      historyLoadedRef.current = false;
      setHasOlder(false);
      setLoading(false);
    }
  }, [sessionId]); // intentionally omit initialMessages — only seed on session change

  // Track user activity for adaptive polling
  useEffect(() => {
    const onActivity = () => {
      lastActivityRef.current = Date.now();
    };
    window.addEventListener('keydown', onActivity);
    window.addEventListener('click', onActivity);
    return () => {
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('click', onActivity);
    };
  }, []);

  // Load recent history (newest messages first, then reverse for display)
  const dmPair = useMemo(() => parseDMSession(sessionId), [sessionId]);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    try {
      const result = dmPair
        ? await workspaceApi.pollConversation(dmPair[0], dmPair[1], { sort: 'desc', limit: 50 })
        : await workspaceApi.loadMessageHistory(sessionId, { limit: 50 });

      // Discard if session changed
      if (sessionId !== currentSessionRef.current) return;

      if (result.events.length > 0) {
        // Events come newest-first from sort=desc, reverse for chronological display
        const historicMessages = result.events.map((e) => {
          const msg = eventToMessage(e);
          // For DM sessions, override sessionId so all messages share the dm: sessionId
          // (eventToMessage derives sessionId from event.target which differs per message)
          if (dmPair && sessionId) msg.sessionId = sessionId;
          return msg;
        }).reverse();
        setMessages(historicMessages);
        // newest_id is the most recent event (first in desc order)
        newestIdRef.current = result.newest_id || historicMessages[historicMessages.length - 1].messageId;
        // oldest_id for loading older messages
        oldestIdRef.current = result.oldest_id || historicMessages[0].messageId;
        setHasOlder(result.has_more);
        setGeneration((g) => g + 1);
      } else {
        setHasOlder(false);
      }

      historyLoadedRef.current = true;
    } catch {
      historyLoadedRef.current = true;
    } finally {
      setLoading(false);
    }
  }, [sessionId, dmPair]);

  // Forward poll: fetch new messages since the newest known
  const poll = useCallback(async () => {
    if (!sessionId || !historyLoadedRef.current) return;

    try {
      // Keep fetching while there are more events (handles bursts of status messages)
      let hasMore = true;
      while (hasMore) {
        const result = dmPair
          ? await (async () => {
              const r = await workspaceApi.pollConversation(dmPair[0], dmPair[1], {
                after: newestIdRef.current ?? undefined,
              });
              return {
                messages: r.events.map((e) => {
                  const msg = eventToMessage(e);
                  if (sessionId) msg.sessionId = sessionId;
                  return msg;
                }),
                hasMore: r.has_more,
              };
            })()
          : await workspaceApi.pollMessages(
              sessionId,
              newestIdRef.current ?? undefined,
            );

        // Discard response if session changed while request was in flight
        if (sessionId !== currentSessionRef.current) return;

        const newMessages = result.messages;
        hasMore = result.hasMore && newMessages.length > 0;

        if (newMessages.length > 0) {
          const lastMsg = newMessages[newMessages.length - 1];
          newestIdRef.current = lastMsg.messageId;

          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.messageId));
            const unique = newMessages.filter((m) => !existingIds.has(m.messageId));
            return unique.length > 0 ? [...prev, ...unique] : prev;
          });
        }
      }
    } catch {
      // Polling error — will retry on next interval
    }
  }, [sessionId, dmPair]);

  // Load older messages (infinite scroll upward)
  const loadOlder = useCallback(async () => {
    if (!sessionId || !hasOlder || loadingOlder) return;

    setLoadingOlder(true);
    try {
      const result = dmPair
        ? await workspaceApi.pollConversation(dmPair[0], dmPair[1], {
            before: oldestIdRef.current ?? undefined,
            sort: 'desc',
            limit: 30,
          })
        : await workspaceApi.loadMessageHistory(sessionId, {
            before: oldestIdRef.current ?? undefined,
            limit: 30,
          });

      if (sessionId !== currentSessionRef.current) return;

      if (result.events.length > 0) {
        const olderMessages = result.events.map(eventToMessage).reverse();
        oldestIdRef.current = result.oldest_id || olderMessages[0].messageId;
        setHasOlder(result.has_more);

        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.messageId));
          const unique = olderMessages.filter((m) => !existingIds.has(m.messageId));
          return unique.length > 0 ? [...unique, ...prev] : prev;
        });
      } else {
        setHasOlder(false);
      }
    } catch {
      // Best-effort
    } finally {
      setLoadingOlder(false);
    }
  }, [sessionId, hasOlder, loadingOlder, dmPair]);

  // Initial load + SSE with polling fallback
  useEffect(() => {
    if (!sessionId || !enabled) return;

    if (!historyLoadedRef.current) {
      loadHistory();
    }

    // Try SSE first for instant updates, fall back to polling
    const isDM = sessionId.startsWith('dm:');
    let eventSource: EventSource | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let usingSSE = false;

    const startPolling = () => {
      const getDelay = () => {
        const idle = Date.now() - lastActivityRef.current;
        return idle > 60_000 ? 15_000 : 2_000;
      };
      const schedule = () => {
        timeout = setTimeout(async () => {
          await poll();
          schedule();
        }, getDelay());
      };
      schedule();
    };

    if (!isDM) {
      try {
        const sseUrl = workspaceApi.getSSEUrl(sessionId);
        eventSource = new EventSource(sseUrl);
        usingSSE = true;

        eventSource.onmessage = (ev) => {
          if (sessionId !== currentSessionRef.current) return;
          try {
            const event = JSON.parse(ev.data);
            const msg = eventToMessage(event);
            newestIdRef.current = msg.messageId;
            setMessages((prev) => {
              if (prev.some((m) => m.messageId === msg.messageId)) return prev;
              return [...prev, msg];
            });
          } catch {
            // malformed event
          }
        };

        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          usingSSE = false;
          startPolling();
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      if (eventSource) eventSource.close();
      if (timeout) clearTimeout(timeout);
    };
  }, [sessionId, enabled, poll, loadHistory]);

  // If seeded with cache, do a background refresh to catch any new messages
  useEffect(() => {
    if (!sessionId || !enabled) return;
    if (initialMessages && initialMessages.length > 0) {
      // Immediately poll for new messages after cache display
      poll();
    }
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Force immediate poll (after sending a message)
  const forceRefresh = useCallback(() => {
    lastActivityRef.current = Date.now();
    poll();
  }, [poll]);

  return { messages, loading, forceRefresh, generation, loadOlder, hasOlder, loadingOlder };
}
