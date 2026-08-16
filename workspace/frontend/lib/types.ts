export interface Workspace {
  workspaceId: string;
  slug: string;
  name: string;
  creatorEmail: string | null;
  requireLogin: boolean;
  settings: Record<string, unknown>;
  browserfabricApiKey: string | null;
  status: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  agents: WorkspaceAgent[];
}

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TeamMember {
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
  joinedAt: string | null;
}

/** A pending/issued invitation link (admin view, GET /invites). The `url`
 * carries only the invite token — never the workspace machine token. */
export interface TeamInvite {
  inviteId: string;
  /** Bound address (lowercased), or null for an open shareable link. */
  email: string | null;
  role: WorkspaceRole;
  url: string;
  status: 'pending' | 'accepted' | 'expired' | 'revoked';
  createdBy: string | null;
  createdAt: string | null;
  expiresAt: string | null;
  acceptedBy: string | null;
}

/** The caller's identity + effective role in this workspace (GET /me).
 * `role` is the identity-based membership role (null for token-only or
 * anonymous access); `effectiveRole` folds in owner-equivalent machine/token
 * access and is what UI gating should use. */
export interface WorkspaceMe {
  email: string | null;
  displayName: string | null;
  authenticated: boolean;
  role: WorkspaceRole | null;
  tokenAccess: boolean;
  effectiveRole: WorkspaceRole | null;
}

/** An agent the daemon reports it is hosting on a node. */
export interface NodeAgent {
  name: string;
  type: string;
  status: string;
  model?: string | null;
  workingDir?: string | null;
}

/** Per-agent-type detection the daemon reports for a node. */
export interface NodeRuntime {
  type: string;
  installed: boolean;
  ready: boolean;
  version: string | null;
  reason: string | null;
  message: string | null;
  authStatus?: string | null;
}

/** A device running the launcher daemon, connected to the workspace. */
export interface WorkspaceNode {
  nodeId: string;
  name: string;
  hostname: string | null;
  deviceType: string;
  os: string | null;
  launcherVersion: string | null;
  status: string;
  agents: NodeAgent[];
  runtimes: NodeRuntime[];
  /** Filesystem hint for the working-directory picker (home + its subfolders). */
  fs?: { home?: string; dirs?: string[] } | null;
  lastHeartbeatAt: string | null;
  createdAt: string | null;
}

/** A queued remote agent-management command for a node. */
export interface NodeCommand {
  commandId: string;
  action: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result: { ok: boolean; message: string | null; data?: unknown } | null;
  agentName: string | null;
  createdAt: string | null;
  finishedAt: string | null;
}

/** A short-lived, single-use code the launcher redeems to connect a node. */
export interface PairingCode {
  code: string;
  expiresAt: string;
  expiresInSeconds: number;
}

/** A connected chat-platform bot (Slack app / Telegram bot) bridging
 * external conversations into workspace channels. */
export interface IntegrationBinding {
  id: string;
  platform: 'telegram' | 'slack';
  name: string | null;
  botTokenMasked: string | null;
  defaultAgent: string | null;
  config: Record<string, unknown>;
  status: 'active' | 'disabled';
  lastError: string | null;
  lastEventAt: string | null;
  createdAt: string | null;
  /** Slack only: the Events API request URL to paste into the Slack app. */
  slackEventsUrl: string | null;
}

export interface WorkspaceAgent {
  agentName: string;
  role: string;
  agentType: string | null;
  serverHost: string | null;
  workingDir: string | null;
  description: string | null;
  // Workspace modules map to booleans; `installed` is a string[] of skill ids;
  // `skill_status` maps skill id → install status. Hence the union value type.
  enabledSkills: Record<string, unknown> | null;
  status: string;
  lastHeartbeatAt: string | null;
  joinedAt: string | null;
  /** True only for the built-in Yumi assistant; false/absent for all others. */
  builtin?: boolean;
}

/** Per-skill install status stored under enabledSkills.skill_status[skillId]. */
export type SkillState = 'installing' | 'installed' | 'failed' | 'uninstalled';
export interface SkillStatusEntry {
  state: SkillState;
  updated_at?: number;
  path?: string;
  error?: string;
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  source_repo: string;
  source_path: string;
  author: string;
}

