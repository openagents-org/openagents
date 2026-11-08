'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Circle, Loader2, Timer, X } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import type { TimerItem } from '@/lib/types';
import { useT } from '@/lib/i18n';

/** Countdown to a timer's next fire. Units stay in the compact `12m` shorthand. */
function timeUntil(dateStr: string, nowLabel: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return nowLabel;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h`;
}

export function ThreadStatusBar({ channelName }: { channelName: string }) {
  const { todos, refreshTodos } = useWorkspace();
  const t = useT();
  const [timers, setTimers] = useState<TimerItem[]>([]);

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

  const hasContent = pendingCount > 0 || inProgressCount > 0 || activeTimers.length > 0;
  // v1.1 M1 / permission model: the access control lives on this bar (the chat header is owned
  // elsewhere), so the bar also renders for a plain channel with nothing queued.
  if (!hasContent) return null;

  return (
    <div className="flex flex-col gap-0.5 px-1 py-1 text-[11px] text-muted-foreground">
      {/* v1.1 permission model: "Private · N people" / "Public" + owner, owner controls, Join */}

      {/* Todos and timers row */}
      {(inProgressCount > 0 || pendingCount > 0 || activeTimers.length > 0) && (
        <div className="flex items-center gap-2.5">
          {(inProgressCount > 0 || pendingCount > 0) && (
            <span className="flex items-center gap-1">
              {inProgressCount > 0 && (
                <>
                  <Loader2 className="size-3 text-foreground animate-spin" />
                  <span>{t('threadStatus.inProgress', { count: inProgressCount })}</span>
                </>
              )}
              {inProgressCount > 0 && pendingCount > 0 && <span className="text-muted-foreground/30">·</span>}
              {pendingCount > 0 && (
                <>
                  <Circle className="size-3" />
                  <span>{t('threadStatus.pending', { count: pendingCount })}</span>
                </>
              )}
              <button
                onClick={handleCancelTodos}
                className="ml-0.5 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title={t('threadStatus.cancelAllTasks')}
              >
                <X className="size-3" />
              </button>
            </span>
          )}
          {activeTimers.map((timer) => (
            <span key={timer.id} className="flex items-center gap-1">
              <Timer className="size-3 text-amber-500" />
              <span>{timer.message.length > 30 ? timer.message.slice(0, 30) + '…' : timer.message}</span>
              <span className="text-amber-500 font-mono">{timeUntil(timer.firesAt, t('threadStatus.now'))}</span>
              <button
                onClick={() => handleCancelTimer(timer.id)}
                className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                title={t('threadStatus.cancelTimer')}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

    </div>
  );
}
