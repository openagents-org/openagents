'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Circle, Loader2, Timer, MessageSquareMore, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import type { TimerItem, WorkspaceMessage } from '@/lib/types';

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

interface QueuedMessage {
  queueId: string;
  content: string;
}

// Any of these means the queue entry reached a terminal state and must not be
// rendered as pending anymore (see agent-connector BaseAdapter, issue #492).
const TERMINAL_QUEUE_STATUSES = new Set(['processed', 'expired', 'cancelled', 'dropped']);
// Queue entries are inferred from durable message history, which can contain
// orphans (agent crashed before emitting a terminal event). Anything older
// than the connector-side queue TTL cannot still be live — hide it.
const QUEUE_ENTRY_MAX_AGE_MS = 15 * 60 * 1000;

export function ThreadStatusBar({ channelName, messages = [] }: { channelName: string; messages?: WorkspaceMessage[] }) {
  const { todos, refreshTodos } = useWorkspace();
  const [timers, setTimers] = useState<TimerItem[]>([]);
  const [cancelledQueueIds, setCancelledQueueIds] = useState<Set<string>>(new Set());

  const pollTimers = useCallback(async () => {
    try {
      const result = await workspaceApi.listTimers(channelName);
      setTimers(result.timers);
    } catch {}
  }, [channelName]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const result = await workspaceApi.listTimers(channelName).catch(() => null);
      if (!cancelled && result) setTimers(result.timers);
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [channelName]);

  const [, setTick] = useState(0);
  useEffect(() => {
    if (!timers.length) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [timers.length]);

  const channelTodos = useMemo(() =>
    todos.filter((t) => t.channelName === channelName && (t.status === 'pending' || t.status === 'in_progress')),
    [todos, channelName]
  );

  // Extract queued messages from status messages with queue metadata
  const queuedMessages = useMemo(() => {
    // First pass: collect queue IDs that reached any terminal state
    const resolvedIds = new Set<string>();
    for (const msg of messages) {
      if (msg.messageType !== 'status') continue;
      const meta = msg.metadata as Record<string, unknown> | undefined;
      if (meta?.queue_id && TERMINAL_QUEUE_STATUSES.has(meta.queue_status as string)) {
        resolvedIds.add(meta.queue_id as string);
      }
    }

    const now = Date.now();
    const queued: QueuedMessage[] = [];
    const seen = new Set<string>();
    // Walk messages in reverse to get latest state per queue_id
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.messageType !== 'status') continue;
      const meta = msg.metadata as Record<string, unknown> | undefined;
      if (!meta?.queue_id || !meta?.queued_message) continue;
      const qid = meta.queue_id as string;
      if (seen.has(qid) || cancelledQueueIds.has(qid) || resolvedIds.has(qid)) continue;
      seen.add(qid);
      if (msg.createdAt && now - new Date(msg.createdAt).getTime() > QUEUE_ENTRY_MAX_AGE_MS) continue;
      queued.push({ queueId: qid, content: meta.queued_message as string });
    }
    return queued.reverse();
  }, [messages, cancelledQueueIds]);

  const pendingCount = channelTodos.filter((t) => t.status === 'pending').length;
  const inProgressCount = channelTodos.filter((t) => t.status === 'in_progress').length;
  const activeTimers = timers.filter((t) => t.status === 'active');

  const handleCancelTimer = useCallback(async (timerId: string) => {
    setTimers((prev) => prev.filter((t) => t.id !== timerId));
    try {
      await workspaceApi.cancelTimer(timerId);
    } catch {}
    pollTimers();
  }, [pollTimers]);

  const handleCancelTodos = useCallback(async () => {
    const agents = Array.from(new Set(channelTodos.map((t) => t.createdBy)));
    for (const source of agents) {
      try {
        await workspaceApi.cancelChannelTodos(channelName, source);
      } catch {}
    }
    refreshTodos();
  }, [channelTodos, channelName, refreshTodos]);

  const handleCancelQueued = useCallback(async (queueId: string) => {
    setCancelledQueueIds((prev) => new Set(prev).add(queueId));
    try {
      await workspaceApi.cancelQueuedMessage(channelName, queueId);
    } catch {}
  }, [channelName]);

  const hasContent = pendingCount > 0 || inProgressCount > 0 || activeTimers.length > 0 || queuedMessages.length > 0;
  if (!hasContent) return null;

  return (
    <div className="flex flex-col gap-0.5 px-1 py-1 text-[11px] text-muted-foreground">
      {/* Todos and timers row */}
      {(inProgressCount > 0 || pendingCount > 0 || activeTimers.length > 0) && (
        <div className="flex items-center gap-2.5">
          {(inProgressCount > 0 || pendingCount > 0) && (
            <span className="flex items-center gap-1">
              {inProgressCount > 0 && (
                <>
                  <Loader2 className="size-3 text-blue-500 animate-spin" />
                  <span>{inProgressCount} in progress</span>
                </>
              )}
              {inProgressCount > 0 && pendingCount > 0 && <span className="text-muted-foreground/30">·</span>}
              {pendingCount > 0 && (
                <>
                  <Circle className="size-3" />
                  <span>{pendingCount} pending</span>
                </>
              )}
              <button
                onClick={handleCancelTodos}
                className="ml-0.5 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title="Cancel all tasks"
              >
                <X className="size-3" />
              </button>
            </span>
          )}
          {activeTimers.map((t) => (
            <span key={t.id} className="flex items-center gap-1">
              <Timer className="size-3 text-amber-500" />
              <span>{t.message.length > 30 ? t.message.slice(0, 30) + '…' : t.message}</span>
              <span className="text-amber-500 font-mono">{timeUntil(t.firesAt)}</span>
              <button
                onClick={() => handleCancelTimer(t.id)}
                className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title="Cancel timer"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Queued messages */}
      {queuedMessages.map((q) => (
        <div key={q.queueId} className="flex items-center gap-1.5 text-blue-500 dark:text-blue-400">
          <MessageSquareMore className="size-3 shrink-0" />
          <span className="truncate">
            Queued: {q.content.length > 60 ? q.content.slice(0, 60) + '…' : q.content}
          </span>
          <button
            onClick={() => handleCancelQueued(q.queueId)}
            className="shrink-0 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            title="Cancel queued message"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