/**
 * A workspace-scoped custom skill: a user-uploaded .md/.zip package registered
 * in Workspace.settings["custom_skills"]. Camel-cased from the backend snake
 * shape by mapCustomSkill() in api.ts.
 */
export interface WorkspaceCustomSkill {
  id: string;
  name: string;
  description?: string;
  category: 'custom';
  tags?: string[];
  author?: string;
  sourceType: 'workspace_file';
  fileId: string;
  filename: string;
  contentType?: string;
  packageType: 'md' | 'zip';
  createdAt?: string;
}

export interface WorkspaceSession {
  sessionId: string;
  workspaceId: string;
  createdBy: string | null;
  title: string;
  status: string;
  starred: boolean;
  participants: string[];
  master: string | null;
  // Multi-agent collaboration mode: 'dynamic' | 'master' | 'workflow'
  orchestrationMode: string;
  // Legacy free-text collaboration plan (superseded by structured workflows)
  orchestrationInstruction: string | null;
  // Structured workflow driving this thread (when orchestrationMode === 'workflow')
  workflowId: string | null;
  createdAt: string | null;
  lastEventAt: number | null; // unix ms timestamp of last message
}

export interface WorkspaceMessage {
  messageId: string;
  sessionId: string;
  senderId?: string | null;
  senderType: string;
  senderName: string;
  content: string;
  mentions: string[];
  targetAgents: string[] | null;
  messageType: string;
  metadata: Record<string, unknown>;
  createdAt: string | null;
}

export interface WorkspaceIdentity {
  id: string;
  name: string;
  isAuthenticated: boolean;
}

export interface OnlineUser {
  id: string;
  name: string;
  status: 'online';
  lastSeen: number;
}

export interface WorkspaceCollaborator {
  email: string;
  role: 'editor' | 'viewer';
  addedBy: string | null;
  addedAt: string | null;
}

export interface WorkspaceInvitation {
  invitationId: string;
  workspaceId: string;
  targetAgentName: string;
  inviteToken: string;
  workspaceName?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: string;
  expiresAt: string;
}

export interface WorkspaceFile {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  channelName: string | null;
  status: string;
  createdAt: string | null;
}

/** A file held by a trash entry — a preview of what a restore brings back. */
export interface TrashFile {
  id: string;
  filename: string;
  name: string;
  size: number;
  contentType: string;
  kind: string;
}

/**
 * One delete action, as the trash lists it back.
 *
 * A folder that went in with twelve files is a single entry, not twelve rows:
 * restoring is the same gesture deleting was. `files` previews the first few of
 * them; `fileCount` is how many there really are.
 */
export interface TrashEntry {
  /** What restore and purge address — not a file id. */
  trashId: string;
  kind: 'file' | 'folder';
  /** Where it lived: the folder's path, or the deleted file's own path. */
  path: string;
  name: string;
  /** Null for records deleted before the trash existed — nothing recorded when. */
  deletedAt: string | null;
  fileCount: number;
  size: number;
  files: TrashFile[];
}

export interface KnowledgeEntry {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  contentSize: number | null;
  createdBy: string;
  updatedBy: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string | null;
  status: string;
  createdBy: string;
  sharedWith: string[];
  liveUrl: string | null;
  sessionId: string | null;
  contextId: string | null;
  createdAt: string | null;
  lastActiveAt: string | null;
}

export interface BrowserPersistentContext {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  createdBy: string;
  sharedWith: string[];
  createdAt: string | null;
  lastUsedAt: string | null;
}

// ---------------------------------------------------------------------------
// Shared conversation snapshots
// ---------------------------------------------------------------------------

export interface SharedSnapshotMessage {
  sender_name: string;
  sender_type: string;
  content: string;
  created_at: string | null;
}

export interface SharedSnapshot {
  id: string;
  title: string | null;
  messages: SharedSnapshotMessage[];
  messageCount: number;
  createdAt: string | null;
}

export interface ShareSummary {
  id: string;
  workspaceId: string;
  channelName: string;
  title: string | null;
  shareToken: string;
  messageCount: number;
  status: string;
  createdAt: string | null;
}

