'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  KanbanSquare,
  Plus,
  RefreshCw,
  Trash2,
  UserPlus,
  ChevronDown,
  Play,
  Square,
  Waypoints,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { DetailHeader } from '@/components/layout/app-header';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { KanbanTask } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { NewTaskDialog } from './new-task-dialog';
import { TaskChatPopup } from './task-chat-popup';

// ── Card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onSetAssignee,
  onRun,
  onStop,
  onOpenChat,
  onDelete,
}: {
  task: KanbanTask;
  onSetAssignee: (agent: string) => void;
  onRun: () => void;
  onStop: () => void;
  onOpenChat: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { agents, workflows } = useWorkspace();
  const onlineAgents = agents.filter((a) => a.status === 'online');

  const isBacklog = task.status === 'backlog' || task.status === 'todo';
  const isRunning = task.status === 'in_progress';
  const needsInput = task.status === 'need_input';
  const openable = !!task.channelName;
  const runnable = !!task.assignee || !!task.workflowId;
  const workflowName = task.workflowId
    ? (workflows.find((w) => w.id === task.workflowId)?.name || t('views.workflows'))
    : '';

  return (
    <div
      onClick={openable ? onOpenChat : undefined}
      title={openable ? t('tasks.openChat') : undefined}
      className={cn(
        'group relative rounded-lg border bg-card p-3 shadow-sm transition-colors',
        openable ? 'cursor-pointer hover:border-foreground/30' : 'hover:border-foreground/20',
        needsInput ? 'border-rose-400/70' : isRunning ? 'border-amber-400/70' : 'border-border',
      )}
    >
      {/* Attention ring: red pulse when the agent needs input, amber while working. */}
      {(needsInput || isRunning) && (
        <span
          className={cn(
            'pointer-events-none absolute inset-0 rounded-lg ring-2 animate-pulse',
            needsInput ? 'ring-rose-400/70' : 'ring-amber-400/70',
          )}
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug break-words min-w-0">{task.title}</p>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-500 transition-opacity"
          title={t('tasks.deleteTask')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {needsInput && (
        <span className="mt-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10">
          {t('tasks.needsInput')}
        </span>
      )}

      {task.description && (
        <p className="mt-1 text-xs text-muted-foreground leading-snug line-clamp-3 whitespace-pre-wrap">
          {task.description}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {/* Run — backlog only. Needs an agent or a workflow first. */}
        {isBacklog && (
          <button
            onClick={(e) => { e.stopPropagation(); if (runnable) onRun(); }}
            disabled={!runnable}
            className={cn(
              'flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium transition-colors',
              runnable
                ? 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                : 'text-muted-foreground/40 cursor-not-allowed',
            )}
            title={runnable ? t('tasks.run') : t('tasks.assignFirst')}
          >
            <Play className="size-3.5" />
            {t('tasks.run')}
          </button>
        )}

        {/* Stop — while running or awaiting input. */}
        {(isRunning || needsInput) && (
          <button
            onClick={(e) => { e.stopPropagation(); onStop(); }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
            title={t('tasks.stop')}
          >
            <Square className="size-3 fill-current" />
            {t('tasks.stop')}
          </button>
        )}

        <div className="flex-1" />

        {/* Workflow task: show a workflow badge instead of the agent picker. */}
        {task.workflowId ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground max-w-32 truncate" title={workflowName}>
            <Waypoints className="size-3.5 shrink-0" />
            <span className="truncate">{workflowName}</span>
          </span>
        ) : isBacklog ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                title={task.assignee ? t('tasks.reassign') : t('tasks.assign')}
              >
                {task.assignee ? (
                  <>
                    <AgentAvatar name={task.assignee} size={18} />
                    <ChevronDown className="size-3" />
                  </>
                ) : (
                  <>
                    <UserPlus className="size-3.5" />
                    <span>{t('tasks.assign')}</span>
                  </>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t('tasks.assignTo')}</DropdownMenuLabel>
              {onlineAgents.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('tasks.noAgentsOnline')}</div>
              ) : (
                onlineAgents.map((a) => (
                  <DropdownMenuItem
                    key={a.agentName}
                    onClick={(e) => { e.stopPropagation(); onSetAssignee(a.agentName); }}
                    className="gap-2"
                  >
                    <AgentAvatar name={a.agentName} size={18} />
                    <span className="truncate">{a.agentName}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          task.assignee && <AgentAvatar name={task.assignee} size={18} />
        )}
      </div>
    </div>
  );
}

// ── Column ────────────────────────────────────────────────────────────────

function BoardColumn({
  dotClass,
  title,
  count,
  canAdd,
  onAdd,
  className,
  children,
}: {
  dotClass: string;
  title: string;
  count: number;
  canAdd?: boolean;
  onAdd?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col rounded-xl border border-border/60 bg-muted/30 min-h-0', className)}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className={cn('size-2 rounded-full', dotClass)} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground/60">{count}</span>
        <div className="flex-1" />
        {canAdd && onAdd && (
          <button onClick={onAdd} className="text-muted-foreground hover:text-foreground transition-colors" title={title}>
            <Plus className="size-3.5" />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">{children}</div>
    </div>
  );
}

// ── Board ─────────────────────────────────────────────────────────────────

export function TasksView() {
  const { tasks, refreshTasks, createTask, updateTask, runTask, stopTask, deleteTask } = useWorkspace();
  const t = useT();

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [chatTask, setChatTask] = useState<KanbanTask | null>(null);

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  const { backlog, inProgress, done } = useMemo(() => {
    const b: KanbanTask[] = [], p: KanbanTask[] = [], d: KanbanTask[] = [];
    for (const task of tasks) {
      if (task.status === 'done') d.push(task);
      else if (task.status === 'in_progress' || task.status === 'need_input') p.push(task);
      else b.push(task); // backlog (+ any legacy 'todo')
    }
    const sort = (arr: KanbanTask[]) =>
      arr.sort((a, c) => a.position - c.position || (a.createdAt || '').localeCompare(c.createdAt || ''));
    return { backlog: sort(b), inProgress: sort(p), done: sort(d) };
  }, [tasks]);

  const renderCards = (items: KanbanTask[]) =>
    items.map((task) => (
      <TaskCard
        key={task.id}
        task={task}
        onSetAssignee={(agent) => updateTask(task.id, { assignee: agent })}
        onRun={() => runTask(task.id)}
        onStop={() => stopTask(task.id)}
        onOpenChat={() => setChatTask(task)}
        onDelete={() => deleteTask(task.id)}
      />
    ));

  return (
    <div className="h-full flex flex-col">
      <DetailHeader
        title={<>
          <KanbanSquare className="size-4 text-foreground" />
          <h2 className="text-sm font-semibold">{t('views.tasks')}</h2>
        </>}
      >
        <Button size="sm" onClick={() => setNewTaskOpen(true)} className="gap-1.5">
          <Plus className="size-3.5" />
          {t('tasks.newTask')}
        </Button>
        <button
          onClick={refreshTasks}
          className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </DetailHeader>

      {/* Board: Backlog (2/3) on the left; In Progress + Done stacked on the right (1/3). */}
      <div className="flex-1 flex gap-3 p-4 min-h-0">
        <BoardColumn
          dotClass="bg-zinc-400"
          title={t('tasks.col.backlog')}
          count={backlog.length}
          canAdd
          onAdd={() => setNewTaskOpen(true)}
          className="w-2/3"
        >
          {renderCards(backlog)}
          <button
            onClick={() => setNewTaskOpen(true)}
            className="w-full rounded-lg border border-dashed border-border/60 py-6 text-xs text-muted-foreground/60 hover:border-border hover:text-muted-foreground transition-colors"
          >
            {t('tasks.addCard')}
          </button>
        </BoardColumn>

        <div className="w-1/3 flex flex-col gap-3 min-h-0">
          <BoardColumn
            dotClass="bg-amber-500"
            title={t('tasks.col.in_progress')}
            count={inProgress.length}
            className="flex-1"
          >
            {inProgress.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground/50">{t('tasks.emptyInProgress')}</p>
            ) : renderCards(inProgress)}
          </BoardColumn>

          <BoardColumn
            dotClass="bg-emerald-500"
            title={t('tasks.col.done')}
            count={done.length}
            className="flex-1"
          >
            {done.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-muted-foreground/50">{t('tasks.emptyDone')}</p>
            ) : renderCards(done)}
          </BoardColumn>
        </div>
      </div>

      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        onCreate={({ title, description, assignee, workflowId }) =>
          createTask({ title, description, assignee, workflowId, status: 'backlog' })
        }
      />

      {chatTask?.channelName && (
        <TaskChatPopup
          open={!!chatTask}
          onOpenChange={(o) => !o && setChatTask(null)}
          sessionId={chatTask.channelName}
          taskTitle={chatTask.title}
          assignee={chatTask.assignee}
        />
      )}
    </div>
  );
}
