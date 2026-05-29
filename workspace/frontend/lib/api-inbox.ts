export interface InboxItem {
  id: string;
  workspaceId: string;
  sourceType: 'task' | 'routine' | 'system' | 'agent';
  sourceId: string | null;
  title: string;
  message: string;
  priority: 'low' | 'normal' | 'high';
  category: 'info' | 'success' | 'warning' | 'error' | 'action_required';
  isRead: boolean;
  isDismissed: boolean;
  actionUrl: string | null;
  actionLabel: string | null;
  agentName: string | null;
  channelId: string | null;
  projectId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type InboxSourceFilter = 'all' | 'task' | 'routine' | 'agent' | 'system';
export type InboxPriorityFilter = 'all' | 'high' | 'normal' | 'low';

// ---------------------------------------------------------------------------
// Category display info
// ---------------------------------------------------------------------------

export const CATEGORY_ICONS: Record<InboxItem['category'], string> = {
  success: '✅',
  warning: '⚠️',
  error: '❌',
  info: 'ℹ️',
  action_required: '🔔',
};

export const SOURCE_TYPE_LABELS: Record<InboxItem['sourceType'], string> = {
  task: 'Tasks',
  routine: 'Routines',
  agent: 'Agents',
  system: 'System',
};

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const now = Date.now();

export const MOCK_INBOX_ITEMS: InboxItem[] = [
  // From tasks
  {
    id: 'inbox-001',
    workspaceId: 'ws-demo',
    sourceType: 'task',
    sourceId: 'task-042',
    title: 'API docs generated',
    message: 'The OpenAPI documentation for v2 endpoints has been generated and saved to Knowledge base.',
    priority: 'normal',
    category: 'success',
    isRead: false,
    isDismissed: false,
    actionUrl: null,
    actionLabel: 'View Task',
    agentName: 'docs-agent',
    channelId: 'engineering',
    projectId: 'proj-001',
    metadata: { taskId: 'task-042', completedAt: new Date(now - 1800000).toISOString() },
    createdAt: new Date(now - 1800000).toISOString(),
  },
  {
    id: 'inbox-002',
    workspaceId: 'ws-demo',
    sourceType: 'task',
    sourceId: 'task-038',
    title: 'Unit test failed - needs review',
    message: 'Test suite for auth module failed: 2 assertions broken after latest refactor. Requires manual review.',
    priority: 'high',
    category: 'warning',
    isRead: false,
    isDismissed: false,
    actionUrl: null,
    actionLabel: 'View Task',
    agentName: 'test-runner',
    channelId: 'engineering',
    projectId: 'proj-001',
    metadata: { taskId: 'task-038', failedTests: 2, totalTests: 47 },
    createdAt: new Date(now - 3600000).toISOString(),
  },
  {
    id: 'inbox-003',
    workspaceId: 'ws-demo',
    sourceType: 'task',
    sourceId: 'task-045',
    title: 'Design review completed',
    message: 'Mobile navigation redesign approved with minor feedback. Ready for implementation.',
    priority: 'normal',
    category: 'success',
    isRead: true,
    isDismissed: false,
    actionUrl: null,
    actionLabel: 'View Task',
    agentName: 'design-agent',
    channelId: 'design',
    projectId: 'proj-001',
    metadata: { taskId: 'task-045', approvedBy: 'design-agent' },
    createdAt: new Date(now - 7200000).toISOString(),
  },
  // From routines
  {
    id: 'inbox-004',
    workspaceId: 'ws-demo',
    sourceType: 'routine',
    sourceId: 'routine-v2-001',
    title: 'Daily summary ready',
    message: '23 messages summarized across 4 channels. 2 key decisions recorded, 3 action items flagged.',
    priority: 'low',
    category: 'info',
    isRead: false,
    isDismissed: false,
    actionUrl: null,
    actionLabel: 'View Routine',
    agentName: 'coordinator',
    channelId: 'daily-digest',
    projectId: null,
    metadata: { routineId: 'routine-v2-001', messagesProcessed: 23 },
    createdAt: new Date(now - 3600000).toISOString(),
  },
  {
    id: 'inbox-005',
    workspaceId: 'ws-demo',
    sourceType: 'routine',
    sourceId: 'routine-v2-002',
    title: '3 new todos synced',
    message: 'Synced 3 new action items from conversations. 1 item marked overdue.',
    priority: 'normal',
    category: 'info',
    isRead: false,
    isDismissed: false,
    actionUrl: null,
    actionLabel: 'View Routine',
    agentName: 'task-manager',
    channelId: null,
    projectId: null,
    metadata: { routineId: 'routine-v2-002', newTodos: 3, overdue: 1 },
    createdAt: new Date(now - 10800000).toISOString(),
  },
  {
    id: 'inbox-006',
    workspaceId: 'ws-demo',
    sourceType: 'routine',
    sourceId: 'routine-v2-003',
    title: 'Standup report generated',
    message: 'Morning standup: 4 items completed yesterday, 2 planned today, 1 blocker identified.',
    priority: 'low',
    category: 'success',
    isRead: true,
    isDismissed: false,
    actionUrl: null,
    actionLabel: 'View Routine',
    agentName: 'coordinator',
    channelId: 'standup',
    projectId: 'proj-001',
    metadata: { routineId: 'routine-v2-003' },
    createdAt: new Date(now - 21600000).toISOString(),
  },
  // From agents
  {
    id: 'inbox-007',
    workspaceId: 'ws-demo',
    sourceType: 'agent',
    sourceId: null,
    title: 'design-agent completed task',
    message: 'Finished generating component variants for the new dashboard layout. 6 variants ready for review.',
    priority: 'normal',
    category: 'success',
    isRead: false,
    isDismissed: false,
    actionUrl: null,
    actionLabel: null,
    agentName: 'design-agent',
    channelId: 'design',
    projectId: 'proj-001',
    metadata: { variants: 6, component: 'DashboardLayout' },
    createdAt: new Date(now - 5400000).toISOString(),
  },
  {
    id: 'inbox-008',
    workspaceId: 'ws-demo',
    sourceType: 'agent',
    sourceId: null,
    title: 'frontend-dev needs input',
    message: 'Encountered ambiguity in the API response format for paginated lists. Need clarification on cursor vs offset pagination.',
    priority: 'high',
    category: 'action_required',
    isRead: false,
    isDismissed: false,
    actionUrl: null,
    actionLabel: null,
    agentName: 'frontend-dev',
    channelId: 'engineering',
    projectId: 'proj-001',
    metadata: { question: 'cursor vs offset pagination for /api/v2/items' },
    createdAt: new Date(now - 2700000).toISOString(),
  },
  // From system
  {
    id: 'inbox-009',
    workspaceId: 'ws-demo',
    sourceType: 'system',
    sourceId: null,
    title: 'New member joined workspace',
    message: 'research-agent has joined the workspace and is ready to accept tasks.',
    priority: 'low',
    category: 'info',
    isRead: true,
    isDismissed: false,
    actionUrl: null,
    actionLabel: null,
    agentName: null,
    channelId: null,
    projectId: null,
    metadata: { memberName: 'research-agent', memberType: 'agent' },
    createdAt: new Date(now - 43200000).toISOString(),
  },
  {
    id: 'inbox-010',
    workspaceId: 'ws-demo',
    sourceType: 'system',
    sourceId: null,
    title: 'Knowledge base updated',
    message: '3 new entries added to Knowledge base: "Auth Migration Plan", "API Versioning Strategy", "Component Library Standards".',
    priority: 'normal',
    category: 'info',
    isRead: true,
    isDismissed: false,
    actionUrl: null,
    actionLabel: null,
    agentName: null,
    channelId: null,
    projectId: null,
    metadata: { entriesAdded: 3 },
    createdAt: new Date(now - 86400000).toISOString(),
  },
  {
    id: 'inbox-011',
    workspaceId: 'ws-demo',
    sourceType: 'agent',
    sourceId: null,
    title: 'research-agent found 5 relevant papers',
    message: 'Completed literature search on "multi-agent orchestration patterns". 5 papers matched criteria, summaries available.',
    priority: 'low',
    category: 'success',
    isRead: true,
    isDismissed: false,
    actionUrl: null,
    actionLabel: null,
    agentName: 'research-agent',
    channelId: 'research',
    projectId: null,
    metadata: { papersFound: 5, query: 'multi-agent orchestration patterns' },
    createdAt: new Date(now - 54000000).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Filter options (for InboxFilters component)
// ---------------------------------------------------------------------------

export const SOURCE_FILTER_OPTIONS: { value: InboxSourceFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'task', label: 'Tasks' },
  { value: 'routine', label: 'Routines' },
  { value: 'agent', label: 'Agents' },
  { value: 'system', label: 'System' },
];

export const PRIORITY_FILTER_OPTIONS: { value: InboxPriorityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

// ---------------------------------------------------------------------------
// API helpers (mock)
// ---------------------------------------------------------------------------

export async function fetchInboxItems(_workspaceId: string): Promise<InboxItem[]> {
  // In production, this would query the inbox_items table via Supabase
  return MOCK_INBOX_ITEMS.filter((item) => !item.isDismissed);
}

export function getUnreadCount(items: InboxItem[]): number {
  return items.filter((item) => !item.isRead).length;
}

export function getActionRequiredCount(items: InboxItem[]): number {
  return items.filter((item) => item.category === 'action_required' && !item.isRead).length;
}

export function filterBySource(items: InboxItem[], source: InboxSourceFilter): InboxItem[] {
  if (source === 'all') return items;
  return items.filter((item) => item.sourceType === source);
}

export function filterByPriority(items: InboxItem[], priority: InboxPriorityFilter): InboxItem[] {
  if (priority === 'all') return items;
  return items.filter((item) => item.priority === priority);
}
