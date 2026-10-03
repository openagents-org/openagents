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
  avatarUrl: string | null;
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
  /** Label set by the user, in any script; `name` stays the identity. */
  displayName?: string | null;
  type: string;
  status: string;
  model?: string | null;
  workingDir?: string | null;
  /** Masked API key (e.g. "sk-1...cdef") when one is configured on the node; the full secret never leaves the device. */
  apiKeyMasked?: string | null;
  /** Hostname of the endpoint the agent is configured to call. Null or absent:
   * its CLI's default, or a launcher too old to report it. */
  baseUrlHost?: string | null;
  /** Last smoke-test result for THIS agent (probes are per agent, run after
   * create/reconfigure and hourly by the daemon). */
  probe?: NodeProbe | null;
}

/** Last smoke-test result the daemon reported for an agent type: one tiny
 * end-to-end "hi" prompt, with classified guidance when it failed. */
export interface NodeProbe {
  ok: boolean;
  at: string;
  code?: string | null;
  method?: string | null;
  message?: string | null;
  reply?: string | null;
  guidance?: string[];
  durationMs?: number;
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
  probe?: NodeProbe | null;
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
  /** Filesystem hint for the working-directory picker (home, subfolders, roots/drives). */
  fs?: { home?: string; dirs?: string[]; roots?: string[] } | null;
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
  platform: 'telegram' | 'slack' | 'lark';
  name: string | null;
  botTokenMasked: string | null;
  defaultAgent: string | null;
  config: Record<string, unknown>;
  status: 'active' | 'disabled';
  lastError: string | null;
  lastEventAt: string | null;
  createdAt: string | null;
  /** Custom Slack apps only: the Events API request URL to paste into the app. */
  slackEventsUrl: string | null;
  /** Lark/Feishu only: the event-subscription request URL to paste into the app. */
  larkEventsUrl: string | null;
}

export interface WorkspaceAgent {
  agentName: string;
  /** User-set label (any script, incl. CJK). Falls back to agentName when null. */
  displayName: string | null;
  role: string;
  agentType: string | null;
  serverHost: string | null;
  /** Device (node) the agent runs on; null for cloud agents. */
  nodeId?: string | null;
  workingDir: string | null;
  description: string | null;
  // Workspace modules map to booleans; `installed` is a string[] of skill ids;
  // `skill_status` maps skill id → install status. Hence the union value type.
  enabledSkills: Record<string, unknown> | null;
  /** User-picked model id; null = the agent's own default. */
  model: string | null;
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
  /** Permission model v1.1 — "human:<email>" | "openagents:<agent>" | null (legacy rows). */
  owner: string | null;
  ownerLabel: string | null;
  /** null = inherits from the thread the file is attached to. */
  visibility: ArtifactVisibility | null;
  /** What the backend resolved the null case to; null when unknown. */
  effectiveVisibility: ArtifactVisibility | null;
  /** Caller may change visibility / share (owner, admin, or share right). */
  canManage: boolean;
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
  /** Permission model v1.1 — "human:<email>" | "openagents:<agent>" | null (legacy rows). */
  owner: string | null;
  ownerLabel: string | null;
  /** Knowledge has no thread to inherit from; null only for legacy rows. */
  visibility: ArtifactVisibility | null;
  effectiveVisibility: ArtifactVisibility | null;
  canManage: boolean;
}

/**
 * The two kinds of shared-browser tab. A *permanent* tab is backed by a saved
 * BrowserFabric context: its login state survives, it stays in the tab strip
 * while its session sleeps, and it counts against the persistent quota. A
 * *temporary* tab is a plain session: it counts against the (smaller)
 * temporary quota and is closed by the backend after a period of inactivity.
 */
export type BrowserTabKind = 'permanent' | 'temporary';

/** What an agent last did in a tab — a short-lived signal (seconds), not history. */
export interface BrowserTabActivity {
  action: string;
  actor: string;
  at: string;
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
  contextName: string | null;
  kind: BrowserTabKind;
  activity: BrowserTabActivity | null;
  createdAt: string | null;
  lastActiveAt: string | null;
}

