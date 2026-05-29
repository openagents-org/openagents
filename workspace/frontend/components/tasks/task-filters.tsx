'use client';

import { cn } from '@/lib/utils';
import { getProjectOptions } from '@/lib/api-tasks';
import type { Task } from '@/lib/api-tasks';
import { Filter, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskFilterState {
  projectId: string | null;
  taskType: Task['taskType'] | null;
  status: Task['status'] | null;
  priority: Task['priority'] | null;
}

interface TaskFiltersProps {
  filters: TaskFilterState;
  onChange: (filters: TaskFilterState) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUSES: { value: Task['status']; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'blocked', label: 'Blocked' },
];

const PRIORITIES: { value: Task['priority']; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TaskFilters({ filters, onChange }: TaskFiltersProps) {
  const projects = getProjectOptions();
  const hasActiveFilters =
    filters.projectId || filters.taskType || filters.status || filters.priority;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Filter className="size-3.5 text-muted-foreground shrink-0" />

      {/* Project filter */}
      <select
        value={filters.projectId || ''}
        onChange={(e) =>
          onChange({ ...filters, projectId: e.target.value || null })
        }
        className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All Projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      {/* Type toggle */}
      <div className="flex items-center rounded-md border border-border overflow-hidden">
        {(['all', 'human', 'agent'] as const).map((type) => (
          <button
            key={type}
            onClick={() =>
              onChange({ ...filters, taskType: type === 'all' ? null : type })
            }
            className={cn(
              'px-2 py-1 text-[11px] font-medium transition-colors',
              (type === 'all' && !filters.taskType) ||
                filters.taskType === type
                ? 'bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            {type === 'all' ? 'All' : type === 'human' ? '🧑 Human' : '🤖 Agent'}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <select
        value={filters.status || ''}
        onChange={(e) =>
          onChange({
            ...filters,
            status: (e.target.value as Task['status']) || null,
          })
        }
        className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All Statuses</option>
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      {/* Priority filter */}
      <select
        value={filters.priority || ''}
        onChange={(e) =>
          onChange({
            ...filters,
            priority: (e.target.value as Task['priority']) || null,
          })
        }
        className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All Priorities</option>
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      {/* Clear all */}
      {hasActiveFilters && (
        <button
          onClick={() =>
            onChange({ projectId: null, taskType: null, status: null, priority: null })
          }
          className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="size-3" />
          Clear
        </button>
      )}
    </div>
  );
}
