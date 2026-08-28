'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  KanbanSquare,
  Plus,
  RefreshCw,
  Trash2,
  Pencil,
  UserPlus,
  ChevronDown,
  Play,
  Square,
  RotateCcw,
  Waypoints,
  BookOpen,
} from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { DetailHeader } from '@/components/layout/app-header';
import { FeatureTourBanner } from '@/components/tours/feature-tours';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { agentLabel } from '@/lib/helpers';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { KanbanTask } from '@/lib/types';
import { useFormatters, useT } from '@/lib/i18n';
import { NewTaskDialog } from './new-task-dialog';
import { TaskChatPopup } from './task-chat-popup';

// ── Card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  onSetAssignee,
  onRun,
  onStop,
  onOpenChat,
  onEdit,
  onDelete,
}: {
  task: KanbanTask;
  onSetAssignee: (agent: string) => void;
  onRun: () => void;
  onStop: () => void;
  onOpenChat: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const { timeAgo } = useFormatters();
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
      onClick={openable ? onOpenChat : isBacklog ? onEdit : undefined}
      title={openable ? t('tasks.openChat') : isBacklog ? t('tasks.editTaskTitle') : undefined}
      className={cn(
        'group relative rounded-lg border bg-card p-3 shadow-sm transition-colors',
        openable || isBacklog ? 'cursor-pointer hover:border-foreground/30' : 'hover:border-foreground/20',
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
        <div className="flex items-center gap-1.5 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {isBacklog && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="-m-1 p-1 text-muted-foreground hover:text-foreground"
              title={t('tasks.editTaskTitle')}
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="-m-1 p-1 text-muted-foreground hover:text-rose-500"
            title={t('tasks.deleteTask')}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      {needsInput && (
        <span className="mt-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10">
          {t('tasks.needsInput')}
        </span>
      )}

      {/* Need-input question: surface the thread's last message so the human
          can often see what's being asked without opening the popup. */}
      {needsInput && task.lastMessage && (
        <p className="mt-1.5 rounded-md bg-rose-500/5 border border-rose-400/20 px-2 py-1.5 text-[11px] text-muted-foreground leading-snug line-clamp-3 whitespace-pre-wrap">
          {task.lastMessage}
        </p>
      )}

      {task.description && (
        <p className="mt-1 text-xs text-muted-foreground leading-snug line-clamp-3 whitespace-pre-wrap">
          {task.description}
        </p>
      )}

      {/* Workflow progress: “Step 2/3 · Review” + step dots. */}
      {task.workflowId && task.run && task.run.stepCount > 0 && (isRunning || needsInput || task.run.status === 'paused') && (
        <div className="mt-2 flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {Array.from({ length: task.run.stepCount }, (_, i) => (
              <span
                key={i}
                className={cn(
                  'size-1.5 rounded-full',
                  i < task.run!.stepIndex ? 'bg-emerald-500'
                    : i === task.run!.stepIndex ? (needsInput ? 'bg-rose-500' : 'bg-amber-500 animate-pulse')
                    : 'bg-muted-foreground/25',
                )}
              />
            ))}
          </span>
          <span className="text-[10px] text-muted-foreground truncate">
            {t('tasks.stepProgress', { current: task.run.stepIndex + 1, total: task.run.stepCount })}
            {task.run.stepName ? ` · ${task.run.stepName}` : ''}
            {task.run.stepAssignee ? ` · @${task.run.stepAssignee}` : ''}
          </span>
          {/* Loop counter — visible churn for draft/review-style cycles. */}
          {task.run.iterations > 0 && (
            <span
              className="shrink-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
              title={t('workflows.maxIterations')}
            >
              ↺ {task.run.iterations}/{task.run.maxIterations}
            </span>
          )}
        </div>
      )}

      {/* Live activity: what the agent is doing right now (thread-list style). */}
      {isRunning && task.lastMessage && (
        <p className="mt-1.5 text-[11px] italic text-muted-foreground/70 leading-snug line-clamp-2 whitespace-pre-wrap">
          {task.lastMessage}
        </p>
      )}

      {/* Relative timestamp — added / updated / done — plus attached context. */}
      <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
        <span>
          {task.status === 'done'
            ? t('tasks.metaDone', { time: timeAgo(task.updatedAt || task.createdAt) })
            : isBacklog
              ? t('tasks.metaAdded', { time: timeAgo(task.createdAt) })
              : t('tasks.metaUpdated', { time: timeAgo(task.updatedAt || task.createdAt) })}
        </span>
        {task.knowledgeIds.length > 0 && (
          <span className="inline-flex items-center gap-0.5" title={t('tasks.contextCount', { count: task.knowledgeIds.length })}>
            · <BookOpen className="size-3" /> {task.knowledgeIds.length}
          </span>
        )}
      </p>

      <div className="mt-1.5 flex items-center gap-2">
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

        {/* Re-run — a done task can be run again (workflow restarts at step 1). */}
        {task.status === 'done' && runnable && (
          <button
            onClick={(e) => { e.stopPropagation(); onRun(); }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title={t('tasks.rerun')}
          >
            <RotateCcw className="size-3.5" />
            {t('tasks.rerun')}
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
                    <span className="truncate">{agentLabel(a)}</span>
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
  const [editTask, setEditTask] = useState<KanbanTask | null>(null);
  const [chatTask, setChatTask] = useState<KanbanTask | null>(null);

  // The popup should reflect live poll updates (step progress, status), not
  // the snapshot captured when it was opened.
  const liveChatTask = chatTask ? tasks.find((x) => x.id === chatTask.id) ?? chatTask : null;

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  // Deep-link from the Inbox: open the chat popup for the requested task
  // thread once the board has it.
  const { pendingTaskChannel, setPendingTaskChannel } = useLayout();
  useEffect(() => {
    if (!pendingTaskChannel) return;
    const target = tasks.find((x) => x.channelName === pendingTaskChannel);
    if (target) {
      setChatTask(target);
      setPendingTaskChannel(null);
    }
  }, [pendingTaskChannel, tasks, setPendingTaskChannel]);

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
        onEdit={() => setEditTask(task)}
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

      <FeatureTourBanner feature="tasks" />

      {/* Board — stacks vertically on mobile; on ≥sm it's Backlog (2/3) beside
          In Progress + Done stacked (1/3). The whole board scrolls on mobile;
          on desktop each column scrolls within a fixed height. */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:overflow-hidden sm:p-4">
        <div className="flex flex-col gap-3 sm:h-full sm:min-h-0 sm:flex-row">
          <BoardColumn
            dotClass="bg-zinc-400"
            title={t('tasks.col.backlog')}
            count={backlog.length}
            canAdd
            onAdd={() => setNewTaskOpen(true)}
            className="sm:w-2/3"
          >
            {/* The primary add affordance: a big, unmissable button that opens
                the full create dialog (title/description/context/run-with). */}
            <Button
              size="lg"
              onClick={() => setNewTaskOpen(true)}
              className="w-full gap-1.5 shrink-0"
            >
              <Plus className="size-4" />
              {t('tasks.newTask')}
            </Button>
            {renderCards(backlog)}
          </BoardColumn>

          <div className="flex flex-col gap-3 sm:w-1/3 sm:min-h-0">
            <BoardColumn
              dotClass="bg-amber-500"
              title={t('tasks.col.in_progress')}
              count={inProgress.length}
              className="sm:flex-1"
            >
              {inProgress.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground/50">{t('tasks.emptyInProgress')}</p>
              ) : renderCards(inProgress)}
            </BoardColumn>

            <BoardColumn
              dotClass="bg-emerald-500"
              title={t('tasks.col.done')}
              count={done.length}
              className="sm:flex-1"
            >
              {done.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-muted-foreground/50">{t('tasks.emptyDone')}</p>
              ) : renderCards(done)}
            </BoardColumn>
          </div>
        </div>
      </div>

      <NewTaskDialog
        open={newTaskOpen || !!editTask}
        onOpenChange={(o) => {
          if (!o) { setNewTaskOpen(false); setEditTask(null); }
        }}
        task={editTask}
        onSubmit={({ title, description, assignee, workflowId, knowledgeIds }) => {
          if (editTask) {
            updateTask(editTask.id, { title, description, assignee, workflowId, knowledgeIds });
          } else {
            createTask({ title, description, assignee, workflowId, knowledgeIds, status: 'backlog' });
          }
        }}
      />

      {liveChatTask?.channelName && (
        <TaskChatPopup
          open={!!liveChatTask}
          onOpenChange={(o) => !o && setChatTask(null)}
          sessionId={liveChatTask.channelName}
          taskTitle={liveChatTask.title}
          assignee={liveChatTask.assignee}
          subtitle={
            liveChatTask.run && liveChatTask.run.stepCount > 0 && liveChatTask.run.stepIndex >= 0
              ? `${t('tasks.stepProgress', { current: liveChatTask.run.stepIndex + 1, total: liveChatTask.run.stepCount })}${liveChatTask.run.stepName ? ` · ${liveChatTask.run.stepName}` : ''}`
              : undefined
          }
        />
      )}
    </div>
  );
}
