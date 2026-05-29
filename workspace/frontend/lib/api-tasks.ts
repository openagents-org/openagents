import { supabase } from './supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string | null;
  projectName?: string;
  channelId: string | null;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  taskType: 'human' | 'agent';
  assigneeType: 'human' | 'agent';
  assignee: string | null;
  parentId: string | null;
  children?: Task[];
  tags: string[];
  dueDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  agentResult: Record<string, unknown> | null;
  agentConfidence: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskFilters {
  projectId?: string;
  status?: Task['status'];
  taskType?: Task['taskType'];
  assignee?: string;
  priority?: Task['priority'];
}

export interface TaskAnnotation {
  id: string;
  content: string;
  author: string;
  createdAt: string;
  resolved?: boolean;
}

// ---------------------------------------------------------------------------
// Supabase row → Task mapper
// ---------------------------------------------------------------------------

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    projectId: (row.project_id as string) || null,
    projectName: (row.project_name as string) || undefined,
    channelId: (row.channel_id as string) || null,
    title: row.title as string,
    description: (row.description as string) || '',
    status: row.status as Task['status'],
    priority: row.priority as Task['priority'],
    taskType: row.task_type as Task['taskType'],
    assigneeType: row.assignee_type as Task['assigneeType'],
    assignee: (row.assignee as string) || null,
    parentId: (row.parent_id as string) || null,
    tags: (row.tags as string[]) || [],
    dueDate: (row.due_date as string) || null,
    startedAt: (row.started_at as string) || null,
    completedAt: (row.completed_at as string) || null,
    agentResult: (row.agent_result as Record<string, unknown>) || null,
    agentConfidence: (row.agent_confidence as number) || null,
    createdBy: (row.created_by as string) || 'unknown',
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CRUD functions
// ---------------------------------------------------------------------------

export async function fetchTasks(
  workspaceId: string,
  filters?: TaskFilters,
): Promise<Task[]> {
  try {
    let query = supabase
      .from('tasks')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('position', { ascending: true });

    if (filters?.projectId) {
      query = query.eq('project_id', filters.projectId);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.taskType) {
      query = query.eq('task_type', filters.taskType);
    }
    if (filters?.assignee) {
      query = query.eq('assignee', filters.assignee);
    }
    if (filters?.priority) {
      query = query.eq('priority', filters.priority);
    }

    const { data, error } = await query;

    if (error) throw error;
    if (!data || data.length === 0) throw new Error('empty');

    return data.map((row) => rowToTask(row as Record<string, unknown>));
  } catch {
    // Fallback to mock data
    return filterMockTasks(workspaceId, filters);
  }
}

export async function createTask(task: Partial<Task>): Promise<Task> {
  try {
    const payload = {
      workspace_id: task.workspaceId,
      project_id: task.projectId || null,
      channel_id: task.channelId || null,
      title: task.title,
      description: task.description || '',
      status: task.status || 'pending',
      priority: task.priority || 'medium',
      task_type: task.taskType || 'human',
      assignee_type: task.assigneeType || 'human',
      assignee: task.assignee || null,
      parent_id: task.parentId || null,
      tags: task.tags || [],
      due_date: task.dueDate || null,
      created_by: task.createdBy || 'unknown',
    };

    const { data, error } = await supabase
      .from('tasks')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return rowToTask(data as Record<string, unknown>);
  } catch {
    // Mock: return a fake created task
    const newTask: Task = {
      id: `task-${Date.now()}`,
      workspaceId: task.workspaceId || 'ws-1',
      projectId: task.projectId || null,
      channelId: task.channelId || null,
      title: task.title || 'New Task',
      description: task.description || '',
      status: task.status || 'pending',
      priority: task.priority || 'medium',
      taskType: task.taskType || 'human',
      assigneeType: task.assigneeType || 'human',
      assignee: task.assignee || null,
      parentId: task.parentId || null,
      tags: task.tags || [],
      dueDate: task.dueDate || null,
      startedAt: null,
      completedAt: null,
      agentResult: null,
      agentConfidence: null,
      createdBy: task.createdBy || 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return newTask;
  }
}

export async function updateTask(
  id: string,
  updates: Partial<Task>,
): Promise<Task> {
  try {
    const payload: Record<string, unknown> = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.description !== undefined)
      payload.description = updates.description;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.priority !== undefined) payload.priority = updates.priority;
    if (updates.taskType !== undefined) payload.task_type = updates.taskType;
    if (updates.assigneeType !== undefined)
      payload.assignee_type = updates.assigneeType;
    if (updates.assignee !== undefined) payload.assignee = updates.assignee;
    if (updates.projectId !== undefined) payload.project_id = updates.projectId;
    if (updates.tags !== undefined) payload.tags = updates.tags;
    if (updates.dueDate !== undefined) payload.due_date = updates.dueDate;
    payload.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('tasks')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return rowToTask(data as Record<string, unknown>);
  } catch {
    // Mock: return task with updates applied
    const base = MOCK_TASKS.find((t) => t.id === id) || MOCK_TASKS[0];
    return { ...base, ...updates, updatedAt: new Date().toISOString() };
  }
}