/** Per-kind live-tab quota, as enforced by BrowserFabric for the workspace's key. */
export interface BrowserTabLimits {
  permanent: { used: number; max: number };
  temporary: { used: number; max: number };
  /** Temporary tabs idle for this long are closed by the backend sweeper. */
  temporaryIdleMinutes: number;
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
  /** Knowledge-base entries attached as context; kickoff cites them as @knowledge:<slug>. */
  knowledgeIds: string[];
  /** Workspace files attached; delivered as attachments on the kickoff. */
  fileIds: string[];
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
  /** One shared-knowledge entry attached as this step's context (wire-format
   * key — steps are stored verbatim; delivered as @knowledge:<slug>). */
  knowledge_id?: string;
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

// ---------------------------------------------------------------------------
// Approvals — agents act, humans approve where it matters
// ---------------------------------------------------------------------------

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type ApprovalKind =
  | 'deploy' | 'spend' | 'external_send' | 'repo_read' | 'repo_write' | 'data_delete' | 'shell' | 'other';
/** Who may resolve a paused request. `any` = any human member (not viewers). */
export type ApprovalRequiredRole = 'any' | 'admin' | 'owner';
/** Card class of a request (v1.1 escalation rides on the approvals table). */
export type ApprovalKindClass = 'approval' | 'help' | 'proposal';
/** What policy says about an action kind. */
export type ApprovalPolicyVerdict = 'allow' | 'any' | 'admin' | 'owner' | 'block';

export interface ApprovalRequest {
  id: string;
  channelName: string;
  requestedBy: string;            // bare agent name
  kind: ApprovalKind | string;
  /** What the card renders as: policy kinds collapse to `approval`;
   * `help` = a question for the owner, `proposal` = a shared-instructions change. */
  kindClass: ApprovalKindClass;
  action: string;
  /** For `help`: the question (the backend stores it in `action`). */
  question: string | null;
  details: string | null;
  risk: 'low' | 'medium' | 'high' | null;
  requiredRole: ApprovalRequiredRole;
  /** The person this is addressed to (help/proposal default to the agent's owner). */
  assigneeEmail: string | null;
  /** The requesting agent's owner, if any. */
  ownerEmail: string | null;
  /** The teammate whose message the agent was handling — only in the thread snapshot. */
  requesterEmail: string | null;
  status: ApprovalStatus;
  /** Approver email, "token" (legacy open workspace), or "policy" (auto). */
  resolvedBy: string | null;
  resolvedByRole: string | null;
  resolvedAt: string | null;
  note: string | null;
  requestEventId: string | null;
  resolutionEventId: string | null;
  createdAt: string | null;
}

export interface ApprovalPolicyRule {
  kind: ApprovalKind | string;
  label: string;
  policy: ApprovalPolicyVerdict;
  /** Where the verdict comes from: built-in default, workspace row, or channel row. */
  source: 'default' | 'workspace' | 'channel';
}

export interface ApprovalPolicy {
  scope: string;                   // "*" = workspace default, else a channel name
  rules: ApprovalPolicyRule[];
  workspaceRules: { kind: string; policy: ApprovalPolicyVerdict }[];
  channelRules: { kind: string; policy: ApprovalPolicyVerdict }[];
  policies: ApprovalPolicyVerdict[];
}

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
  /** What the row is about (approval | help | proposal | ...); null = plain notice. */
  kind: string | null;
  /** Id of the thing to act on (e.g. an approval id) — makes the row actionable. */
  actionRef: string | null;
  /** Who it is addressed to; null = the whole workspace. */
  recipientEmail: string | null;
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
  /** Marketplace metadata from the registry (e.g. "Anthropic", "Open source"). */
  vendor?: string;
  /** Short marketing line shown in the featured spotlight. */
  tagline?: string;
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
  /** Provider the model list comes from when the registry references one
   * (claude → anthropic); null for a list the agent's own vendor curates. */
  models_provider?: string | null;
  /** The adapter applies a model picked in the workspace (WorkspaceMember.model). */
  workspace_model?: boolean | null;
  install?: Record<string, string>;
  uninstall?: Record<string, string>;
  /** Generic LLM_* → provider-var mapping; present for bring-your-own-provider agents. */
  resolve_env?: { rules?: { from: string; to: string }[] } | null;
  /** The agent's own settings, as the registry declares them. */
  env_config?: { name: string; description?: string; required?: boolean; password?: boolean; placeholder?: string }[] | null;
  /** Wire protocol the agent's CLI speaks: 'anthropic' (Claude family) or OpenAI-compatible (default). */
  protocol?: string;
  /**
   * Agent only accepts its own vendor's account/key (e.g. Cursor). Provider or
   * relay keys from Model access can never drive it, so the BYOK picker is
   * suppressed even though resolve_env rules exist.
   */
  provider_locked?: boolean | null;
  /** Readiness metadata; login_command is the CLI sign-in to run on the device. */
  check_ready?: { login_command?: string } | null;
}

