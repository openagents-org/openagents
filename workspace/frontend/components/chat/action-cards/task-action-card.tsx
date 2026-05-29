'use client';

import { cn } from '@/lib/utils';
import { ListTodo } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskActionMetadata {
  actionType: 'task_created' | 'task_updated';
  task: {
    id: string;
    title: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    status: string;
    assignee?: string | null;
  };
}

// ---------------------------------------------------------------------------
// Priority styles
// ---------------------------------------------------------------------------

const PRIORITY_BORDER: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-blue-500',
  low: 'border-l-zinc-400',
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-500/15 text-red-600 dark:text-red-400',
  high: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  medium: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  low: 'bg-zinc-500/10 text-zinc-500',
};

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-zinc-500/10 text-zinc-500',
  in_progress: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-zinc-500/10 text-zinc-400 line-through',
  blocked: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskActionCard({ metadata }: { metadata: TaskActionMetadata }) {
  const { task, actionType } = metadata;
  const isCreated = actionType === 'task_created';
  const headerText = isCreated ? '任务已创建' : '任务已更新';

  return (
    <div
      className={cn(
        'rounded-lg border bg-muted/30 border-l-4 max-w-sm p-3 space-y-1.5',
        PRIORITY_BORDER[task.priority] || 'border-l-zinc-400',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ListTodo className="size-3.5" />
        <span>{headerText}</span>
      </div>

      {/* Title */}
      <p className="text-sm font-medium text-foreground leading-snug">
        {task.title}
      </p>

      {/* Badges row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider',
            PRIORITY_BADGE[task.priority],
          )}
        >
          {task.priority}
        </span>
        <span
          className={cn(
            'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
            STATUS_BADGE[task.status] || STATUS_BADGE.pending,
          )}
        >
          {task.status.replace('_', ' ')}
        </span>
        {task.assignee && (
          <span className="text-[10px] text-muted-foreground">
            → {task.assignee}
          </span>
        )}
      </div>
    </div>
  );
}
