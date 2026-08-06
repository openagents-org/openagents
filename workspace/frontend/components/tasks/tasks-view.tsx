'use client';

import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  KanbanSquare,
  Plus,
  RefreshCw,
  MessageSquare,
  Trash2,
  UserPlus,
  ChevronDown,
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
import type { KanbanTask, TaskPriority, TaskStatus } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { NewTaskDialog } from './new-task-dialog';
import { TaskChatPopup } from './task-chat-popup';

// Board columns, in display order. Each dot tints the column header.
const COLUMNS: { key: TaskStatus; dot: string }[] = [
  { key: 'backlog', dot: 'bg-zinc-400' },
  { key: 'todo', dot: 'bg-sky-500' },
  { key: 'in_progress', dot: 'bg-amber-500' },
  { key: 'need_input', dot: 'bg-rose-500' },
  { key: 'done', dot: 'bg-emerald-500' },
];

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: 'text-sky-600 dark:text-sky-400 bg-sky-500/10',
  normal: 'text-zinc-500 dark:text-zinc-400 bg-zinc-500/10',
  high: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
};

function TaskCard({
  task,
  onAssign,
  onOpenChat,
  onDelete,
  onDragStart,
}: {
  task: KanbanTask;
  onAssign: (agent: string) => void;
  onOpenChat: () => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const t = useT();
  const { agents } = useWorkspace();
  const onlineAgents = agents.filter((a) => a.status === 'online');

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="group rounded-lg border border-border bg-card p-3 shadow-sm hover:border-foreground/20 transition-colors cursor-grab active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug break-words min-w-0">{task.title}</p>
        <button
          onClick={onDelete}
          className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-rose-500 transition-opacity"
          title={t('tasks.deleteTask')}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {task.description && (
        <p className="mt-1 text-xs text-muted-foreground leading-snug line-clamp-3 whitespace-pre-wrap">
          {task.description}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium capitalize', PRIORITY_STYLES[task.priority])}>
          {t(`tasks.priority.${task.priority}`)}
        </span>

        <div className="flex-1" />

        {task.channelName && (
          <button
            onClick={onOpenChat}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={t('tasks.openChat')}
          >
            <MessageSquare className="size-3.5" />
          </button>
        )}

        {/* Assignee / assign control */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
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
                <DropdownMenuItem key={a.agentName} onClick={() => onAssign(a.agentName)} className="gap-2">
                  <AgentAvatar name={a.agentName} size={18} />
                  <span className="truncate">{a.agentName}</span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function TasksView() {
  const { tasks, refreshTasks, createTask, updateTask, assignTask, deleteTask } = useWorkspace();
  const t = useT();

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [newTaskStatus, setNewTaskStatus] = useState<TaskStatus>('backlog');
  const [chatTask, setChatTask] = useState<KanbanTask | null>(null);
  const [dragOverCol, setDragOverCol] = useState<TaskStatus | null>(null);

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  const byColumn = useMemo(() => {
    const map: Record<TaskStatus, KanbanTask[]> = {
      backlog: [], todo: [], in_progress: [], need_input: [], done: [],
    };
    for (const task of tasks) {
      (map[task.status] ?? map.backlog).push(task);
    }
    for (const key of Object.keys(map) as TaskStatus[]) {
      map[key].sort((a, b) => a.position - b.position || (a.createdAt || '').localeCompare(b.createdAt || ''));
    }
    return map;
  }, [tasks]);

  const openNewTask = (status: TaskStatus) => {
    setNewTaskStatus(status);
    setNewTaskOpen(true);
  };

  const handleDrop = (status: TaskStatus) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverCol(null);
    const id = e.dataTransfer.getData('text/task-id');
    if (!id) return;
    const task = tasks.find((tk) => tk.id === id);
    if (!task || task.status === status) return;
    updateTask(id, { status });
  };

  return (
    <div className="h-full flex flex-col">
      <DetailHeader
        title={<>
          <KanbanSquare className="size-4 text-foreground" />
          <h2 className="text-sm font-semibold">{t('views.tasks')}</h2>
        </>}
      >
        <Button size="sm" onClick={() => openNewTask('backlog')} className="gap-1.5">
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

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-3 p-4 min-w-max">
          {COLUMNS.map((col) => {
            const items = byColumn[col.key];
            return (
              <div
                key={col.key}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
                onDragLeave={() => setDragOverCol((c) => (c === col.key ? null : c))}
                onDrop={handleDrop(col.key)}
                className={cn(
                  'flex h-full w-72 shrink-0 flex-col rounded-xl border transition-colors',
                  dragOverCol === col.key ? 'border-primary/60 bg-primary/5' : 'border-border/60 bg-muted/30'
                )}
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className={cn('size-2 rounded-full', col.dot)} />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {t(`tasks.col.${col.key}`)}
                  </h3>
                  <span className="text-xs text-muted-foreground/60">{items.length}</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => openNewTask(col.key)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={t('tasks.newTask')}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      onAssign={(agent) => assignTask(task.id, agent)}
                      onOpenChat={() => setChatTask(task)}
                      onDelete={() => deleteTask(task.id)}
                      onDragStart={(e) => e.dataTransfer.setData('text/task-id', task.id)}
                    />
                  ))}
                  {items.length === 0 && (
                    <button
                      onClick={() => openNewTask(col.key)}
                      className="w-full rounded-lg border border-dashed border-border/60 py-6 text-xs text-muted-foreground/60 hover:border-border hover:text-muted-foreground transition-colors"
                    >
                      {t('tasks.addCard')}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <NewTaskDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        status={newTaskStatus}
        onCreate={async ({ title, description, priority, assignee }) => {
          const task = await createTask({ title, description, priority, status: newTaskStatus });
          // Assigning an agent at creation kicks off the work immediately
          // (creates the hidden thread, posts the kickoff, moves to In Progress).
          if (assignee) await assignTask(task.id, assignee);
        }}
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
