export interface RoutineV2 {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  routineType: 'daily_summary' | 'todo_sync' | 'standup' | 'weekly_review' | 'custom';
  message: string;
  context: string | null;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleDays: number[];
  scheduleIntervalMinutes: number | null;
  status: 'active' | 'paused' | 'cancelled';
  lastOutput: Record<string, unknown> | null;
  outputChannel: string | null;
  createdBy: string;
  lastFiredAt: string | null;
  nextFiresAt: string;
  createdAt: string;
}

export interface RoutineTemplate {
  id: string;
  name: string;
  routineType: RoutineV2['routineType'];
  description: string;
  message: string;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleDays: number[];
  icon: string;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const ROUTINE_TEMPLATES: RoutineTemplate[] = [
  {
    id: 'tpl-daily-summary',
    name: 'Daily Summary',
    routineType: 'daily_summary',
    description: 'Summarize all channel messages at end of day',
    message: 'Summarize today\'s messages across all active channels. Highlight key decisions, action items, and unresolved questions.',
    scheduleHour: 23,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    icon: '📋',
  },
  {
    id: 'tpl-todo-sync',
    name: 'Todo Sync',
    routineType: 'todo_sync',
    description: 'Sync pending items to task board every morning',
    message: 'Check all channels for pending action items and sync them to the task board. Flag overdue items.',
    scheduleHour: 9,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    icon: '📌',
  },
  {
    id: 'tpl-standup',
    name: 'Standup Report',
    routineType: 'standup',
    description: 'Generate a standup report every weekday morning',
    message: 'Generate a standup report: what was done yesterday, what\'s planned today, and any blockers across all active threads.',
    scheduleHour: 9,
    scheduleMinute: 30,
    scheduleDays: [0, 1, 2, 3, 4],
    icon: '🎯',
  },
  {
    id: 'tpl-weekly-review',
    name: 'Weekly Review',
    routineType: 'weekly_review',
    description: 'Extract key decisions and learnings to Knowledge every Friday',
    message: 'Review this week\'s conversations. Extract key decisions, new learnings, and important context. Save to Knowledge base.',
    scheduleHour: 18,
    scheduleMinute: 0,
    scheduleDays: [4],
    icon: '📚',
  },
];

// ---------------------------------------------------------------------------
// Mock Data
// ---------------------------------------------------------------------------

const now = Date.now();
const oneHourAgo = new Date(now - 3600000).toISOString();
const threeHoursAgo = new Date(now - 3600000 * 3).toISOString();
const sixHoursAgo = new Date(now - 3600000 * 6).toISOString();
const oneDayAgo = new Date(now - 86400000).toISOString();

export const MOCK_ROUTINES_V2: RoutineV2[] = [
  {
    id: 'routine-v2-001',
    workspaceId: 'ws-demo',
    projectId: null,
    name: 'Daily Chat Summary',
    routineType: 'daily_summary',
    message: 'Summarize today\'s messages across all active channels. Highlight key decisions, action items, and unresolved questions.',
    context: 'Focus on #general, #engineering, #design, and #product channels',
    scheduleHour: 23,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    scheduleIntervalMinutes: null,
    status: 'active',
    lastOutput: {
      summary: 'Today: 23 messages across 4 channels. Key decisions: migrated auth to Supabase, approved new landing page design. Action items: @tony to review PR #142, @design-agent to prepare mobile mockups.',
      itemsProcessed: 23,
      channelsScanned: 4,
      duration: '2.3s',
      status: 'success',
    },
    outputChannel: 'daily-digest',
    createdBy: 'openagents:coordinator',
    lastFiredAt: oneHourAgo,
    nextFiresAt: new Date(now + 82800000).toISOString(),
    createdAt: new Date(now - 86400000 * 7).toISOString(),
  },
  {
    id: 'routine-v2-002',
    workspaceId: 'ws-demo',
    projectId: null,
    name: 'Todo Sync',
    routineType: 'todo_sync',
    message: 'Check all channels for pending action items and sync them to the task board. Flag overdue items.',
    context: null,
    scheduleHour: 9,
    scheduleMinute: 0,
    scheduleDays: [0, 1, 2, 3, 4, 5, 6],
    scheduleIntervalMinutes: null,
    status: 'active',
    lastOutput: {
      summary: 'Synced 3 new todos from conversations. 1 item marked overdue (API docs from 2 days ago).',
      itemsProcessed: 3,
      newItems: 3,
      overdueItems: 1,
      duration: '1.1s',
      status: 'success',
    },
    outputChannel: null,
    createdBy: 'openagents:task-manager',
    lastFiredAt: threeHoursAgo,
    nextFiresAt: new Date(now + 64800000).toISOString(),
    createdAt: new Date(now - 86400000 * 5).toISOString(),
  },
  {
    id: 'routine-v2-003',
    workspaceId: 'ws-demo',
    projectId: 'proj-001',
    name: 'Morning Standup',
    routineType: 'standup',
    message: 'Generate a standup report: what was done yesterday, what\'s planned today, and any blockers across all active threads.',
    context: 'Include progress from #frontend, #backend, and #infrastructure',
    scheduleHour: 9,
    scheduleMinute: 30,
    scheduleDays: [0, 1, 2, 3, 4],
    scheduleIntervalMinutes: null,
    status: 'active',
    lastOutput: {
      summary: 'Yesterday: completed auth flow, fixed 3 bugs. Today: inbox redesign, API rate limiting. Blockers: waiting on design review for mobile nav.',
      completedYesterday: 4,
      plannedToday: 2,
      blockers: 1,
      duration: '1.8s',
      status: 'success',
    },
    outputChannel: 'standup',
    createdBy: 'openagents:coordinator',
    lastFiredAt: sixHoursAgo,
    nextFiresAt: new Date(now + 57600000).toISOString(),
    createdAt: new Date(now - 86400000 * 14).toISOString(),
  },
  {
    id: 'routine-v2-004',
    workspaceId: 'ws-demo',
    projectId: null,
    name: 'Weekly Knowledge Update',
    routineType: 'weekly_review',
    message: 'Review this week\'s conversations. Extract key decisions, new learnings, and important context. Save to Knowledge base.',
    context: 'Prioritize architecture decisions and API changes',
    scheduleHour: 18,
    scheduleMinute: 0,
    scheduleDays: [4],
    scheduleIntervalMinutes: null,
    status: 'active',
    lastOutput: {
      summary: 'Extracted 5 decisions and 3 learnings. Added entries: "Auth Migration Plan", "API Versioning Strategy", "Component Library Standards".',
      decisionsExtracted: 5,
      learningsExtracted: 3,
      knowledgeEntriesCreated: 3,
      duration: '4.7s',
      status: 'success',
    },
    outputChannel: null,
    createdBy: 'openagents:knowledge-curator',
    lastFiredAt: oneDayAgo,
    nextFiresAt: new Date(now + 86400000 * 3).toISOString(),
    createdAt: new Date(now - 86400000 * 21).toISOString(),
  },
];

// ---------------------------------------------------------------------------
// Type icon mapping
// ---------------------------------------------------------------------------

export const ROUTINE_TYPE_ICONS: Record<RoutineV2['routineType'], string> = {
  daily_summary: '📋',
  todo_sync: '📌',
  standup: '🎯',
  weekly_review: '📚',
  custom: '⚡',
};

export const ROUTINE_TYPE_LABELS: Record<RoutineV2['routineType'], string> = {
  daily_summary: 'Daily Summary',
  todo_sync: 'Todo Sync',
  standup: 'Standup',
  weekly_review: 'Weekly Review',
  custom: 'Custom',
};

// ---------------------------------------------------------------------------
// API helpers (mock)
// ---------------------------------------------------------------------------

export async function fetchRoutinesV2(_workspaceId: string): Promise<RoutineV2[]> {
  // In production, this would query the routines_v2 table via Supabase
  return MOCK_ROUTINES_V2.filter((r) => r.status === 'active');
}

export async function createRoutineFromTemplate(
  _workspaceId: string,
  _template: RoutineTemplate,
  _createdBy: string,
): Promise<RoutineV2> {
  // Mock: return a new routine based on the template
  const id = `routine-v2-${Date.now()}`;
  return {
    id,
    workspaceId: _workspaceId,
    projectId: null,
    name: _template.name,
    routineType: _template.routineType,
    message: _template.message,
    context: null,
    scheduleHour: _template.scheduleHour,
    scheduleMinute: _template.scheduleMinute,
    scheduleDays: _template.scheduleDays,
    scheduleIntervalMinutes: null,
    status: 'active',
    lastOutput: null,
    outputChannel: null,
    createdBy: _createdBy,
    lastFiredAt: null,
    nextFiresAt: new Date(Date.now() + 86400000).toISOString(),
    createdAt: new Date().toISOString(),
  };
}
