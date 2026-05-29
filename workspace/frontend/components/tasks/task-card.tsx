'use client';

import { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/api-tasks';
import {
  Circle,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  User,
  Bot,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: Task['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />;
    case 'in_progress':
      return <Loader2 className="size-4 text-blue-500 shrink-0 animate-spin" />;
    case 'cancelled':
      return <XCircle className="size-4 text-muted-foreground shrink-0" />;
    case 'blocked':
      return <AlertTriangle className="size-4 text-amber-500 shrink-0" />;
    default:
      return <Circle className="size-4 text-muted-foreground shrink-0" />;
  }
}

// ---------------------------------------------------------------------------
// Priority badge
// ---------------------------------------------------------------------------

const PRIORITY_STYLES: Record<Task['priority'], string> = {
  urgent: 'bg-red-500/15 text-red-500 border-red-500/20',
  high: 'bg-orange-500/15 text-orange-500 border-orange-500/20',
  medium: 'bg-blue-500/15 text-blue-500 border-blue-500/20',
  low: 'bg-muted text-muted-foreground border-border',
};

function PriorityBadge({ priority }: { priority: Task['priority'] }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider',
        PRIORITY_STYLES[priority],
      )}
    >
      {priority}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Confidence bar (for agent tasks)
// ---------------------------------------------------------------------------

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground">{pct}%</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TaskCard
// ---------------------------------------------------------------------------

interface TaskCardProps {
  task: Task;
  onStatusChange?: (id: string, status: Task['status']) => void;
}

export function TaskCard({ task, onStatusChange }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);

  const handleStatusToggle = useCallback(() => {
    if (!onStatusChange) return;
    if (task.status === 'completed') {
      onStatusChange(task.id, 'pending');
    } else if (task.status === 'pending' || task.status === 'in_progress') {
      onStatusChange(task.id, 'completed');
    }
  }, [task.id, task.status, onStatusChange]);

  const dueDateStr = useMemo(() => {
    if (!task.dueDate) return null;
    const d = new Date(task.dueDate);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, [task.dueDate]);

  const isOverdue = useMemo(() => {
    if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') return false;
    return new Date(task.dueDate) < new Date();
  }, [task.dueDate, task.status]);

  return (
    <div
      className="group px-3 py-2.5 flex flex-col gap-1.5 hover:bg-muted/50 transition-colors cursor-pointer"
      onClick={() => setExpanded((prev) => !prev)}
    >
      {/* Main row */}
      <div className="flex items-center gap-2.5">
        <button
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            handleStatusToggle();
          }}
        >
          <StatusIcon status={task.status} />
        </button>

        <div className="min-w-0 flex-1 flex items-center gap-2">
          <span
            className={cn(
              'text-sm leading-snug truncate',
              (task.status === 'completed' || task.status === 'cancelled') &&
                'line-through text-muted-foreground',
            )}
          >
            {task.title}
          </span>
          {task.tags.length > 0 && (
            <div className="hidden sm:flex items-center gap-1">
              {task.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground border border-border"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <PriorityBadge priority={task.priority} />
          {task.assignee && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground max-w-[100px]">
              {task.assigneeType === 'agent' ? (
                <Bot className="size-3 shrink-0" />
              ) : (
                <User className="size-3 shrink-0" />
              )}
              <span className="truncate">{task.assignee}</span>
            </div>
          )}
          {dueDateStr && (
            <span
              className={cn(
                'text-[10px] whitespace-nowrap',
                isOverdue ? 'text-red-500 font-medium' : 'text-muted-foreground',
              )}
            >
              {dueDateStr}
            </span>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="pl-7 space-y-2 pb-1">
          {task.description && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {task.description}
            </p>
          )}
          {task.taskType === 'agent' && task.agentConfidence != null && (
            <div className="flex items-center gap-3">
              <ConfidenceBar confidence={task.agentConfidence} />
            </div>
          )}
          {task.taskType === 'agent' &&
            task.agentResult &&
            task.status === 'completed' && (
              <div className="rounded-md border border-border bg-muted/50 p-2">
                <p className="text-xs text-foreground">
                  {(task.agentResult as Record<string, unknown>).summary as string}
                </p>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project section (collapsible)
// ---------------------------------------------------------------------------

interface ProjectSectionProps {
  projectName: string;
  humanTasks: Task[];
  agentTasks: Task[];
  onStatusChange?: (id: string, status: Task['status']) => void;
}

export function ProjectSection({
  projectName,
  humanTasks,
  agentTasks,
  onStatusChange,
}: ProjectSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const totalCount = humanTasks.length + agentTasks.length;

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      {/* Section header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        )}
        <span className="text-sm font-medium text-foreground">{projectName}</span>
        <span className="text-xs text-muted-foreground">{totalCount}</span>
      </button>

      {!collapsed && (
        <div className="divide-y divide-border border-t border-border">
          {/* Human tasks */}
          {humanTasks.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-muted/30">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <User className="size-3" /> Human Tasks
                  <span className="opacity-60">{humanTasks.length}</span>
                </span>
              </div>
              <div className="divide-y divide-border">
                {humanTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onStatusChange={onStatusChange} />
                ))}
              </div>
            </div>
          )}

          {/* Agent tasks */}
          {agentTasks.length > 0 && (
            <div>
              <div className="px-3 py-1.5 bg-muted/30">
                <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Bot className="size-3" /> Agent Tasks
                  <span className="opacity-60">{agentTasks.length}</span>
                </span>
              </div>
              <div className="divide-y divide-border">
                {agentTasks.map((task) => (
                  <TaskCard key={task.id} task={task} onStatusChange={onStatusChange} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