// ---------------------------------------------------------------------------
// Cloud agents
// ---------------------------------------------------------------------------

export interface CloudAgentProvider {
  name: string;
  label: string;
  /** OpenAI-compatible endpoint, or null for the provider's SDK default. */
  base_url?: string | null;
  models: CloudAgentModel[];
}

/** A saved inference credential (provider + key), managed in settings. */
export interface ModelAccessEntry {
  id: string;
  label: string;
  provider: string;
  baseUrl: string | null;
  apiKeyMasked: string;
  createdBy: string | null;
  status: string;
  createdAt: string | null;
}

/** Result of POST /v1/model-probe — list mode or validate mode. */
export interface ModelProbeResult {
  // list mode
  models?: CloudAgentModel[];
  source?: 'live' | 'catalog';
  keyOk?: boolean | null;
  // validate mode
  ok?: boolean;
  latencyMs?: number;
  reply?: string;
  // both
  error?: string;
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
  /** Server-managed built-in (Yumi): model + credentials are fixed by the server. */
  managed?: boolean;
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
  display_name?: string | null;
  role: string;
  status: string;
  agent_type: string | null;
  server_host: string | null;
  /** Device (node) the agent runs on; null for cloud agents. */
  node_id?: string | null;
  working_dir: string | null;
  description: string | null;
  enabled_skills: Record<string, unknown> | null;
  /** User-picked model id; null = the agent's own default. */
  model?: string | null;
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
      // Approval request / resolution — the chat renders a card from this.
      ...(payload.approval ? { approval: payload.approval } : {}),
    },
    createdAt: new Date(event.timestamp).toISOString(),
  };
}

/** Convert a NetworkAgent from discover to a WorkspaceAgent. */
export function networkAgentToWorkspaceAgent(agent: NetworkAgent): WorkspaceAgent {
  return {
    agentName: agent.address.replace(/^openagents:/, ''),
    displayName: agent.display_name || null,
    role: agent.role,
    agentType: agent.agent_type || null,
    serverHost: agent.server_host || null,
    nodeId: agent.node_id || null,
    workingDir: agent.working_dir || null,
    description: agent.description || null,
    enabledSkills: agent.enabled_skills || null,
    model: agent.model || null,
    status: agent.status,
    lastHeartbeatAt: agent.last_heartbeat_at || null,
    joinedAt: agent.joined_at || null,
    builtin: agent.builtin ?? false,
    ...collabAgentFields(agent),  // v1.1 M1: ownership / visibility / runtime
  };
}

/** Human-readable default for an untitled thread. Falling back to the raw
 * channel name ("channel-abc1234") reads as noise — describe the thread by
 * who is in it instead. */
function defaultSessionTitle(participants: string[]): string {
  const agents = (participants || []).filter((p) => p && p !== '__no_response__');
  if (agents.length === 0) return 'New Thread';
  if (agents.length === 1) return `New Thread with ${agents[0]}`;
  return `New Thread with ${agents[0]} +${agents.length - 1}`;
}