// ---------------------------------------------------------------------------
// Todos / Tasks (agent planning)
// ---------------------------------------------------------------------------

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  assignee: string;
  createdBy: string;
  channelName: string;
  threadId: string | null;
  position: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TimerItem {
  id: string;
  message: string;
  delaySeconds: number;
  firesAt: string;
  status: string;
  createdBy: string;
  channelName: string;
  createdAt: string | null;
}

export interface RoutineItem {
  id: string;
  name: string;
  message: string;
  context: string | null;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleDays: number[] | null;
  scheduleIntervalMinutes: number | null;
  timezone: string;
  nextFiresAt: string;
  lastFiredAt: string | null;
  status: string;
  createdBy: string;
  channelName: string;
  createdAt: string | null;
}

// ---------------------------------------------------------------------------
// Kanban board tasks (workspace-wide, GitHub-issue-like)
// ---------------------------------------------------------------------------

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'need_input' | 'done';

/** Live summary of a task's workflow run (which step, who's on it). */
export interface TaskRunInfo {
  status: 'running' | 'paused' | 'done' | 'stalled' | 'cancelled';
  stepIndex: number;            // -1 when done/cancelled
  stepCount: number;
  stepName: string | null;
  stepAssignee: string | null;
  stepAssigneeKind: 'agent' | 'human' | null;
  iterations: number;
  maxIterations: number;
}

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignee: string | null;      // bare agent name; null = unassigned
  workflowId: string | null;    // run via a workflow instead of a single agent
  createdBy: string;
  channelName: string | null;   // the hidden `task:<id>` working thread, once assigned
  position: number;
  /** Present on workflow tasks with a run — drives the card's progress line. */
  run: TaskRunInfo | null;
  /** Latest chat message in the thread; populated for need_input cards. */
  lastMessage: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Workflows — reusable multi-agent collaboration templates
// ---------------------------------------------------------------------------

export interface WorkflowStepAssignee {
  kind: 'agent' | 'human';
  agent?: string | null;
  human?: string | null;
}

/** "go to `target` step if `condition`" — target can point back (loop) or forward (skip). */
export interface WorkflowStepGate {
  condition: string;
  target: string;   // a step id
}

export interface WorkflowStep {
  id: string;
  name: string;
  instruction: string;
  assignee: WorkflowStepAssignee;
  gate?: WorkflowStepGate;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  maxIterations: number;
  createdBy: string;
  createdAt: string | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Inbox / Notifications
// ---------------------------------------------------------------------------

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  priority: 'low' | 'normal' | 'high';
  isRead: boolean;
  createdBy: string;
  channelName: string | null;
  threadId: string | null;
  linkUrl: string | null;
  status: string;
  createdAt: string | null;
  readAt: string | null;
}

// ---------------------------------------------------------------------------
// Agent catalog (supported client types)
// ---------------------------------------------------------------------------

export interface AgentCatalogEntry {
  name: string;
  label: string;
  description: string;
  install_command: string;
  homepage: string;
  tags: string[];
  builtin: boolean;
  featured?: boolean;
  order?: number;
  logo?: { key?: string; url?: string } | null;
}

/** One selectable model for an agent type, resolved server-side. */
export interface AgentCatalogModel {
  id: string;
  label: string;
  category?: string;
}

