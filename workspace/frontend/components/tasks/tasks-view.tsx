'use client';

import { useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ListTodo, CheckCircle2, Circle, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { DetailHeader } from '@/components/layout/app-header';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import type { TodoItem } from '@/lib/types';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />;
  if (status === 'in_progress') return <Loader2 className="size-4 text-foreground shrink-0 animate-spin" />;
  if (status === 'cancelled') return <XCircle className="size-4 text-zinc-400 shrink-0" />;
  return <Circle className="size-4 text-zinc-400 shrink-0" />;
}

function StatusSection({
  title,
  icon,
  items,
  sessions,
}: {
  title: string;
  icon: React.ReactNode;
  items: TodoItem[];
  sessions: ReturnType<typeof useWorkspace>['sessions'];
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</h3>
        <span className="text-xs text-muted-foreground/60">{items.length}</span>
      </div>
      <div className="rounded-lg border border-border bg-card overflow-hidden divide-y divide-border">
        {items.map((item) => {
          const agentName = item.createdBy.replace('openagents:', '');
          const session = sessions.find((s) => s.sessionId === item.channelName);
          const channelTitle = session?.title || '';

          return (
            <div key={item.id} className="px-3 py-2 flex items-start gap-2.5">
              <StatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <span className={cn(
                  'text-sm leading-snug',
                  (item.status === 'completed' || item.status === 'cancelled') && 'line-through text-muted-foreground'
                )}>
                  {item.content}
                </span>
                {item.status === 'cancelled' && (
                  <span className="text-[10px] text-muted-foreground/60 ml-1.5">(timed out)</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                <AgentAvatar name={agentName} size={16} />
                {channelTitle && (
                  <span className="text-[10px] text-muted-foreground max-w-[100px] truncate">{channelTitle}</span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {timeAgo(item.updatedAt || item.createdAt)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TasksView() {
  const { todos, refreshTodos, sessions } = useWorkspace();

  useEffect(() => {
    refreshTodos();
  }, [refreshTodos]);

  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  const { inProgressItems, pendingItems, doneItems } = useMemo(() => {
    const inProgress = todos
      .filter((t) => t.status === 'in_progress')
      .sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      });

    const pending = todos
      .filter((t) => t.status === 'pending')
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });

    const done = todos
      .filter((t) =>
        (t.status === 'completed' || t.status === 'cancelled') &&
        t.updatedAt && now - new Date(t.updatedAt).getTime() < oneDayMs
      )
      .sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      });

    return { inProgressItems: inProgress, pendingItems: pending, doneItems: done };
  }, [todos, now, oneDayMs]);

  const totalActive = inProgressItems.length + pendingItems.length;

  return (
    <div className="h-full flex flex-col">
      {/* Header — title in the app header, actions in its toolbar */}
      <DetailHeader
        title={<>
          <ListTodo className="size-4 text-foreground" />
          <h2 className="text-sm font-semibold">Tasks</h2>
        </>}
      >
        {totalActive > 0 && (
          <span className="text-xs text-muted-foreground">
            {totalActive} active{inProgressItems.length > 0 && ` · ${inProgressItems.length} in progress`}
          </span>
        )}
        <button
          onClick={refreshTodos}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </DetailHeader>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <ListTodo className="size-8 opacity-30" />
            <p className="text-sm">No tasks yet</p>
            <p className="text-xs opacity-60">Agent to-do lists will appear here</p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            <StatusSection
              title="In Progress"
              icon={<Loader2 className="size-3.5 text-foreground animate-spin" />}
              items={inProgressItems}

              sessions={sessions}
            />
            <StatusSection
              title="Pending"
              icon={<Circle className="size-3.5 text-zinc-400" />}
              items={pendingItems}

              sessions={sessions}
            />
            <StatusSection
              title="Completed"
              icon={<CheckCircle2 className="size-3.5 text-emerald-500" />}
              items={doneItems}

              sessions={sessions}
            />
          </div>
        )}
      </div>
    </div>
  );
}