/** Convert a NetworkChannel from discover to a WorkspaceSession for the thread UI. */
export function networkChannelToSession(ch: NetworkChannel, workspaceId: string): WorkspaceSession {
  const name = ch.address.replace(/^channel\//, '');
  return {
    sessionId: name,
    workspaceId,
    createdBy: null,
    title: ch.title || defaultSessionTitle(ch.participants),
    status: ch.status || 'active',
    starred: ch.starred || false,
    participants: ch.participants,
    master: ch.master,
    orchestrationMode: ch.orchestration_mode || 'dynamic',
    orchestrationInstruction: ch.orchestration_instruction ?? null,
    workflowId: ch.workflow_id ?? null,
    createdAt: ch.created_at ? new Date(ch.created_at).toISOString() : null,
    lastEventAt: ch.last_event_at,
    ...collabChannelFields(ch),  // v1.1 M1: thread visibility / director
    ...accessChannelFields(ch),  // v1.1 permission model: owner / participants-can-invite
  };
}

// ── v1.1 M5 ── thread brief + inline artifacts
/** The persistent shared work brief of a thread (GET/PUT /v1/channels/{channel}/brief). */
export interface ChannelBrief {
  channel: string;
  objective: string | null;
  /** "openagents:<agent>" or "human:<email>" — who owns the next step. */
  owner: string | null;
  latestResult: string | null;
  openQuestions: string[];
  nextStep: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** Who directs the thread (Channel.director_email); null when undirected. */
  directorEmail: string | null;
  /** Whether the caller may edit (machine, admin+, or thread participant). */
  canEdit: boolean;
}

export type ChannelBriefPatch = Partial<
  Pick<ChannelBrief, 'objective' | 'owner' | 'latestResult' | 'nextStep' | 'openQuestions'>
>;
// ── v1.1 M1/M2 — ownership, visibility, sharing ──────────────────────────────
// Roadmap v1.1 "mixed human–agent collaboration". The wire shapes below extend
// the existing discover/session/agent records by interface merging so the
// additions stay grouped here; the two mappers above spread
// `collabAgentFields` / `collabChannelFields` to carry them across.

export type AgentVisibility = 'team' | 'personal';
/** 'public' is what the permission-model API outputs; 'workspace' is the legacy alias (read as public). */
export type ChannelVisibility = 'workspace' | 'private' | 'public';
/** Whose credits a shared request burns. Null = not declared (treated as owner). */
export type CostOwner = 'owner' | 'workspace' | 'requester';
/** Derived from the agent's node: null for cloud agents / unknown. */
export type AgentRuntimeStatus = 'online' | 'offline' | null;

export interface NetworkAgent {
  owner_email?: string | null;
  visibility?: AgentVisibility;
  purpose?: string | null;
  example_requests?: string[];
  required_inputs?: string | null;
  cost_owner?: CostOwner | null;
  presence_state?: string | null;
  busy_channels?: string[];
  queue_depth?: number;
  runtime_status?: AgentRuntimeStatus;
  runtime_name?: string | null;
}

export interface NetworkChannel {
  visibility?: ChannelVisibility;
  director_email?: string | null;
  created_by?: string | null;
}

export interface WorkspaceAgent {
  ownerEmail?: string | null;
  visibility?: AgentVisibility;
  purpose?: string | null;
  exampleRequests?: string[];
  requiredInputs?: string | null;
  costOwner?: CostOwner | null;
  presenceState?: string | null;
  busyChannels?: string[];
  queueDepth?: number;
  runtimeStatus?: AgentRuntimeStatus;
  runtimeName?: string | null;
}

export interface WorkspaceSession {
  visibility?: ChannelVisibility;
  directorEmail?: string | null;
  createdByEmail?: string | null;
}

export function collabAgentFields(agent: NetworkAgent): Pick<WorkspaceAgent,
  'ownerEmail' | 'visibility' | 'purpose' | 'exampleRequests' | 'requiredInputs' | 'costOwner'
  | 'presenceState' | 'busyChannels' | 'queueDepth' | 'runtimeStatus' | 'runtimeName'> {
  return {
    ownerEmail: agent.owner_email ?? null,
    visibility: agent.visibility === 'personal' ? 'personal' : 'team',
    purpose: agent.purpose ?? null,
    exampleRequests: agent.example_requests ?? [],
    requiredInputs: agent.required_inputs ?? null,
    costOwner: agent.cost_owner ?? null,
    presenceState: agent.presence_state ?? null,
    busyChannels: agent.busy_channels ?? [],
    queueDepth: agent.queue_depth ?? 0,
    runtimeStatus: agent.runtime_status ?? null,
    runtimeName: agent.runtime_name ?? null,
  };
}

export function collabChannelFields(ch: NetworkChannel): Pick<WorkspaceSession, 'visibility' | 'directorEmail' | 'createdByEmail'> {
  return {
    visibility: ch.visibility === 'private' ? 'private' : 'workspace',
    directorEmail: ch.director_email ?? null,
    createdByEmail: ch.created_by ?? null,
  };
}

/** GET /v1/channels/{channel}/participants */
export interface ChannelParticipants {
  channel: string;
  visibility: ChannelVisibility;
  director_email: string | null;
  humans: { email: string; display_name: string | null; joined_at: string | null }[];
  agents: { agent_name: string; display_name: string | null; owner_email: string | null; visibility: AgentVisibility }[];
}

/** POST /v1/channels/{channel}/participants — either joined right away or
 * (not a workspace member yet) an invite link to hand over. */
export type ParticipantAddResult =
  | { added: true; email: string }
  | { added: false; invited: true; invite_token: string; invite_url: string };

/** GET /v1/channels/{channel}/share-preview — exactly what becomes visible. */
export interface SharePreview {
  channel: string;
  title: string | null;
  visibility: ChannelVisibility;
  director_email: string | null;
  humans: string[];
  agents: string[];
  message_count: number;
  files: { id: string; filename: string }[];
  knowledge_refs: string[];
  snapshot_available: boolean;
}

/** One card in GET /v1/agents/directory. */
export interface AgentDirectoryEntry {
  agent_name: string;
  display_name: string | null;
  agent_type: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  visibility: AgentVisibility;
  purpose: string | null;
  example_requests: string[];
  required_inputs: string | null;
  cost_owner: CostOwner | null;
  status: string;
  presence_state: string | null;
  busy_channels: string[];
  queue_depth: number;
  runtime_status: AgentRuntimeStatus;
  runtime_name: string | null;
  pinned: boolean;
  grant_count: number;
  can_manage: boolean;
  my_recent_requests: { channel: string; title: string | null; last_event_at: number | string | null }[];
  /** Permission model v1.1 — who holds an `act` grant. Missing on older backends. */
  usable_by?: AgentUsableBy | null;
}

export interface AgentGrant {
  email: string;
  display_name: string | null;
  granted_by: string | null;
  note: string | null;
  created_at: string | null;
}

export type AgentGrantResult =
  | { granted: true }
  | { granted: false; invited: true; invite_url: string };

/** Editable profile fields (PATCH members). Owner/admin — or a member claiming
 * an unowned agent by setting owner_email to themselves. */
export interface AgentProfileUpdate {
  owner_email?: string;
  visibility?: AgentVisibility;
  purpose?: string;
  example_requests?: string[];
  required_inputs?: string;
  shared_instructions?: string;
  allowed_knowledge?: string[];
  cost_owner?: CostOwner;
}

export type InviteTargetKind = 'agent' | 'channel' | 'task';

// ── v1.1 permission model — security groups, grants, thread access ───────────
// Spec: workspace/docs/permission-model-v1.md §4/§5. Wire shapes are snake_case
// exactly as the API returns them; only the session mapper camel-cases.

export type GranteeKind = 'human' | 'agent' | 'group';

/** A principal picked in the GranteePicker: a person (id = email), an agent
 * (id = agent_name) or a security group (id = group id). */
export interface Grantee {
  kind: GranteeKind;
  id: string;
  label: string;
}

export type SecurityGroupKind = 'everyone' | 'guest' | 'custom';

/** GET /v1/groups */
export interface SecurityGroup {
  id: string;
  name: string;
  slug: string;
  kind: SecurityGroupKind;
  /** Derived for the builtin groups (everyone = all collaborators, guest = guests). */
  member_count: number;
  builtin: boolean;
  created_by?: string | null;
  created_at?: string | null;
}

export type GroupPrincipalKind = 'human' | 'agent';

/** GET /v1/groups/{id}/members */
export interface GroupMember {
  principal_kind: GroupPrincipalKind;
  /** lowercase email | agent_name */
  principal_id: string;
  display_name: string | null;
  added_by: string | null;
  created_at: string | null;
}

/** DELETE /v1/groups/{id}?dry_run=1 */
export interface GroupDeleteImpact {
  affected_grants: number;
  members: number;
}

export type ResourceKind = 'channel' | 'agent' | 'file' | 'knowledge' | 'browser_context';
export type GrantRight = 'read' | 'act' | 'share';

/** GET /v1/grants */
export interface ResourceGrant {
  id: string;
  resource_kind: ResourceKind;
  resource_id: string;
  grantee_kind: GranteeKind;
  grantee_id: string;
  /** Display name resolved server-side (person / agent / group name). */
  grantee_label: string | null;
  rights: GrantRight[];
  scope: Record<string, unknown> | null;
  expires_at: string | null;
  budget: number | null;
  granted_by: string | null;
  note: string | null;
  created_at: string | null;
}

/** POST /v1/grants body (network added by the api wrapper). */
export interface GrantCreateInput {
  resource_kind: ResourceKind;
  resource_id: string;
  grantee_kind: GranteeKind;
  grantee_id: string;
  rights?: GrantRight[];
  scope?: Record<string, unknown>;
  /** ISO-8601; agent grants may expire. */
  expires_at?: string;
  budget?: number;
  note?: string;
}

/** GET /v1/grants/preview — what becomes accessible if the grant is made. */
export interface GrantPreviewItem {
  kind: string;
  id: string;
  title: string;
}

export interface GrantPreview {
  items: GrantPreviewItem[];
}

export type AccessReason =
  | 'owner' | 'public' | 'participant' | 'grant' | `group:${string}`
  | 'inherited_from_owner' | 'inherited_from_channel' | 'admin_metadata' | 'machine' | 'denied';

/** GET /v1/access/explain — "why can I see this?" for the caller. */
export interface AccessExplanation {
  allowed: boolean;
  reason: AccessReason;
  text: string;
}

/** GET /v1/admin/private-threads — metadata only, never content. */
export interface PrivateThreadMeta {
  name: string;
  title: string | null;
  owner_email: string | null;
  participant_count: number;
  message_count: number;
  last_activity_at: string | null;
}

/** PATCH /v1/channels/{name} — the owner-facing access fields. */
export interface ChannelAccessUpdate {
  visibility?: 'private' | 'public';
  participantsCanInvite?: boolean;
  /** Hand over (owner) or force a transfer (admin). */
  ownerEmail?: string;
}

// The thread records gain an owner and the participants-can-invite switch.
// Interface merging keeps the additions grouped here; the session mapper
// spreads `accessChannelFields` to carry them across.
export interface NetworkChannel {
  owner_email?: string | null;
  participants_can_invite?: boolean;
}

export interface WorkspaceSession {
  ownerEmail?: string | null;
  participantsCanInvite?: boolean;
}

export interface ChannelParticipants {
  owner_email?: string | null;
  participants_can_invite?: boolean;
}

export function accessChannelFields(ch: NetworkChannel): Pick<WorkspaceSession, 'ownerEmail' | 'participantsCanInvite'> {
  return {
    ownerEmail: ch.owner_email ?? null,
    participantsCanInvite: !!ch.participants_can_invite,
  };
}

// ── v1.1 M4 — specialist profile (GET /v1/agents/{agent}/profile) ────────────
// Owners/admins get the full shared instruction set and knowledge list;
// teammates get a summary (first SUMMARY_CHARS) and a count.
export interface AgentProfileView {
  agent_name: string;
  display_name: string | null;
  agent_type: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  visibility: AgentVisibility;
  purpose: string | null;
  example_requests: string[];
  required_inputs: string | null;
  cost_owner: CostOwner | null;
  grant_count: number;
  availability: Record<string, unknown>;
  can_manage: boolean;
  /** can_manage view only */
  shared_instructions?: string | null;
  allowed_knowledge?: { slug: string; title: string }[];
  /** teammate view only */
  shared_instructions_summary?: string | null;
  allowed_knowledge_count?: number;
}

// ---------------------------------------------------------------------------
// Permission model v1.1 — artifact access (files, knowledge) and agent usability
// ---------------------------------------------------------------------------

/** Two levels only. Files additionally allow `null` = inherit from the thread. */
export type ArtifactVisibility = 'private' | 'public';

/** `usable_by` on a directory entry: everyone switch + grant tallies. */
export interface AgentUsableBy {
  everyone: boolean;
  groups: { id: string; name: string }[];
  people: number;
  agents: number;
}