export async function deleteTask(id: string): Promise<void> {
  try {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    if (error) throw error;
  } catch {
    // Mock: no-op
  }
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_TASKS: Task[] = [
  {
    id: 'task-1',
    workspaceId: 'ws-1',
    projectId: 'proj-openagents',
    projectName: 'OpenAgents Workspace',
    channelId: null,
    title: '完成知识库模块的树形结构交互优化',
    description:
      '当前知识库树形展开/折叠的动画不够流畅，且拖拽排序时偶发节点错位问题，需要排查并修复。同时补充空状态引导文案。',
    status: 'in_progress',
    priority: 'high',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Tony Ye',
    parentId: null,
    tags: ['前端', '交互优化'],
    dueDate: '2026-06-02',
    startedAt: '2026-05-28T09:00:00Z',
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-27T10:00:00Z',
    updatedAt: '2026-05-29T11:30:00Z',
  },
  {
    id: 'task-2',
    workspaceId: 'ws-1',
    projectId: 'proj-openagents',
    projectName: 'OpenAgents Workspace',
    channelId: 'ch-dev',
    title: '自动生成 SkillHub API 接口文档摘要',
    description:
      '基于 SkillHub API Reference 原始 Markdown 文件，自动提取各接口的请求参数、响应结构和错误码，生成结构化摘要卡片。',
    status: 'completed',
    priority: 'medium',
    taskType: 'agent',
    assigneeType: 'agent',
    assignee: 'doc-agent',
    parentId: null,
    tags: ['文档', '自动化'],
    dueDate: null,
    startedAt: '2026-05-28T14:00:00Z',
    completedAt: '2026-05-28T14:03:20Z',
    agentResult: {
      summary: '已从 SkillHub API Reference 中提取 12 个接口摘要，覆盖技能查询、调用、管理三大模块，共生成 12 张结构化卡片。',
      endpointsProcessed: 12,
      modulesConvered: 3,
    },
    agentConfidence: 0.95,
    createdBy: 'tony',
    createdAt: '2026-05-28T13:50:00Z',
    updatedAt: '2026-05-28T14:03:20Z',
  },
  {
    id: 'task-3',
    workspaceId: 'ws-1',
    projectId: null,
    projectName: undefined,
    channelId: null,
    title: '梳理下周迭代优先级并更新看板',
    description:
      '汇总本周各模块进展，与设计、后端对齐下周 Sprint 目标，将确认后的任务录入看板并分配负责人。',
    status: 'pending',
    priority: 'medium',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Tony Ye',
    parentId: null,
    tags: ['项目管理'],
    dueDate: '2026-06-01',
    startedAt: null,
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-29T08:00:00Z',
    updatedAt: '2026-05-29T08:00:00Z',
  },
];

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function filterMockTasks(
  _workspaceId: string,
  filters?: TaskFilters,
): Task[] {
  let result = [...MOCK_TASKS];

  if (filters?.projectId) {
    result = result.filter((t) => t.projectId === filters.projectId);
  }
  if (filters?.status) {
    result = result.filter((t) => t.status === filters.status);
  }
  if (filters?.taskType) {
    result = result.filter((t) => t.taskType === filters.taskType);
  }
  if (filters?.assignee) {
    result = result.filter((t) => t.assignee === filters.assignee);
  }
  if (filters?.priority) {
    result = result.filter((t) => t.priority === filters.priority);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Project list helper (derived from mock data)
// ---------------------------------------------------------------------------

export interface ProjectOption {
  id: string;
  name: string;
}

export function getProjectOptions(): ProjectOption[] {
  return [
    { id: 'proj-openagents', name: 'OpenAgents Workspace' },
  ];
}

// ---------------------------------------------------------------------------
// Annotation CRUD
// ---------------------------------------------------------------------------

export async function addAnnotation(
  taskId: string,
  annotation: Omit<TaskAnnotation, 'id' | 'createdAt'>,
): Promise<Task> {
  const newAnnotation: TaskAnnotation = {
    id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content: annotation.content,
    author: annotation.author,
    createdAt: new Date().toISOString(),
    resolved: annotation.resolved ?? false,
  };

  // Get current task and add annotation to agentResult.annotations
  const existingTask = MOCK_TASKS.find((t) => t.id === taskId);
  const currentResult = (existingTask?.agentResult || {}) as Record<string, unknown>;
  const existingAnnotations = (currentResult.annotations as TaskAnnotation[]) || [];

  const updatedResult = {
    ...currentResult,
    annotations: [...existingAnnotations, newAnnotation],
  };

  return updateTask(taskId, { agentResult: updatedResult });
}

export async function resolveAnnotation(
  taskId: string,
  annotationId: string,
): Promise<Task> {
  const existingTask = MOCK_TASKS.find((t) => t.id === taskId);
  const currentResult = (existingTask?.agentResult || {}) as Record<string, unknown>;
  const existingAnnotations = (currentResult.annotations as TaskAnnotation[]) || [];

  const updatedAnnotations = existingAnnotations.map((ann) =>
    ann.id === annotationId ? { ...ann, resolved: true } : ann,
  );

  const updatedResult = {
    ...currentResult,
    annotations: updatedAnnotations,
  };

  return updateTask(taskId, { agentResult: updatedResult });
}