/** Full per-type detail from GET /v1/agent-catalog/{type}. */
export interface AgentCatalogDetail extends AgentCatalogEntry {
  models: AgentCatalogModel[];
  install?: Record<string, string>;
  uninstall?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Cloud agents
// ---------------------------------------------------------------------------

export interface CloudAgentProvider {
  name: string;
  label: string;
  models: CloudAgentModel[];
}

export interface CloudAgentModel {
  id: string;
  category: 'chat' | 'image' | 'audio';
  label: string;
}

export interface CloudAgentConfig {
  agentName: string;
  provider: string;
  model: string;
  category: 'chat' | 'image' | 'audio';
  apiKeyMasked: string;
  baseUrl: string | null;
  systemPrompt: string | null;
  maxTokens: number | null;
  status: string;
  createdAt: string | null;
}

// ---------------------------------------------------------------------------
// ONM Event types (event-native API)
// ---------------------------------------------------------------------------

export interface ONMEvent {
  id: string;
  type: string;
  source: string;
  target: string;
  payload: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  timestamp: number;
  visibility: string;
}

export interface EventPollResponse {
  events: ONMEvent[];
  has_more: boolean;
  oldest_id: string | null;
  newest_id: string | null;
}

export interface NetworkAgent {
  address: string;
  role: string;
  status: string;
  agent_type: string | null;
  server_host: string | null;
  working_dir: string | null;
  description: string | null;
  enabled_skills: Record<string, unknown> | null;
  last_heartbeat_at: string | null;
  joined_at: string | null;
  /** True only for the built-in Yumi assistant; false/absent for all others. */
  builtin?: boolean;
}

export interface NetworkChannel {
  address: string;
  title: string | null;
  master: string | null;
  orchestration_mode?: string;
  orchestration_instruction?: string | null;
  workflow_id?: string | null;
  participants: string[];
  created_at: number | null;
  last_event_at: number | null;
  status: string;
  starred: boolean;
}

export interface NetworkDiscovery {
  agents: NetworkAgent[];
  channels: NetworkChannel[];
  mods: string[];
  resources: string[];
}

export interface NetworkProfile {
  id: string;
  slug: string;
  name: string;
  access: { policy: string; min_verification: number };
  status: string;
  capabilities: string[];
  agents_online: number;
}

// ---------------------------------------------------------------------------
// API response wrappers
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface PaginationMeta {
  page: number;
  page_size: number;
  total: number | null;
  total_pages: number | null;
  has_next: boolean;
  has_prev: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface MessagePollResponse {
  messages: WorkspaceMessage[];
  hasMore: boolean;
}

export interface DMConversation {
  agents: [string, string];
  lastMessage: { content: string; sender: string; timestamp: number };
  messageCount: number;
}

// ---------------------------------------------------------------------------
// Converters — map ONM types to component-friendly types
// ---------------------------------------------------------------------------

/** Convert an ONM event to a WorkspaceMessage for the chat UI. */
export function eventToMessage(event: ONMEvent): WorkspaceMessage {
  const isHuman = event.source.startsWith('human:');
  const payload = (event.payload || {}) as Record<string, unknown>;
  const senderName = (payload.sender_name as string) || event.source.replace(/^(openagents:|human:)/, '');

  return {
    messageId: event.id,
    senderId: (payload.sender_id as string) || null,
    sessionId: event.target.replace(/^channel\//, ''),
    senderType: isHuman ? 'human' : 'agent',
    senderName,
    content: (payload.content as string) || '',
    mentions: (payload.mentions as string[]) || [],
    targetAgents: (event.metadata?.target_agents as string[]) || null,
    messageType: (payload.message_type as string) || 'chat',
    metadata: {
      ...(event.metadata || {}),
      ...(payload.attachments ? { attachments: payload.attachments } : {}),
      ...(payload.todos ? { todos: payload.todos } : {}),
    },
    createdAt: new Date(event.timestamp).toISOString(),
  };
}

/** Convert a NetworkAgent from discover to a WorkspaceAgent. */
export function networkAgentToWorkspaceAgent(agent: NetworkAgent): WorkspaceAgent {
  return {
    agentName: agent.address.replace(/^openagents:/, ''),
    role: agent.role,
    agentType: agent.agent_type || null,
    serverHost: agent.server_host || null,
    workingDir: agent.working_dir || null,
    description: agent.description || null,
    enabledSkills: agent.enabled_skills || null,
    status: agent.status,
    lastHeartbeatAt: agent.last_heartbeat_at || null,
    joinedAt: agent.joined_at || null,
    builtin: agent.builtin ?? false,
  };
}

/** Convert a NetworkChannel from discover to a WorkspaceSession for the thread UI. */
export function networkChannelToSession(ch: NetworkChannel, workspaceId: string): WorkspaceSession {
  const name = ch.address.replace(/^channel\//, '');
  return {
    sessionId: name,
    workspaceId,
    createdBy: null,
    title: ch.title || name,
    status: ch.status || 'active',
    starred: ch.starred || false,
    participants: ch.participants,
    master: ch.master,
    orchestrationMode: ch.orchestration_mode || 'dynamic',
    orchestrationInstruction: ch.orchestration_instruction ?? null,
    workflowId: ch.workflow_id ?? null,
    createdAt: ch.created_at ? new Date(ch.created_at).toISOString() : null,
    lastEventAt: ch.last_event_at,
  };
}
