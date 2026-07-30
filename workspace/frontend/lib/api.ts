import type {
  AgentCatalogEntry,
  ApiResponse,
  BrowserPersistentContext,
  BrowserTab,
  CloudAgentConfig,
  CloudAgentProvider,
  DMConversation,
  EventPollResponse,
  KnowledgeEntry,
  MessagePollResponse,
  NetworkDiscovery,
  NetworkProfile,
  NotificationItem,
  ONMEvent,
  ShareSummary,
  TimerItem,
  TodoItem,
  TrashEntry,
  Workspace,
  WorkspaceAgent,
  WorkspaceCollaborator,
  WorkspaceCustomSkill,
  WorkspaceFile,
  WorkspaceInvitation,
  WorkspaceSession,
} from './types';
import { eventToMessage } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://workspace-endpoint.openagents.org';

/** Map a snake_case custom-skill entry from the backend to camelCase. */
function mapCustomSkill(raw: Record<string, unknown>): WorkspaceCustomSkill {
  return {
    id: raw.id as string,
    name: (raw.name || raw.id) as string,
    description: (raw.description as string) || '',
    category: 'custom',
    tags: (raw.tags as string[]) || [],
    author: (raw.author as string) || 'Workspace user',
    sourceType: 'workspace_file',
    fileId: (raw.file_id || raw.fileId) as string,
    filename: (raw.filename as string) || '',
    contentType: (raw.content_type || raw.contentType) as string | undefined,
    packageType: (raw.package_type || raw.packageType || 'md') as 'md' | 'zip',
    createdAt: (raw.created_at || raw.createdAt) as string | undefined,
  };
}

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

