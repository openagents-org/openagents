import type {
  AgentCatalogEntry,
  ApiResponse,
  BrowserPersistentContext,
  BrowserTab,
  DMConversation,
  EventPollResponse,
  MessagePollResponse,
  NetworkDiscovery,
  NetworkProfile,
  ONMEvent,
  TimerItem,
  TodoItem,
  Workspace,
  WorkspaceAgent,
  WorkspaceCollaborator,
  WorkspaceFile,
  WorkspaceInvitation,
  WorkspaceSession,
} from './types';
import { eventToMessage } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';

/** Map snake_case file response from backend to camelCase WorkspaceFile. */
function mapFileResponse(raw: Record<string, unknown>): WorkspaceFile {
  return {
    id: raw.id as string,
    filename: raw.filename as string,
    contentType: (raw.content_type || raw.contentType || 'application/octet-stream') as string,
    size: raw.size as number,
    uploadedBy: (raw.uploaded_by || raw.uploadedBy || 'unknown') as string,
    channelName: (raw.channel_name ?? raw.channelName ?? null) as string | null,
    status: (raw.status || 'active') as string,
    createdAt: (raw.created_at || raw.createdAt || null) as string | null,
  };
}

class WorkspaceApi {
  private token: string = '';
  private bearerToken: string = '';
  private workspaceId: string = '';

  configure(workspaceId: string, token: string, bearerToken?: string) {
    this.workspaceId = workspaceId;
    this.token = token;
    if (bearerToken !== undefined) this.bearerToken = bearerToken;
  }

  setBearerToken(bearerToken: string) {
    this.bearerToken = bearerToken;
  }

