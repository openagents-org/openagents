export interface Workspace {
  workspaceId: string;
  slug: string;
  name: string;
  creatorEmail: string | null;
  settings: Record<string, unknown>;
  status: string;
  createdAt: string | null;
  lastActivityAt: string | null;
  agents: WorkspaceAgent[];
}

export interface WorkspaceAgent {
  agentName: string;
  role: string;
  agentType: string | null;
  serverHost: string | null;
  workingDir: string | null;
  description: string | null;
  enabledSkills: Record<string, boolean> | null;
  status: string;
  lastHeartbeatAt: string | null;
  joinedAt: string | null;
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  module_key: string | null;
  default_enabled: boolean;
  toggleable: boolean;
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
  enabled_skills: Record<string, boolean> | null;
  last_heartbeat_at: string | null;
  joined_at: string | null;
}

export interface NetworkChannel {
  address: string;
  title: string | null;
  master: string | null;
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
    createdAt: ch.created_at ? new Date(ch.created_at).toISOString() : null,
    lastEventAt: ch.last_event_at,
  };
}