/** Map a snake_case trash entry from the backend to camelCase. */
function mapTrashEntry(raw: Record<string, unknown>): TrashEntry {
  return {
    trashId: raw.trash_id as string,
    kind: raw.kind === 'folder' ? 'folder' : 'file',
    path: (raw.path || '') as string,
    name: (raw.name || '') as string,
    deletedAt: (raw.deleted_at ?? null) as string | null,
    fileCount: (raw.file_count as number) ?? 0,
    size: (raw.size as number) ?? 0,
    files: ((raw.files as Record<string, unknown>[]) || []).map((f) => ({
      id: f.id as string,
      filename: f.filename as string,
      name: (f.name || f.filename) as string,
      size: (f.size as number) ?? 0,
      contentType: (f.content_type || 'application/octet-stream') as string,
      kind: (f.kind || 'other') as string,
    })),
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

  /** Whether configure() has run with a non-empty workspace id. */
  isConfigured(): boolean {
    return this.workspaceId !== '';
  }

  /**
   * Guard against firing requests before configure() has populated
   * workspaceId. configure() runs in a useEffect that fires *after* the
   * first render, so any event sent during initial mount would otherwise
   * POST `network: ""` and get a 400 ("Missing required field: network")
   * from the backend. Throw a clear error instead of a confusing 400.
   */
  private requireWorkspace(): string {
    if (this.workspaceId === '') {
      throw new Error('WorkspaceApi not configured yet (workspaceId is empty)');
    }
    return this.workspaceId;
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

  async updateWorkspace(updates: { name?: string; settings?: Record<string, unknown>; browserfabric_api_key?: string }): Promise<Workspace> {
    return this.request<Workspace>(`/v1/workspaces/${this.workspaceId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async claimWorkspace(): Promise<Workspace> {
    return this.request<Workspace>(`/v1/workspaces/${this.workspaceId}/claim`, {
      method: 'POST',
    });
  }

  async updateMember(agentName: string, updates: { description?: string; role?: string; enabled_skills?: Record<string, boolean> }): Promise<unknown> {
    return this.request(`/v1/workspaces/${this.workspaceId}/members/${agentName}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  /** Draft a one-line role description for an agent via the router LLM.
   * Returns the suggestion — the caller reviews and saves via updateMember. */
  async generateMemberDescription(agentName: string): Promise<string> {
    const raw = await this.request<{ agentName: string; description: string }>(
      `/v1/workspaces/${this.workspaceId}/members/${agentName}/generate-description`,
      { method: 'POST' },
    );
    return raw.description || '';
  }

  async getSkillCatalog(): Promise<import('./types').SkillCatalogEntry[]> {
    return this.request<import('./types').SkillCatalogEntry[]>('/v1/workspaces/skill-catalog');
  }

  async installSkill(agentName: string, skillId: string): Promise<unknown> {
    return this.request(`/v1/workspaces/${this.workspaceId}/members/${agentName}/skills/install`, {
      method: 'POST',
      body: JSON.stringify({ skill_id: skillId }),
    });
  }

  async uninstallSkill(agentName: string, skillId: string): Promise<unknown> {
    return this.request(`/v1/workspaces/${this.workspaceId}/members/${agentName}/skills/uninstall`, {
      method: 'POST',
      body: JSON.stringify({ skill_id: skillId }),
    });
  }

  // ── Custom (user-uploaded) skills ──

  /** List this workspace's custom skills. */
  async getCustomSkills(): Promise<WorkspaceCustomSkill[]> {
    const raw = await this.request<{ skills: Record<string, unknown>[] }>(
      `/v1/workspaces/${this.workspaceId}/skills/custom`,
    );
    return (raw.skills || []).map(mapCustomSkill);
  }

  /** Register an already-uploaded file (by file_id) as a custom skill. */
  async registerCustomSkill(meta: {
    fileId: string;
    id?: string;
    name?: string;
    description?: string;
    filename?: string;
  }): Promise<WorkspaceCustomSkill> {
    const raw = await this.request<Record<string, unknown>>(
      `/v1/workspaces/${this.workspaceId}/skills/custom`,
      {
        method: 'POST',
        body: JSON.stringify({
          file_id: meta.fileId,
          id: meta.id,
          name: meta.name,
          description: meta.description,
          filename: meta.filename,
        }),
      },
    );
    return mapCustomSkill(raw);
  }

  /** Upload a .md/.zip file and register it as a custom skill in one call. */
  async uploadCustomSkill(
    file: File,
    meta: { id?: string; name?: string; description?: string },
  ): Promise<WorkspaceCustomSkill> {
    const uploaded = await this.uploadFile(file);
    return this.registerCustomSkill({
      fileId: uploaded.id,
      id: meta.id,
      name: meta.name,
      description: meta.description,
      filename: file.name,
    });
  }

  async updateChannel(channelName: string, updates: { title?: string; status?: string; starred?: boolean; masterAgent?: string; orchestrationMode?: string; orchestrationInstruction?: string | null }): Promise<unknown> {
    // Map camelCase fields → snake_case for the backend.
    const { masterAgent, orchestrationMode, orchestrationInstruction, ...rest } = updates;
    const body: Record<string, unknown> = { ...rest };
    if (masterAgent !== undefined) body.master_agent = masterAgent;
    if (orchestrationMode !== undefined) body.orchestration_mode = orchestrationMode;
    if (orchestrationInstruction !== undefined) body.orchestration_instruction = orchestrationInstruction;
    return this.request(`/v1/workspaces/${this.workspaceId}/channels/${channelName}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
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
      orchestrationMode: 'dynamic',
      orchestrationInstruction: null,
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

  /** Send a chat message by emitting a workspace.message.posted event. */
  async sendMessage(
    channelName: string,
    content: string,
    senderName = 'user',
    mentions?: string[],
    attachments?: { fileId: string; filename: string; contentType: string; url: string }[],
    senderId?: string,
  ): Promise<ONMEvent> {
    return this.sendEvent({
      type: 'workspace.message.posted',
      source: `human:${senderId || senderName}`,
      target: `channel/${channelName}`,
      payload: {
        content,
        sender_type: 'human',
        ...(senderId ? { sender_id: senderId } : {}),
        sender_name: senderName,
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
  // Composing signal — notify backend that a user is typing
  // ---------------------------------------------------------------------------

  async sendComposing(channelName: string): Promise<void> {
    try {
      await this.request<unknown>('/v1/composing', {
        method: 'POST',
        body: JSON.stringify({ network: this.workspaceId, channel: channelName }),
      });
    } catch {
      // Fire-and-forget
    }
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

  /**
   * Upload a file to workspace shared storage.
   *
   * XHR rather than fetch for one reason: `upload.onprogress`. A fetch request
   * body is opaque once it's handed over, so there is no way to tell a 40MB
   * upload apart from a stalled one — and the grid draws a progress bar over
   * the file while it goes up.
   */
  uploadFile(
    file: File,
    channelName?: string,
    options?: {
      /** Fraction uploaded, 0–1. Never fires if the browser can't measure it. */
      onProgress?: (fraction: number) => void;
      signal?: AbortSignal;
    },
  ): Promise<WorkspaceFile> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('network', this.workspaceId);
    if (channelName) formData.append('channel_name', channelName);

    return new Promise<WorkspaceFile>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/v1/files`);
      if (this.token) xhr.setRequestHeader('X-Workspace-Token', this.token);
      if (this.bearerToken) xhr.setRequestHeader('Authorization', `Bearer ${this.bearerToken}`);

      if (options?.onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) options.onProgress!(e.loaded / e.total);
        };
      }

      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(`Upload failed: ${xhr.responseText || xhr.statusText}`));
          return;
        }
        try {
          resolve(mapFileResponse(JSON.parse(xhr.responseText).data));
        } catch {
          reject(new Error('Upload failed: malformed response'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed: network error'));
      xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));

      if (options?.signal) {
        if (options.signal.aborted) {
          reject(new DOMException('Upload cancelled', 'AbortError'));
          return;
        }
        options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }

      xhr.send(formData);
    });
  }

  /**
   * List every file in the workspace.
   *
   * The endpoint pages at 50 by default and caps at 200, but the Files view
   * derives the whole folder tree from this list — a partial page silently
   * drops folders and makes their counts shrink as new files arrive, so we
   * walk the pages until we have them all.
   */
  async listFiles(): Promise<{ files: WorkspaceFile[]; total: number }> {
    const PAGE_SIZE = 200; // the endpoint's hard ceiling
    const MAX_PAGES = 25;  // 5k files: a backstop, not an expected limit
    const files: WorkspaceFile[] = [];
    let total = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const raw = await this.request<{ files: Record<string, unknown>[]; total: number }>(
        `/v1/files?network=${this.workspaceId}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      );
      total = raw.total;
      files.push(...raw.files.map(mapFileResponse));
      if (raw.files.length < PAGE_SIZE || files.length >= total) break;
    }

    return { files, total };
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

  /**
   * Folders are a path prefix on `filename`, not rows of their own, so these
   * rewrite or soft-delete every record under the prefix server-side.
   */
  async createFolder(path: string): Promise<void> {
    await this.request<unknown>('/v1/files/folders', {
      method: 'POST',
      body: JSON.stringify({ network: this.workspaceId, path }),
    });
  }

  async renameFolder(path: string, newPath: string): Promise<void> {
    await this.request<unknown>('/v1/files/folders', {
      method: 'PATCH',
      body: JSON.stringify({ network: this.workspaceId, path, new_path: newPath }),
    });
  }

  async deleteFolder(path: string): Promise<void> {
    const params = new URLSearchParams({ network: this.workspaceId, path });
    await this.request<unknown>(`/v1/files/folders?${params}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Trash
  //
  // Deleting is soft: files and folders land here first and can be put back.
  // The unit is the delete action, not the file — a deleted folder is one entry
  // holding its files — so restore and purge take `trashId`s, never file ids.
  // ---------------------------------------------------------------------------

  /**
   * Move files and/or folders to the trash.
   *
   * Preferred over `deleteFile`/`deleteFolder`: those routes predate the trash
   * and record no timestamp or grouping, so what they delete comes back as one
   * loose row per file, undated and unrestorable as a unit.
   */
  async moveToTrash(target: { fileIds?: string[]; paths?: string[] }): Promise<void> {
    await this.request<unknown>('/v1/files/trash', {
      method: 'POST',
      body: JSON.stringify({
        network: this.workspaceId,
        file_ids: target.fileIds ?? [],
        paths: target.paths ?? [],
      }),
    });
  }

  /** What's in the trash, newest first. Paged for the same reason as listFiles. */
  async listTrash(): Promise<{
    entries: TrashEntry[];
    total: number;
    fileTotal: number;
    sizeTotal: number;
  }> {
    const PAGE_SIZE = 500; // the endpoint's hard ceiling
    const MAX_PAGES = 10;
    const entries: TrashEntry[] = [];
    let total = 0;
    let fileTotal = 0;
    let sizeTotal = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const raw = await this.request<{
        entries: Record<string, unknown>[];
        total: number;
        file_total: number;
        size_total: number;
      }>(
        `/v1/files/trash?network=${this.workspaceId}&limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`
      );
      total = raw.total;
      fileTotal = raw.file_total;
      sizeTotal = raw.size_total;
      entries.push(...raw.entries.map(mapTrashEntry));
      if (raw.entries.length < PAGE_SIZE || entries.length >= total) break;
    }

    return { entries, total, fileTotal, sizeTotal };
  }

  /**
   * Put trash entries back where they were.
   *
   * A name taken in the meantime doesn't fail the restore — the file lands
   * beside its replacement as "report (2).pdf" — so `renamedCount` is what the
   * caller needs to say so rather than claiming an exact restore.
   */
  async restoreFromTrash(trashIds: string[]): Promise<{ restoredCount: number; renamedCount: number }> {
    const data = await this.request<{
      entries: { renamed_count?: number }[];
      restored_count: number;
    }>('/v1/files/trash/restore', {
      method: 'POST',
      body: JSON.stringify({ network: this.workspaceId, trash_ids: trashIds }),
    });
    return {
      restoredCount: data.restored_count ?? 0,
      renamedCount: (data.entries ?? []).reduce((n, e) => n + (e.renamed_count ?? 0), 0),
    };
  }

  /** Destroy trash entries — records and stored bytes. `all` is Empty Trash. */
  async purgeTrash(target: { trashIds?: string[]; all?: boolean }): Promise<void> {
    await this.request<unknown>('/v1/files/trash/purge', {
      method: 'POST',
      body: JSON.stringify({
        network: this.workspaceId,
        trash_ids: target.trashIds ?? [],
        all: target.all ?? false,
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // Knowledge Base
  // ---------------------------------------------------------------------------

  async listKnowledge(): Promise<{ entries: KnowledgeEntry[]; total: number }> {
    const raw = await this.request<{ entries: Record<string, unknown>[]; total: number }>(
      `/v1/knowledge?network=${this.workspaceId}`
    );
    return {
      entries: (raw.entries || []).map((e): KnowledgeEntry => ({
        id: e.id as string,
        slug: e.slug as string,
        title: e.title as string,
        description: (e.description ?? null) as string | null,
        contentSize: (e.content_size ?? null) as number | null,
        createdBy: (e.created_by || '') as string,
        updatedBy: (e.updated_by ?? null) as string | null,
        status: (e.status || 'active') as string,
        createdAt: (e.created_at || null) as string | null,
        updatedAt: (e.updated_at || null) as string | null,
      })),
      total: raw.total || 0,
    };
  }

  async getKnowledgeEntry(entryId: string): Promise<KnowledgeEntry & { content: string }> {
    const raw = await this.request<Record<string, unknown>>(`/v1/knowledge/${entryId}`);
    return {
      id: raw.id as string,
      slug: raw.slug as string,
      title: raw.title as string,
      description: (raw.description ?? null) as string | null,
      contentSize: (raw.content_size ?? null) as number | null,
      createdBy: (raw.created_by || '') as string,
      updatedBy: (raw.updated_by ?? null) as string | null,
      status: (raw.status || 'active') as string,
      createdAt: (raw.created_at || null) as string | null,
      updatedAt: (raw.updated_at || null) as string | null,
      content: (raw.content || '') as string,
    };
  }

  async createKnowledge(params: { title: string; content: string; description?: string }): Promise<KnowledgeEntry> {
    const raw = await this.request<Record<string, unknown>>('/v1/knowledge', {
      method: 'POST',
      body: JSON.stringify({
        network: this.workspaceId,
        title: params.title,
        content: params.content,
        description: params.description || null,
        source: 'human:user',
      }),
    });
    return {
      id: raw.id as string,
      slug: raw.slug as string,
      title: raw.title as string,
      description: (raw.description ?? null) as string | null,
      contentSize: (raw.content_size ?? null) as number | null,
      createdBy: (raw.created_by || '') as string,
      updatedBy: (raw.updated_by ?? null) as string | null,
      status: (raw.status || 'active') as string,
      createdAt: (raw.created_at || null) as string | null,
      updatedAt: (raw.updated_at || null) as string | null,
    };
  }

  async updateKnowledge(entryId: string, params: { title?: string; content?: string; description?: string }): Promise<KnowledgeEntry> {
    const raw = await this.request<Record<string, unknown>>(`/v1/knowledge/${entryId}`, {
      method: 'PUT',
      body: JSON.stringify({
        network: this.workspaceId,
        ...params.title !== undefined && { title: params.title },
        ...params.content !== undefined && { content: params.content },
        ...params.description !== undefined && { description: params.description },
        source: 'human:user',
      }),
    });
    return {
      id: raw.id as string,
      slug: raw.slug as string,
      title: raw.title as string,
      description: (raw.description ?? null) as string | null,
      contentSize: (raw.content_size ?? null) as number | null,
      createdBy: (raw.created_by || '') as string,
      updatedBy: (raw.updated_by ?? null) as string | null,
      status: (raw.status || 'active') as string,
      createdAt: (raw.created_at || null) as string | null,
      updatedAt: (raw.updated_at || null) as string | null,
    };
  }

  async deleteKnowledge(entryId: string): Promise<void> {
    await this.request<unknown>(`/v1/knowledge/${entryId}?network=${this.workspaceId}`, { method: 'DELETE' });
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
      enabledSkills: a.enabled_skills || null,
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
  // Cloud agents
  // ---------------------------------------------------------------------------

  async getCloudProviders(): Promise<CloudAgentProvider[]> {
    const res = await this.request<{ providers: CloudAgentProvider[] }>('/v1/cloud-agents/providers');
    return res.providers;
  }

  async listCloudAgents(): Promise<CloudAgentConfig[]> {
    const res = await this.request<{ cloud_agents: CloudAgentConfig[] }>(
      `/v1/cloud-agents?network=${this.workspaceId}`
    );
    return res.cloud_agents;
  }

  async addCloudAgent(params: {
    agentName: string;
    provider: string;
    model: string;
    apiKey: string;
    baseUrl?: string;
    systemPrompt?: string;
    maxTokens?: number;
  }): Promise<CloudAgentConfig> {
    return this.request<CloudAgentConfig>('/v1/cloud-agents', {
      method: 'POST',
      body: JSON.stringify({
        network: this.workspaceId,
        agent_name: params.agentName,
        provider: params.provider,
        model: params.model,
        api_key: params.apiKey,
        base_url: params.baseUrl || null,
        system_prompt: params.systemPrompt || null,
        max_tokens: params.maxTokens || null,
      }),
    });
  }

  async updateCloudAgent(agentName: string, updates: {
    model?: string;
    apiKey?: string;
    systemPrompt?: string;
    maxTokens?: number;
    status?: string;
  }): Promise<CloudAgentConfig> {
    return this.request<CloudAgentConfig>(`/v1/cloud-agents/${agentName}`, {
      method: 'PATCH',
      body: JSON.stringify({
        network: this.workspaceId,
        ...updates.model !== undefined && { model: updates.model },
        ...updates.apiKey !== undefined && { api_key: updates.apiKey },
        ...updates.systemPrompt !== undefined && { system_prompt: updates.systemPrompt },
        ...updates.maxTokens !== undefined && { max_tokens: updates.maxTokens },
        ...updates.status !== undefined && { status: updates.status },
      }),
    });
  }

  async removeCloudAgent(agentName: string): Promise<void> {
    await this.request<unknown>(`/v1/cloud-agents/${agentName}?network=${this.workspaceId}`, {
      method: 'DELETE',
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
    const network = this.requireWorkspace();
    return this.request<ONMEvent>('/v1/events', {
      method: 'POST',
      body: JSON.stringify({ ...event, network }),
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
    const params = new URLSearchParams({ network: this.requireWorkspace() });
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
        context: (r.context || null) as string | null,
        scheduleHour: (r.schedule_hour || 0) as number,
        scheduleMinute: (r.schedule_minute || 0) as number,
        scheduleDays: (r.schedule_days || null) as number[] | null,
        scheduleIntervalMinutes: (r.schedule_interval_minutes || null) as number | null,
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

  async createRoutine(params: {
    name: string;
    message: string;
    source: string;
    hour?: number;
    minute?: number;
    days?: number[];
    interval_minutes?: number;
    conversation_history?: string;
  }): Promise<import('./types').RoutineItem> {
    const raw = await this.request<Record<string, unknown>>('/v1/routines', {
      method: 'POST',
      body: JSON.stringify({
        ...params,
        network: this.workspaceId,
      }),
    });
    return {
      id: raw.id as string,
      name: raw.name as string,
      message: raw.message as string,
      context: (raw.context || null) as string | null,
      scheduleHour: (raw.schedule_hour || 0) as number,
      scheduleMinute: (raw.schedule_minute || 0) as number,
      scheduleDays: (raw.schedule_days || null) as number[] | null,
      scheduleIntervalMinutes: (raw.schedule_interval_minutes || null) as number | null,
      timezone: (raw.timezone || 'UTC') as string,
      nextFiresAt: (raw.next_fires_at || '') as string,
      lastFiredAt: (raw.last_fired_at || null) as string | null,
      status: (raw.status || 'active') as string,
      createdBy: (raw.created_by || '') as string,
      channelName: (raw.channel_name || '') as string,
      createdAt: (raw.created_at || null) as string | null,
    };
  }

  async cancelRoutine(routineId: string): Promise<void> {
    await this.request<unknown>(`/v1/routines/${routineId}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Notifications / Inbox
  // ---------------------------------------------------------------------------

  async listNotifications(opts?: { status?: string; isRead?: boolean; limit?: number }): Promise<{ notifications: NotificationItem[]; unreadCount: number }> {
    const params = new URLSearchParams({ network: this.workspaceId });
    if (opts?.status) params.set('status', opts.status);
    if (opts?.isRead !== undefined) params.set('is_read', String(opts.isRead));
    if (opts?.limit) params.set('limit', String(opts.limit));
    const raw = await this.request<{ notifications: Record<string, unknown>[]; unread_count: number }>(`/v1/notifications?${params}`);
    return {
      notifications: (raw.notifications || []).map((n): NotificationItem => ({
        id: n.id as string,
        title: n.title as string,
        message: n.message as string,
        priority: (n.priority || 'normal') as NotificationItem['priority'],
        isRead: !!(n.is_read),
        createdBy: (n.created_by || '') as string,
        channelName: (n.channel_name ?? null) as string | null,
        threadId: (n.thread_id ?? null) as string | null,
        linkUrl: (n.link_url ?? null) as string | null,
        status: (n.status || 'active') as string,
        createdAt: (n.created_at || null) as string | null,
        readAt: (n.read_at || null) as string | null,
      })),
      unreadCount: raw.unread_count || 0,
    };
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await this.request<unknown>(`/v1/notifications/${notificationId}/read`, { method: 'PATCH' });
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.request<unknown>(`/v1/notifications/read-all?network=${this.workspaceId}`, { method: 'PATCH' });
  }

  async dismissNotification(notificationId: string): Promise<void> {
    await this.request<unknown>(`/v1/notifications/${notificationId}`, { method: 'DELETE' });
  }

  // ---------------------------------------------------------------------------
  // Shares (conversation snapshots)
  // ---------------------------------------------------------------------------

  async createShare(channelName: string, createdBy?: string): Promise<ShareSummary> {
    const raw = await this.request<Record<string, unknown>>('/v1/shares', {
      method: 'POST',
      body: JSON.stringify({
        network: this.workspaceId,
        channel: channelName,
        created_by: createdBy || 'human:user',
      }),
    });
    return {
      id: raw.id as string,
      workspaceId: (raw.workspace_id || '') as string,
      channelName: (raw.channel_name || '') as string,
      title: (raw.title || null) as string | null,
      shareToken: raw.share_token as string,
      messageCount: (raw.message_count || 0) as number,
      status: (raw.status || 'active') as string,
      createdAt: (raw.created_at || null) as string | null,
    };
  }

  async deleteShare(shareId: string): Promise<void> {
    await this.request<unknown>(`/v1/shares/${shareId}?network=${this.workspaceId}`, {
      method: 'DELETE',
    });
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
