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
  // --- Project: Mobile Redesign (Human Tasks) ---
  {
    id: 'task-mr-h1',
    workspaceId: 'ws-1',
    projectId: 'proj-mobile-redesign',
    projectName: 'Mobile Redesign',
    channelId: null,
    title: 'Design new onboarding flow wireframes',
    description:
      'Create low-fidelity wireframes for the 5-step onboarding experience targeting new users.',
    status: 'in_progress',
    priority: 'high',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Sarah Chen',
    parentId: null,
    tags: ['design', 'onboarding'],
    dueDate: '2026-06-03',
    startedAt: '2026-05-27T10:00:00Z',
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-25T08:00:00Z',
    updatedAt: '2026-05-28T14:30:00Z',
  },
  {
    id: 'task-mr-h2',
    workspaceId: 'ws-1',
    projectId: 'proj-mobile-redesign',
    projectName: 'Mobile Redesign',
    channelId: null,
    title: 'User testing session for navigation prototype',
    description:
      'Run 5 moderated user testing sessions with the new bottom navigation pattern.',
    status: 'pending',
    priority: 'medium',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Mike Ramirez',
    parentId: null,
    tags: ['research', 'usability'],
    dueDate: '2026-06-07',
    startedAt: null,
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-26T09:00:00Z',
    updatedAt: '2026-05-26T09:00:00Z',
  },
  {
    id: 'task-mr-h3',
    workspaceId: 'ws-1',
    projectId: 'proj-mobile-redesign',
    projectName: 'Mobile Redesign',
    channelId: null,
    title: 'Update design tokens for dark mode',
    description:
      'Align color tokens with new brand palette ensuring WCAG AA contrast in dark mode.',
    status: 'completed',
    priority: 'medium',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Sarah Chen',
    parentId: null,
    tags: ['design-system', 'accessibility'],
    dueDate: '2026-05-28',
    startedAt: '2026-05-24T08:00:00Z',
    completedAt: '2026-05-27T16:00:00Z',
    agentResult: null,
    agentConfidence: null,
    createdBy: 'sarah',
    createdAt: '2026-05-22T10:00:00Z',
    updatedAt: '2026-05-27T16:00:00Z',
  },
  {
    id: 'task-mr-h4',
    workspaceId: 'ws-1',
    projectId: 'proj-mobile-redesign',
    projectName: 'Mobile Redesign',
    channelId: null,
    title: 'Finalize app icon variants',
    description: 'Deliver 3 icon variants for A/B testing on app stores.',
    status: 'blocked',
    priority: 'low',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Lia Park',
    parentId: null,
    tags: ['branding'],
    dueDate: '2026-06-10',
    startedAt: null,
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-28T11:00:00Z',
    updatedAt: '2026-05-28T11:00:00Z',
  },
  // --- Project: Mobile Redesign (Agent Tasks) ---
  {
    id: 'task-mr-a1',
    workspaceId: 'ws-1',
    projectId: 'proj-mobile-redesign',
    projectName: 'Mobile Redesign',
    channelId: 'ch-design',
    title: 'Generate accessibility audit report',
    description:
      'Scan all screens for contrast, touch target, and screen reader issues.',
    status: 'completed',
    priority: 'high',
    taskType: 'agent',
    assigneeType: 'agent',
    assignee: 'auditor-bot',
    parentId: null,
    tags: ['accessibility', 'automated'],
    dueDate: null,
    startedAt: '2026-05-26T12:00:00Z',
    completedAt: '2026-05-26T12:04:30Z',
    agentResult: {
      summary: 'Found 12 contrast issues and 3 undersized touch targets across 8 screens.',
      issuesFound: 15,
      passRate: 0.82,
    },
    agentConfidence: 0.94,
    createdBy: 'tony',
    createdAt: '2026-05-26T11:55:00Z',
    updatedAt: '2026-05-26T12:04:30Z',
  },
  {
    id: 'task-mr-a2',
    workspaceId: 'ws-1',
    projectId: 'proj-mobile-redesign',
    projectName: 'Mobile Redesign',
    channelId: 'ch-design',
    title: 'Convert Figma screens to React Native components',
    description:
      'Auto-generate styled components from the approved Figma frames.',
    status: 'in_progress',
    priority: 'medium',
    taskType: 'agent',
    assigneeType: 'agent',
    assignee: 'codegen-agent',
    parentId: null,
    tags: ['codegen', 'react-native'],
    dueDate: null,
    startedAt: '2026-05-28T09:00:00Z',
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'sarah',
    createdAt: '2026-05-28T08:50:00Z',
    updatedAt: '2026-05-28T15:20:00Z',
  },
  {
    id: 'task-mr-a3',
    workspaceId: 'ws-1',
    projectId: 'proj-mobile-redesign',
    projectName: 'Mobile Redesign',
    channelId: 'ch-design',
    title: 'Localize strings for 4 new languages',
    description:
      'Translate all UI strings to Japanese, Korean, French, and Spanish.',
    status: 'pending',
    priority: 'low',
    taskType: 'agent',
    assigneeType: 'agent',
    assignee: 'translator-agent',
    parentId: null,
    tags: ['i18n', 'localization'],
    dueDate: '2026-06-12',
    startedAt: null,
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-29T07:00:00Z',
    updatedAt: '2026-05-29T07:00:00Z',
  },
  // --- Project: API Refactor (Human Tasks) ---
  {
    id: 'task-ar-h1',
    workspaceId: 'ws-1',
    projectId: 'proj-api-refactor',
    projectName: 'API Refactor',
    channelId: null,
    title: 'Define new REST endpoint contracts',
    description:
      'Write OpenAPI 3.1 specs for the v2 endpoints with pagination and filtering.',
    status: 'in_progress',
    priority: 'urgent',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'James Wu',
    parentId: null,
    tags: ['api', 'documentation'],
    dueDate: '2026-05-30',
    startedAt: '2026-05-27T08:00:00Z',
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'james',
    createdAt: '2026-05-25T14:00:00Z',
    updatedAt: '2026-05-29T10:00:00Z',
  },
  {
    id: 'task-ar-h2',
    workspaceId: 'ws-1',
    projectId: 'proj-api-refactor',
    projectName: 'API Refactor',
    channelId: null,
    title: 'Review breaking changes impact on clients',
    description:
      'Audit all 3rd-party integrations and document migration steps.',
    status: 'pending',
    priority: 'high',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Tony Ye',
    parentId: null,
    tags: ['review', 'migration'],
    dueDate: '2026-06-02',
    startedAt: null,
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-28T09:00:00Z',
    updatedAt: '2026-05-28T09:00:00Z',
  },
  // --- Project: API Refactor (Agent Tasks) ---
  {
    id: 'task-ar-a1',
    workspaceId: 'ws-1',
    projectId: 'proj-api-refactor',
    projectName: 'API Refactor',
    channelId: 'ch-backend',
    title: 'Auto-generate TypeScript SDK from OpenAPI spec',
    description:
      'Run openapi-generator against the new v2 spec and produce a typed client.',
    status: 'pending',
    priority: 'medium',
    taskType: 'agent',
    assigneeType: 'agent',
    assignee: 'codegen-agent',
    parentId: null,
    tags: ['codegen', 'sdk'],
    dueDate: null,
    startedAt: null,
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'james',
    createdAt: '2026-05-28T15:00:00Z',
    updatedAt: '2026-05-28T15:00:00Z',
  },
  {
    id: 'task-ar-a2',
    workspaceId: 'ws-1',
    projectId: 'proj-api-refactor',
    projectName: 'API Refactor',
    channelId: 'ch-backend',
    title: 'Run regression test suite against v2 branch',
    description: 'Execute full integration test suite and report failures.',
    status: 'completed',
    priority: 'high',
    taskType: 'agent',
    assigneeType: 'agent',
    assignee: 'test-runner',
    parentId: null,
    tags: ['testing', 'ci'],
    dueDate: null,
    startedAt: '2026-05-28T16:00:00Z',
    completedAt: '2026-05-28T16:12:00Z',
    agentResult: {
      summary: '142 tests passed, 3 failed (auth token refresh, rate limiting, pagination cursor).',
      totalTests: 145,
      passed: 142,
      failed: 3,
      failedTests: ['auth-token-refresh', 'rate-limiting-burst', 'pagination-cursor-edge'],
    },
    agentConfidence: 0.97,
    createdBy: 'james',
    createdAt: '2026-05-28T15:55:00Z',
    updatedAt: '2026-05-28T16:12:00Z',
  },
  // --- No Project (Unassigned) ---
  {
    id: 'task-misc-1',
    workspaceId: 'ws-1',
    projectId: null,
    projectName: undefined,
    channelId: null,
    title: 'Set up CI/CD pipeline for staging',
    description:
      'Configure GitHub Actions for auto-deploy to staging on merge to develop.',
    status: 'pending',
    priority: 'medium',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Tony Ye',
    parentId: null,
    tags: ['devops', 'ci'],
    dueDate: '2026-06-05',
    startedAt: null,
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-27T13:00:00Z',
    updatedAt: '2026-05-27T13:00:00Z',
  },
  {
    id: 'task-misc-2',
    workspaceId: 'ws-1',
    projectId: null,
    projectName: undefined,
    channelId: null,
    title: 'Weekly team standup notes',
    description: 'Document discussion topics and action items from Friday standup.',
    status: 'completed',
    priority: 'low',
    taskType: 'human',
    assigneeType: 'human',
    assignee: 'Mike Ramirez',
    parentId: null,
    tags: ['meetings'],
    dueDate: '2026-05-29',
    startedAt: '2026-05-29T09:00:00Z',
    completedAt: '2026-05-29T09:45:00Z',
    agentResult: null,
    agentConfidence: null,
    createdBy: 'mike',
    createdAt: '2026-05-29T08:00:00Z',
    updatedAt: '2026-05-29T09:45:00Z',
  },
  {
    id: 'task-misc-3',
    workspaceId: 'ws-1',
    projectId: null,
    projectName: undefined,
    channelId: 'ch-general',
    title: 'Summarize last week channel activity',
    description: 'Generate a digest of important discussions and decisions.',
    status: 'completed',
    priority: 'low',
    taskType: 'agent',
    assigneeType: 'agent',
    assignee: 'digest-bot',
    parentId: null,
    tags: ['summary', 'automated'],
    dueDate: null,
    startedAt: '2026-05-28T06:00:00Z',
    completedAt: '2026-05-28T06:02:00Z',
    agentResult: {
      summary: 'Generated weekly digest covering 47 messages across 3 channels. Key topics: API migration timeline, mobile beta launch date, new hire onboarding.',
      messagesProcessed: 47,
      channelsCovered: 3,
    },
    agentConfidence: 0.91,
    createdBy: 'system',
    createdAt: '2026-05-28T05:55:00Z',
    updatedAt: '2026-05-28T06:02:00Z',
  },
  {
    id: 'task-misc-4',
    workspaceId: 'ws-1',
    projectId: null,
    projectName: undefined,
    channelId: null,
    title: 'Upgrade dependencies to latest patch versions',
    description: 'Run npm audit fix and update minor/patch versions across workspace.',
    status: 'cancelled',
    priority: 'low',
    taskType: 'human',
    assigneeType: 'human',
    assignee: null,
    parentId: null,
    tags: ['maintenance'],
    dueDate: null,
    startedAt: null,
    completedAt: null,
    agentResult: null,
    agentConfidence: null,
    createdBy: 'tony',
    createdAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-25T10:00:00Z',
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
    { id: 'proj-mobile-redesign', name: 'Mobile Redesign' },
    { id: 'proj-api-refactor', name: 'API Refactor' },
  ];
}
