'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { ListTodo, Plus, RefreshCw, Bookmark } from 'lucide-react';
import { fetchTasks, createTask, updateTask } from '@/lib/api-tasks';
import type { Task } from '@/lib/api-tasks';
import { TaskFilters, type TaskFilterState } from './task-filters';
import { ProjectSection, TaskCard } from './task-card';
import { CreateTaskDialog, type CreateTaskData } from './create-task-dialog';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface GroupedTasks {
  projectId: string | null;
  projectName: string;
  humanTasks: Task[];
  agentTasks: Task[];
}

function groupTasksByProject(tasks: Task[]): GroupedTasks[] {
  const map = new Map<string | null, GroupedTasks>();

  for (const task of tasks) {
    const key = task.projectId;
    if (!map.has(key)) {
      map.set(key, {
        projectId: key,
        projectName: task.projectName || 'Unassigned',
        humanTasks: [],
        agentTasks: [],
      });
    }
    const group = map.get(key)!;
    if (task.taskType === 'agent') {
      group.agentTasks.push(task);
    } else {
      group.humanTasks.push(task);
    }
  }

  // Sort: projects first (alphabetically), then unassigned last
  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    if (a.projectId === null) return 1;
    if (b.projectId === null) return -1;
    return a.projectName.localeCompare(b.projectName);
  });

  return groups;
}

// ---------------------------------------------------------------------------
// TasksView
// ---------------------------------------------------------------------------

export function TasksView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filters, setFilters] = useState<TaskFilterState>({
    projectId: null,
    taskType: null,
    status: null,
    priority: null,
  });

  // Fetch tasks
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchTasks('ws-1', {
        projectId: filters.projectId || undefined,
        taskType: filters.taskType || undefined,
        status: filters.status || undefined,
        priority: filters.priority || undefined,
      });
      setTasks(result);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Task actions
  const handleStatusChange = useCallback(
    async (id: string, status: Task['status']) => {
      const updated = await updateTask(id, { status });
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
    },
    [],
  );

  const handleCreateTask = useCallback(
    async (data: CreateTaskData) => {
      const tagList = data.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const newTask = await createTask({
        workspaceId: 'ws-1',
        title: data.title,
        description: data.description,
        projectId: data.projectId,
        taskType: data.taskType,
        assigneeType: data.taskType,
        priority: data.priority,
        assignee: data.assignee || null,
        dueDate: data.dueDate || null,
        tags: tagList,
        createdBy: 'user',
      });
      setTasks((prev) => [newTask, ...prev]);
    },
    [],
  );

  // Grouped data
  const groups = useMemo(() => groupTasksByProject(tasks), [tasks]);

  // Stats
  const stats = useMemo(() => {
    const active = tasks.filter(
      (t) => t.status === 'in_progress' || t.status === 'pending',
    ).length;
    const humanCount = tasks.filter((t) => t.taskType === 'human').length;
    const agentCount = tasks.filter((t) => t.taskType === 'agent').length;
    return { active, humanCount, agentCount, total: tasks.length };
  }, [tasks]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ListTodo className="size-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Tasks</h2>
            {stats.total > 0 && (
              <span className="text-xs text-muted-foreground">
                {stats.active} active · {stats.humanCount} human · {stats.agentCount} agent
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={loadTasks}
              className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors"
              title="Refresh"
            >
              <RefreshCw className="size-3.5" />
            </button>
            <button
              onClick={() => setDialogOpen(true)}
              className="flex items-center gap-1 h-7 px-2.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus className="size-3.5" />
              New Task
            </button>
          </div>
        </div>

        {/* Filters */}
        <TaskFilters filters={filters} onChange={setFilters} />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="size-4 text-muted-foreground animate-spin" />
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-8">
            <ListTodo className="size-8 opacity-30" />
            <p className="text-sm">No tasks found</p>
            <p className="text-xs opacity-60">
              {filters.projectId || filters.taskType || filters.status || filters.priority
                ? 'Try adjusting your filters'
                : 'Click "New Task" to get started'}
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-4">
            {groups.map((group) => (
              <div key={group.projectId || '__unassigned'}>
                {group.projectId === null ? (
                  /* Unassigned section */
                  <div className="border border-border rounded-lg overflow-hidden bg-card">
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <Bookmark className="size-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        Unassigned
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {group.humanTasks.length + group.agentTasks.length}
                      </span>
                    </div>
                    <div className="divide-y divide-border border-t border-border">
                      {[...group.humanTasks, ...group.agentTasks].map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onStatusChange={handleStatusChange}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <ProjectSection
                    projectName={group.projectName}
                    humanTasks={group.humanTasks}
                    agentTasks={group.agentTasks}
                    onStatusChange={handleStatusChange}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      <CreateTaskDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleCreateTask}
      />
    </div>
  );
}