  getSSEUrl(channelName: string): string {
    const params = new URLSearchParams({
      network: this.workspaceId,
      channel: channelName,
    });
    if (this.token) params.set('token', this.token);
    return `${API_URL}/v1/events/stream?${params}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const authHeaders: Record<string, string> = {};
    if (this.token) {
      authHeaders['X-Workspace-Token'] = this.token;
    }
    if (this.bearerToken) {
      authHeaders['Authorization'] = `Bearer ${this.bearerToken}`;
    }

    const url = `${API_URL}${path}`;
    const res = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }

    const json: ApiResponse<T> = await res.json();
    return json.data;
  }

  // ---------------------------------------------------------------------------
  // Workspace CRUD (REST endpoints — not event-based)
  // ---------------------------------------------------------------------------

  async getWorkspace(): Promise<Workspace> {
    return this.request<Workspace>(`/v1/workspaces/${this.workspaceId}`);
  }

  async updateWorkspace(updates: {
    name?: string;
    settings?: Record<string, unknown>;
    /**
     * Typed top-level flip — backend merges this into `settings`
     * without trampling other keys. Use this instead of round-tripping
     * the whole settings dict to flip one bool.
     */
    browser_enabled?: boolean;
  }): Promise<Workspace> {
    return this.request<Workspace>(`/v1/workspaces/${this.workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async setBrowserEnabled(enabled: boolean): Promise<Workspace> {
    return this.updateWorkspace({ browser_enabled: enabled });
  }

  async claimWorkspace(): Promise<Workspace> {
    return this.request<Workspace>(`/v1/workspaces/${this.workspaceId}/claim`, {
      method: 'POST',
    });
  }

  async updateMember(agentName: string, updates: { description?: string; role?: string }): Promise<unknown> {
    return this.request(`/v1/workspaces/${this.workspaceId}/members/${agentName}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async updateChannel(channelName: string, updates: { title?: string; status?: string; starred?: boolean }): Promise<unknown> {
    return this.request(`/v1/workspaces/${this.workspaceId}/channels/${channelName}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  // ---------------------------------------------------------------------------
  // Network discovery
  // ---------------------------------------------------------------------------

  /** Discover agents, channels, and resources in the network. */
  async discover(): Promise<NetworkDiscovery> {
    return this.request<NetworkDiscovery>(`/v1/discover?network=${this.workspaceId}`);
  }

  /** Get network profile metadata. */
  async networkProfile(): Promise<NetworkProfile> {
    return this.request<NetworkProfile>(`/v1/profile?network=${this.workspaceId}`);
  }

  // ---------------------------------------------------------------------------
  // Channels (sessions) — via ONM events
  // ---------------------------------------------------------------------------

  /** Create a new channel (thread) by emitting a network.channel.create event. */
  async createChannel(opts: {
    title?: string;
    master?: string;
    participants?: string[];
    /** Emails of humans to add as channel members. They'll receive a
     *  push for every message in this channel (not just @-mentions) and
     *  show up in everyone's @-mention picker via the workspace
     *  collaborator upsert on the backend. */
    humanParticipants?: string[];
    resumeFrom?: string;
  } = {}): Promise<WorkspaceSession> {
    const event = await this.sendEvent({
      type: 'network.channel.create',
      source: 'human:user',
      target: 'core',
      payload: {
        ...(opts.title && { title: opts.title }),
        ...(opts.master && { master: opts.master }),
        ...(opts.participants && { participants: opts.participants }),
        ...(opts.humanParticipants && opts.humanParticipants.length > 0 && {
          human_participants: opts.humanParticipants,
        }),
        ...(opts.resumeFrom && { resume_from: opts.resumeFrom }),
      },
    });

    // Build a WorkspaceSession from the event response
    const channelName = (event.metadata?.channel_name as string) || '';
    return {
      sessionId: channelName,
      workspaceId: this.workspaceId,
      createdBy: 'human:user',
      title: opts.title || 'New Thread',
      status: 'active',
      starred: false,
      participants: opts.participants || [],
      master: opts.master || null,
      createdAt: new Date(event.timestamp).toISOString(),
      lastEventAt: null,
    };
  }

  /** Add an agent to an existing channel. */
  async addChannelParticipant(channelName: string, agentName: string): Promise<void> {
    await this.sendEvent({
      type: 'network.channel.join',
      source: 'human:user',
      target: `channel/${channelName}`,
      payload: { channel: channelName, agent_name: agentName },
    });
  }

  /** Remove an agent from an existing channel. */
  async removeChannelParticipant(channelName: string, agentName: string): Promise<void> {
    await this.sendEvent({
      type: 'network.channel.leave',
      source: 'human:user',
      target: `channel/${channelName}`,
      payload: { channel: channelName, agent_name: agentName },
    });
  }

  // ---------------------------------------------------------------------------
  // Messages — via ONM events
  // ---------------------------------------------------------------------------

  /** Send a chat message by emitting a workspace.message.posted event.
   *
   * `senderEmail` + `senderDisplayName` are optional but should be passed
   * for signed-in human users — the backend uses them to auto-create a
   * `WorkspaceCollaborator` row the first time, so @-mention pushes can
   * later resolve "@bary" → bary's device tokens. Anonymous (token-only)
   * visitors leave them empty; mention-targeted pushes simply won't reach
   * those users until they sign in.
   */
  async sendMessage(
    channelName: string,
    content: string,
    senderName = 'user',
    mentions?: string[],
    attachments?: { fileId: string; filename: string; contentType: string; url: string }[],
    senderEmail?: string,
    senderDisplayName?: string,
  ): Promise<ONMEvent> {
    return this.sendEvent({
      type: 'workspace.message.posted',
      source: `human:${senderName}`,
      target: `channel/${channelName}`,
      payload: {
        content,
        sender_type: 'human',
        ...(senderEmail ? { sender_email: senderEmail } : {}),
        ...(senderDisplayName ? { sender_display_name: senderDisplayName } : {}),
        ...(mentions && mentions.length > 0 ? { mentions } : {}),
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      },
      visibility: 'channel',
    });
  }

  /**
   * Poll messages for a channel (session) via the event API.
   * Returns WorkspaceMessage[] for component compatibility.
   */
  async pollMessages(channelName: string, after?: string): Promise<MessagePollResponse> {
    const result = await this.pollEvents({
      channel: channelName,
      type: 'workspace.message',
      after,
      limit: 200,
    });

    return {
      messages: result.events.map(eventToMessage),
      hasMore: result.has_more,
    };
  }

  // ---------------------------------------------------------------------------
  // Agent control — mode changes etc.
  // ---------------------------------------------------------------------------

  /** Send a control event to an agent (e.g. mode change). */
  async sendAgentControl(
    agentName: string,
    action: string,
    params: Record<string, unknown> = {},
  ): Promise<ONMEvent> {
    return this.sendEvent({
      type: 'workspace.agent.control',
      source: 'human:user',
      target: `openagents:${agentName}`,
      payload: { action, ...params },
      visibility: 'direct',
    });
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------

  /** Upload a file to workspace shared storage. */
  async uploadFile(file: File, channelName?: string): Promise<WorkspaceFile> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('network', this.workspaceId);
    if (channelName) formData.append('channel_name', channelName);

    const authHeaders: Record<string, string> = {};
    if (this.token) authHeaders['X-Workspace-Token'] = this.token;
    if (this.bearerToken) authHeaders['Authorization'] = `Bearer ${this.bearerToken}`;

    const url = `${API_URL}/v1/files`;
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders,
      body: formData,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Upload failed: ${body}`);
    }

    const json = await res.json();
    return mapFileResponse(json.data);
  }

  /** List files in the workspace. */
  async listFiles(): Promise<{ files: WorkspaceFile[]; total: number }> {
    const raw = await this.request<{ files: Record<string, unknown>[]; total: number }>(
      `/v1/files?network=${this.workspaceId}`
    );
    return {
      files: raw.files.map(mapFileResponse),
      total: raw.total,
    };
  }

  /** Get the download URL for a file. */
  getFileUrl(fileId: string): string {
    const params = new URLSearchParams();
    if (this.token) params.set('token', this.token);
    const qs = params.toString();
    return `${API_URL}/v1/files/${fileId}${qs ? `?${qs}` : ''}`;
  }

  /** Delete a file. */
  async deleteFile(fileId: string): Promise<void> {
    await this.request<unknown>(`/v1/files/${fileId}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Browser
  // ---------------------------------------------------------------------------

  /** Map raw backend tab object to BrowserTab. */
  private mapTab(t: Record<string, unknown>): BrowserTab {
    return {
      id: t.id as string,
      url: t.url as string,
      title: (t.title as string) || null,
      status: t.status as string,
      createdBy: (t.created_by as string) || 'unknown',
      sharedWith: (t.shared_with as string[]) || [],
      liveUrl: (t.live_url as string) || null,
      sessionId: (t.session_id as string) || null,
      contextId: (t.context_id as string) || null,
      createdAt: (t.created_at as string) || null,
      lastActiveAt: (t.last_active_at as string) || null,
    };
  }

  /** Map raw backend context object to BrowserPersistentContext. */
  private mapContext(c: Record<string, unknown>): BrowserPersistentContext {
    return {
      id: c.id as string,
      name: c.name as string,
      domain: (c.domain as string) || null,
      status: (c.status as string) || 'active',
      createdBy: (c.created_by as string) || 'unknown',
      sharedWith: (c.shared_with as string[]) || [],
      createdAt: (c.created_at as string) || null,
      lastUsedAt: (c.last_used_at as string) || null,
    };
  }

  /** List active browser tabs. */
  async listBrowserTabs(): Promise<{ tabs: BrowserTab[]; total: number }> {
    const result = await this.request<{ tabs: unknown[]; total: number }>(
      `/v1/browser/tabs?network=${this.workspaceId}`
    );
    return {
      tabs: (result.tabs as Record<string, unknown>[]).map((t) => this.mapTab(t)),
      total: result.total,
    };
  }

  /** Open a new browser tab. Optionally open with a persistent context (already logged in). */
  async openBrowserTab(url = 'about:blank', contextId?: string): Promise<BrowserTab> {
    const body: Record<string, unknown> = { url, network: this.workspaceId, source: 'human:user' };
    if (contextId) body.context_id = contextId;
    const result = await this.request<Record<string, unknown>>('/v1/browser/tabs', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return this.mapTab(result);
  }

  /** Validate a browser tab session — auto-reconnects if expired. */
  async validateBrowserTab(tabId: string): Promise<BrowserTab> {
    const result = await this.request<Record<string, unknown>>(
      `/v1/browser/tabs/${tabId}?validate=true`,
    );
    return this.mapTab(result);
  }

  /** Reconnect an expired browser tab (creates a new session). */
  async reconnectBrowserTab(tabId: string): Promise<BrowserTab> {
    const result = await this.request<Record<string, unknown>>(
      `/v1/browser/tabs/${tabId}/reconnect`,
      { method: 'POST' },
    );
    return this.mapTab(result);
  }

  /** Navigate a browser tab to a new URL. */
  async navigateBrowserTab(tabId: string, url: string): Promise<BrowserTab> {
    const result = await this.request<Record<string, unknown>>(
      `/v1/browser/tabs/${tabId}/navigate`,
      { method: 'POST', body: JSON.stringify({ url }) },
    );
    return this.mapTab(result);
  }

  /** Close a browser tab. */
  async closeBrowserTab(tabId: string): Promise<void> {
    await this.request<unknown>(`/v1/browser/tabs/${tabId}`, { method: 'DELETE' });
  }

  /** Get screenshot URL for a browser tab. */
  getBrowserScreenshotUrl(tabId: string): string {
    return `${API_URL}/v1/browser/tabs/${tabId}/screenshot`;
  }

  /** Remove persistent state from a browser tab (revert to temporal). */
  async unpersistBrowserTab(tabId: string): Promise<BrowserTab> {
    const result = await this.request<Record<string, unknown>>(
      `/v1/browser/tabs/${tabId}/unpersist`,
      { method: 'POST' },
    );
    return this.mapTab(result);
  }

  /** Mark a browser tab as persistent (saves cookies/storage for reuse). */
  async persistBrowserTab(tabId: string, name: string): Promise<{ tab: BrowserTab; context: BrowserPersistentContext }> {
    const result = await this.request<{ tab: Record<string, unknown>; context: Record<string, unknown> }>(
      `/v1/browser/tabs/${tabId}/persist`,
      { method: 'POST', body: JSON.stringify({ name }) },
    );
    return { tab: this.mapTab(result.tab), context: this.mapContext(result.context) };
  }

  /** List persistent browser contexts (saved sessions). */
  async listBrowserContexts(): Promise<{ contexts: BrowserPersistentContext[]; total: number }> {
    const result = await this.request<{ contexts: unknown[]; total: number }>(
      `/v1/browser/contexts?network=${this.workspaceId}`,
    );
    return {
      contexts: (result.contexts as Record<string, unknown>[]).map((c) => this.mapContext(c)),
      total: result.total,
    };
  }

  /** Delete a persistent browser context (removes saved cookies/storage permanently). */
  async deleteBrowserContext(contextId: string): Promise<void> {
    await this.request<unknown>(`/v1/browser/contexts/${contextId}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Agent management (stubs — not yet event-native)
  // ---------------------------------------------------------------------------

  async listAgents(): Promise<WorkspaceAgent[]> {
    const discovery = await this.discover();
    return discovery.agents.map((a) => ({
      agentName: a.address.replace(/^openagents:/, ''),
      role: a.role,
      agentType: a.agent_type || null,
      serverHost: a.server_host || null,
      workingDir: a.working_dir || null,
      description: a.description || null,
      status: a.status,
      lastHeartbeatAt: null,
      joinedAt: null,
    }));
  }

  /** Fetch the catalog of supported agent client types. */
  async getAgentCatalog(): Promise<AgentCatalogEntry[]> {
    return this.request<AgentCatalogEntry[]>('/v1/agent-catalog');
  }

  async updateAgentRole(_agentName: string, _role: string): Promise<WorkspaceAgent> {
    throw new Error('Agent role management is not yet available in event-native mode');
  }

  async removeAgent(agentName: string): Promise<void> {
    await this.request<unknown>('/v1/remove', {
      method: 'POST',
      body: JSON.stringify({ agent_name: agentName, network: this.workspaceId }),
    });
  }

  // ---------------------------------------------------------------------------
  // Invitations (stubs — not yet event-native)
  // ---------------------------------------------------------------------------

  async createInvitation(_targetAgentName: string, _expiresInHours = 168): Promise<WorkspaceInvitation> {
    throw new Error('Invitations are not yet available in event-native mode');
  }

  async listInvitations(_status?: string): Promise<WorkspaceInvitation[]> {
    return []; // Return empty list — invitations not yet migrated
  }

  // ---------------------------------------------------------------------------
  // Collaborators (email-based sharing)
  // ---------------------------------------------------------------------------

  /** List email-based collaborators for this workspace. */
  async listCollaborators(): Promise<{ collaborators: WorkspaceCollaborator[]; owner: string | null }> {
    return this.request<{ collaborators: WorkspaceCollaborator[]; owner: string | null }>(
      `/v1/workspaces/${this.workspaceId}/collaborators`
    );
  }

  /** Add an email-based collaborator. */
  async addCollaborator(email: string, role: string = 'editor'): Promise<WorkspaceCollaborator> {
    return this.request<WorkspaceCollaborator>(`/v1/workspaces/${this.workspaceId}/collaborators`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    });
  }

  /** Remove an email-based collaborator. */
  async removeCollaborator(email: string): Promise<void> {
    await this.request<unknown>(`/v1/workspaces/${this.workspaceId}/collaborators/${encodeURIComponent(email)}`, {
      method: 'DELETE',
    });
  }

  /** Self-register the signed-in user as a workspace collaborator so they
   * appear in the @-mention picker without needing to post a message first.
   * Called by `workspace-context.refreshDiscovery` after Google sign-in. */
  async recordPresence(senderEmail: string, senderDisplayName?: string | null): Promise<void> {
    await this.request<unknown>(`/v1/workspaces/${this.workspaceId}/presence`, {
      method: 'POST',
      body: JSON.stringify({ senderEmail, senderDisplayName: senderDisplayName ?? null }),
    });
  }

  // ---------------------------------------------------------------------------
  // Low-level ONM event API
  // ---------------------------------------------------------------------------

  /** Send an event through the mod pipeline. */
  async sendEvent(event: {
    type: string;
    source: string;
    target: string;
    payload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    visibility?: string;
  }): Promise<ONMEvent> {
    return this.request<ONMEvent>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({ ...event, network: this.workspaceId }),
    });
  }

  /**
   * Post the result of a user interaction with an A2UI-rendered component
   * back upstream. Mirrors the Swift app's `WorkspaceAPI.sendToolResult`.
   * The agent runtime interprets `workspace.tool_result` as the response
   * to the originating `render_ui` invocation.
   */
  async sendToolResult(opts: {
    channel: string;
    actionId: string;
    toolCallId?: string | null;
    value?: unknown;
  }): Promise<ONMEvent> {
    const payload: Record<string, unknown> = { action_id: opts.actionId };
    if (opts.toolCallId) payload.tool_call_id = opts.toolCallId;
    if (opts.value !== undefined) payload.value = opts.value;
    return this.sendEvent({
      type: 'workspace.tool_result',
      source: 'human:user',
      target: `channel/${opts.channel}`,
      payload,
      visibility: 'direct',
    });
  }

  /** Poll events from the network. */
  async pollEvents(opts: {
    after?: string;
    before?: string;
    target?: string;
    channel?: string;
    type?: string;
    search?: string;
    sort?: 'asc' | 'desc';
    limit?: number;
  } = {}): Promise<EventPollResponse> {
    const params = new URLSearchParams({ network: this.workspaceId });
    if (opts.after) params.set('after', opts.after);
    if (opts.before) params.set('before', opts.before);
    if (opts.target) params.set('target', opts.target);
    if (opts.channel) params.set('channel', opts.channel);
    if (opts.type) params.set('type', opts.type);
    if (opts.search) params.set('search', opts.search);
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.limit) params.set('limit', String(opts.limit));
    return this.request<EventPollResponse>(`/v1/events?${params}`);
  }

  /**
   * Load message history for a channel (most recent first).
   * Used for initial load and infinite scroll (loading older messages).
   */
  async loadMessageHistory(
    channelName: string,
    options?: { before?: string; limit?: number },
  ): Promise<EventPollResponse> {
    return this.pollEvents({
      channel: channelName,
      type: 'workspace.message',
      before: options?.before,
      sort: 'desc',
      limit: options?.limit ?? 50,
    });
  }

  /** Search messages across all channels. Returns events grouped by channel. */
  async searchMessages(query: string): Promise<{ channelName: string; snippet: string; messageId: string }[]> {
    const result = await this.pollEvents({
      type: 'workspace.message',
      search: query,
      limit: 50,
    });
    return result.events.map((e) => ({
      channelName: e.target.replace(/^channel\//, ''),
      snippet: (e.payload as Record<string, string>)?.content || '',
      messageId: e.id,
    }));
  }

  // ---------------------------------------------------------------------------
  // Agent DM conversations
  // ---------------------------------------------------------------------------

  /** List active agent-to-agent DM conversations. */
  async listConversations(agentFilter?: string): Promise<DMConversation[]> {
    const params = new URLSearchParams({ network: this.workspaceId });
    if (agentFilter) params.set('agent', agentFilter);
    const result = await this.request<{ conversations: Array<{
      agents: [string, string];
      last_message: { content: string; sender: string; timestamp: number };
      message_count: number;
    }> }>(`/v1/events/conversations?${params}`);
    return result.conversations.map((c) => ({
      agents: c.agents,
      lastMessage: c.last_message,
      messageCount: c.message_count,
    }));
  }

  /** Poll messages for a DM conversation between two agents. */
  async pollConversation(
    agentA: string,
    agentB: string,
    opts?: { after?: string; before?: string; sort?: 'asc' | 'desc'; limit?: number },
  ): Promise<EventPollResponse> {
    const params = new URLSearchParams({ network: this.workspaceId });
    params.set('conversation', `${agentA},${agentB}`);
    params.set('type', 'workspace.message');
    if (opts?.after) params.set('after', opts.after);
    if (opts?.before) params.set('before', opts.before);
    if (opts?.sort) params.set('sort', opts.sort);
    if (opts?.limit) params.set('limit', String(opts.limit));
    return this.request<EventPollResponse>(`/v1/events?${params}`);
  }

  // ---------------------------------------------------------------------------
  // Bulk thread previews
  // ---------------------------------------------------------------------------

  /** Fetch the latest message event per channel in a single request. */
  async latestPerChannel(): Promise<{ channels: Record<string, ONMEvent> }> {
    const params = new URLSearchParams({ network: this.workspaceId });
    return this.request<{ channels: Record<string, ONMEvent> }>(`/v1/events/latest-per-channel?${params}`);
  }

  // ---------------------------------------------------------------------------
  // Todos / Tasks
  // ---------------------------------------------------------------------------

  async listTodos(): Promise<{ todos: TodoItem[] }> {
    const params = new URLSearchParams({ network: this.workspaceId, all: 'true' });
    const raw = await this.request<{ todos: Record<string, unknown>[] }>(`/v1/todos?${params}`);
    return {
      todos: (raw.todos || []).map((t): TodoItem => ({
        id: t.id as string,
        content: t.content as string,
        status: t.status as TodoItem['status'],
        assignee: t.assignee as string,
        createdBy: (t.created_by || '') as string,
        channelName: (t.channel_name || '') as string,
        threadId: (t.thread_id || null) as string | null,
        position: (t.position || 0) as number,
        createdAt: (t.created_at || null) as string | null,
        updatedAt: (t.updated_at || null) as string | null,
      })),
    };
  }

  async listTimers(channel?: string): Promise<{ timers: TimerItem[] }> {
    const params = new URLSearchParams({ network: this.workspaceId });
    if (channel) params.set('channel', channel);
    const raw = await this.request<{ timers: Record<string, unknown>[] }>(`/v1/timers?${params}`);
    return {
      timers: (raw.timers || []).map((t): TimerItem => ({
        id: t.id as string,
        message: t.message as string,
        delaySeconds: (t.delay_seconds || 0) as number,
        firesAt: (t.fires_at || '') as string,
        status: (t.status || 'active') as string,
        createdBy: (t.created_by || '') as string,
        channelName: (t.channel_name || '') as string,
        createdAt: (t.created_at || null) as string | null,
      })),
    };
  }

  async cancelTimer(timerId: string): Promise<void> {
    await this.request<unknown>(`/v1/timers/${timerId}`, { method: 'DELETE' });
  }

  async cancelQueuedMessage(channelName: string, queueId: string): Promise<void> {
    await this.sendEvent({
      type: 'workspace.message.posted',
      source: 'human:user',
      target: `channel/${channelName}`,
      payload: {
        content: `__queue_cancel:${queueId}`,
        message_type: 'queue_cancel',
      },
    });
  }

  async listRoutines(): Promise<{ routines: import('./types').RoutineItem[] }> {
    const params = new URLSearchParams({ network: this.workspaceId });
    const raw = await this.request<{ routines: Record<string, unknown>[] }>(`/v1/routines?${params}`);
    return {
      routines: (raw.routines || []).map((r) => ({
        id: r.id as string,
        name: r.name as string,
        message: r.message as string,
        scheduleHour: (r.schedule_hour || 0) as number,
        scheduleMinute: (r.schedule_minute || 0) as number,
        scheduleDays: (r.schedule_days || null) as number[] | null,
        timezone: (r.timezone || 'UTC') as string,
        nextFiresAt: (r.next_fires_at || '') as string,
        lastFiredAt: (r.last_fired_at || null) as string | null,
        status: (r.status || 'active') as string,
        createdBy: (r.created_by || '') as string,
        channelName: (r.channel_name || '') as string,
        createdAt: (r.created_at || null) as string | null,
      })),
    };
  }

  async cancelRoutine(routineId: string): Promise<void> {
    await this.request<unknown>(`/v1/routines/${routineId}`, { method: 'DELETE' });
  }

  async cancelChannelTodos(channel: string, source: string): Promise<void> {
    const params = new URLSearchParams({ network: this.workspaceId, channel, source });
    const raw = await this.request<{ todos: Record<string, unknown>[] }>(`/v1/todos?${params}`);
    const todos = raw.todos || [];
    const hasActive = todos.some((t) => t.status === 'pending' || t.status === 'in_progress');
    if (!hasActive) return;
    const updated = todos.map((t) => ({
      content: t.content as string,
      status: (t.status === 'pending' || t.status === 'in_progress') ? 'cancelled' : t.status as string,
      assignee: t.assignee as string,
    }));
    await this.request<unknown>('/v1/todos', {
      method: 'PUT',
      body: JSON.stringify({
        todos: updated,
        network: this.workspaceId,
        channel,
        source,
      }),
    });
  }
}

export const workspaceApi = new WorkspaceApi();
