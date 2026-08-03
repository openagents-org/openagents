'use client';

import { useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ListTodo, CheckCircle2, Circle, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { DetailHeader } from '@/components/layout/app-header';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import type { TodoItem } from '@/lib/types';
import { useFormatters, useT } from '@/lib/i18n';

/**
 * The row's status glyph.
 *
 * `mt-0.5` centres the 16px icon against the first line of `text-sm
 * leading-snug` text (~19px tall) — the row aligns to the top so wrapped
 * content stays put, which without this nudge leaves the icon riding ~2px high.
 * Same trick as the inbox's priority dot.
 */
function StatusIcon({ status }: { status: TodoItem['status'] }) {
  const className = 'size-4 shrink-0 mt-0.5';

  if (status === 'completed') return <CheckCircle2 className={cn(className, 'text-emerald-500')} />;
  if (status === 'in_progress') return <Loader2 className={cn(className, 'text-foreground animate-spin')} />;
  if (status === 'cancelled') return <XCircle className={cn(className, 'text-zinc-400')} />;
  return <Circle className={cn(className, 'text-zinc-400')} />;
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
  const t = useT();
  const { timeAgo } = useFormatters();

  if (items.length === 0) return null;

  return (
    <div>
      {/* Indented onto the same vertical line as the rows below: the card's
          12px padding plus its 1px border, with the row's icon size and gap.
          The heading sits outside the card, so without this its icon and text
          each start ~13px to the left of every row they label. */}
      <div className="flex items-center gap-2.5 mb-2 pl-3.25">
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
                  <span className="text-[10px] text-muted-foreground/60 ml-1.5">{t('tasks.timedOut')}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                <AgentAvatar name={agentName} size={16} />
                {channelTitle && (
                  <span className="text-[10px] text-muted-foreground max-w-25 truncate">{channelTitle}</span>
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
  const t = useT();

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
          <h2 className="text-sm font-semibold">{t('views.tasks')}</h2>
        </>}
      >
        {totalActive > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('tasks.activeCount', { count: totalActive })}
            {inProgressItems.length > 0 &&
              ` · ${t('tasks.inProgressCount', { count: inProgressItems.length })}`}
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
            <p className="text-sm">{t('tasks.emptyTitle')}</p>
            <p className="text-xs opacity-60">{t('tasks.emptyBody')}</p>
          </div>
        ) : (
          <div className="p-4 space-y-6">
            <StatusSection
              title={t('tasks.sectionInProgress')}
              icon={<Loader2 className="size-4 text-foreground animate-spin" />}
              items={inProgressItems}
              sessions={sessions}
            />
            <StatusSection
              title={t('tasks.sectionPending')}
              icon={<Circle className="size-4 text-zinc-400" />}
              items={pendingItems}
              sessions={sessions}
            />
            <StatusSection
              title={t('tasks.sectionCompleted')}
              icon={<CheckCircle2 className="size-4 text-emerald-500" />}
              items={doneItems}
              sessions={sessions}
            />
          </div>
        )}
      </div>
    </div>
  );
}
