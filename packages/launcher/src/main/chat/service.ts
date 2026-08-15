/**
 * Workspace chat: sending, reading, polling, sessions and files.
 *
 * This used to be ~600 lines living on AgentManager. It only ever needed three
 * things from it — the core's workspace client, a way to resolve a workspace id
 * to its token/endpoint, and somewhere to emit stream events — so those are the
 * dependencies it takes, and the rest is self-contained.
 */
import {
  attachmentsToServer,
  eventToMessage,
  extractMentions,
  normalizeIncomingMessage,
} from "./messages"
import {
  clearChatSessions,
  createChatSession,
  deleteChatSession,
  listChatSessions,
  loadChatSession,
  touchChatSession,
} from "./sessions"
import type {
  ChatMessage,
  ChatSessionMeta,
  ChatStreamEvent,
  SendMessageInput,
  SendMessageResult,
  WorkspaceChatClient,
  WorkspaceConfig,
} from "./types"

export const DEFAULT_CHAT_CHANNEL = "main"

// Foreground: the user is watching a conversation, so it has to feel live.
// Background (window hidden or unfocused): nobody is reading, and the launcher
// spends most of its life here — polling every 2.5s from the tray burned both
// battery and server capacity for messages no one could see.
const CHAT_POLL_INTERVAL_MS = 2500
const CHAT_POLL_IDLE_INTERVAL_MS = 15000

interface ChatPollingState {
  workspaceId: string
  channelName: string
  token: string
  cursor: string | null
  seenIds: Set<string>
  timer: NodeJS.Timeout | null
  refs: number
  inFlight: boolean
  workspace: WorkspaceConfig
}

export interface ChatServiceDeps {
  /** The core's workspace client, or null when the core hasn't loaded. */
  getClient: () => WorkspaceChatClient | null
  /** Locally-registered workspace by id or slug. */
  resolveWorkspace: (workspaceId: string) => WorkspaceConfig | null
  /** Forwarded to the renderer as a `chat-event`. */
  emit: (event: ChatStreamEvent) => void
}

export class ChatService {
  private _polls = new Map<string, ChatPollingState>()
  private _foreground = true

  constructor(private deps: ChatServiceDeps) {}

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const ws = this.deps.resolveWorkspace(input.workspaceId)
    if (!ws)
      return { success: false, messageId: "", error: "Workspace not found" }
    if (!ws.token)
      return { success: false, messageId: "", error: "Workspace has no token" }

    const client = this.deps.getClient()
    if (!client)
      return {
        success: false,
        messageId: "",
        error: "Workspace client unavailable",
      }

    const channelName = input.channelName || DEFAULT_CHAT_CHANNEL
    const mentions = input.mentions || extractMentions(input.content)
    const targetAgents =
      mentions.length > 0
        ? mentions
        : input.agentId
          ? [input.agentId]
          : undefined

    try {
      const result = await client.sendMessage(
        ws.id,
        channelName,
        ws.token,
        input.content,
        {
          senderType: "human",
          senderName: "user",
          messageType: "chat",
          metadata: targetAgents
            ? { target_agents: targetAgents, mentions }
            : { mentions },
          attachments: attachmentsToServer(input.attachments),
        },
      )
      touchChatSession(
        ws,
        channelName,
        input.content || (input.attachments?.[0]?.filename ?? ""),
      )
      return { success: true, messageId: (result as { id?: string }).id || "" }
    } catch (e: unknown) {
      return { success: false, messageId: "", error: (e as Error).message }
    }
  }

  async getMessages(
    workspaceId: string,
    channelName?: string,
    limit = 100,
  ): Promise<ChatMessage[]> {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) return []
    const client = this.deps.getClient()
    if (!client) return []
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    try {
      const messages = await client.getRecentMessages(
        ws.id,
        ch,
        ws.token,
        limit,
      )
      return messages.map(normalizeIncomingMessage)
    } catch {
      return []
    }
  }

  /**
   * Every recent message in a workspace, across ALL of its channels.
   *
   * `getMessages` reads one channel and defaults to "main", which is the right
   * shape for the chat view but wrong for the activity summaries: the launcher
   * and the web workspace both open a conversation in its own `channel-<id>`,
   * so "main" is usually empty and the trends read as dead.
   *
   * The connector's client always sends a `channel` filter, so this talks to
   * /v1/events directly — the same request minus that one parameter.
   */
  async getWorkspaceMessages(
    workspaceId: string,
    limit = 200,
  ): Promise<ChatMessage[]> {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws?.token) return []
    const endpoint = ws.endpoint || this.deps.getClient()?.endpoint
    if (!endpoint) return []

    const params = new URLSearchParams({
      network: ws.id,
      type: "workspace.message",
      sort: "desc",
      limit: String(limit),
    })
    try {
      const res = await fetch(`${endpoint}/v1/events?${params}`, {
        headers: { "X-Workspace-Token": ws.token },
      })
      if (!res.ok) return []
      const body = (await res.json()) as Record<string, unknown>
      const data = (body.data || body) as { events?: unknown[] }
      const events = Array.isArray(data.events) ? data.events : []
      // The window arrives newest-first; hand back chronological order like
      // every other message read in this file.
      return events.reverse().map(eventToMessage).map(normalizeIncomingMessage)
    } catch {
      return []
    }
  }

  async listParticipants(
    workspaceId: string,
  ): Promise<Array<{ agentName: string; role: string; status: string }>> {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) return []
    const client = this.deps.getClient()
    if (!client) return []
    try {
      return await client.getAgents(ws.id, ws.token)
    } catch {
      return []
    }
  }

  // ── Polling ────────────────────────────────────────────────────

  startPolling(
    workspaceId: string,
    channelName?: string,
  ): { key: string } | null {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) return null
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    const key = `${ws.id}:${ch}`

    const existing = this._polls.get(key)
    if (existing) {
      existing.refs += 1
      return { key }
    }

    const state: ChatPollingState = {
      workspaceId: ws.id,
      channelName: ch,
      token: ws.token,
      cursor: null,
      seenIds: new Set(),
      timer: null,
      refs: 1,
      inFlight: false,
      workspace: ws,
    }
    void this._seedCursor(state)
    this._armTimer(state)
    this._polls.set(key, state)
    return { key }
  }

  stopPolling(workspaceId: string, channelName?: string): void {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) return
    const ch = channelName || DEFAULT_CHAT_CHANNEL
    const key = `${ws.id}:${ch}`
    const state = this._polls.get(key)
    if (!state) return
    state.refs -= 1
    if (state.refs <= 0) {
      if (state.timer) clearInterval(state.timer)
      this._polls.delete(key)
    }
  }

  private _pollIntervalMs(): number {
    return this._foreground ? CHAT_POLL_INTERVAL_MS : CHAT_POLL_IDLE_INTERVAL_MS
  }

  private _armTimer(state: ChatPollingState): void {
    if (state.timer) clearInterval(state.timer)
    state.timer = setInterval(
      () => void this._pollOnce(state),
      this._pollIntervalMs(),
    )
  }

  /**
   * Follow the window between foreground and background. Coming back to the
   * foreground polls immediately rather than waiting out the idle interval, so
   * re-focusing the window shows current messages at once.
   */
  setForeground(foreground: boolean): void {
    if (this._foreground === foreground) return
    this._foreground = foreground
    for (const state of this._polls.values()) {
      this._armTimer(state)
      if (foreground) void this._pollOnce(state)
    }
  }

  stopAllPolling(): void {
    for (const state of this._polls.values()) {
      if (state.timer) clearInterval(state.timer)
    }
    this._polls.clear()
  }

  private async _seedCursor(state: ChatPollingState): Promise<void> {
    const client = this.deps.getClient()
    if (!client) return
    try {
      const recent = await client.getRecentMessages(
        state.workspaceId,
        state.channelName,
        state.token,
        50,
      )
      for (const m of recent) {
        if (m.messageId) state.seenIds.add(m.messageId)
      }
      if (recent.length > 0)
        state.cursor = recent[recent.length - 1].messageId || null
    } catch {}
  }

  private async _pollOnce(state: ChatPollingState): Promise<void> {
    if (state.inFlight) return
    state.inFlight = true
    try {
      const client = this.deps.getClient()
      if (!client) return
      const messages = await client.pollMessages(
        state.workspaceId,
        state.channelName,
        state.token,
        {
          after: state.cursor || undefined,
          limit: 50,
        },
      )
      let lastId = state.cursor
      for (const m of messages) {
        if (!m.messageId || state.seenIds.has(m.messageId)) continue
        state.seenIds.add(m.messageId)
        lastId = m.messageId
        const enriched = normalizeIncomingMessage(m)
        this.deps.emit({
          type: "message",
          channel: state.channelName,
          workspaceId: state.workspaceId,
          message: enriched,
        })
        if (m.senderType !== "human") {
          touchChatSession(state.workspace, state.channelName, m.content || "")
        }
      }
      if (lastId) state.cursor = lastId
    } catch (e: unknown) {
      this.deps.emit({
        type: "error",
        channel: state.channelName,
        workspaceId: state.workspaceId,
        error: (e as Error).message,
      })
    } finally {
      state.inFlight = false
    }
  }

  // ── Sessions ───────────────────────────────────────────────────

  listSessions(workspaceId?: string): ChatSessionMeta[] {
    return listChatSessions(workspaceId)
  }

  loadSession(
    workspaceId: string,
    channelName: string,
  ): ChatSessionMeta | null {
    return loadChatSession(workspaceId, channelName)
  }

  deleteSession(workspaceId: string, channelName: string): boolean {
    return deleteChatSession(workspaceId, channelName)
  }

  clearSessions(workspaceId?: string): number {
    return clearChatSessions(workspaceId)
  }

  createSession(workspaceId: string): ChatSessionMeta {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) throw new Error("Workspace not found")
    return createChatSession(ws)
  }

  // ── Files ──────────────────────────────────────────────────────

  async uploadFile(
    workspaceId: string,
    filename: string,
    contentBase64: string,
    opts: { contentType?: string; channelName?: string } = {},
  ): Promise<{
    success: boolean
    fileId?: string
    url?: string
    filename?: string
    error?: string
  }> {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this.deps.getClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      const res = await client.uploadFile(
        ws.id,
        ws.token,
        filename,
        contentBase64,
        {
          contentType: opts.contentType || "application/octet-stream",
          source: "human:user",
          channelName: opts.channelName,
        },
      )
      // Server upload endpoint may surface the id as `id`, `file_id`, or
      // even a path-like `key` — match mcp-server.js which falls back across
      // both common names. Without a fileId here, the agent receives an
      // empty file_id in its prompt and can't access the file.
      const r = res as Record<string, unknown>
      const fileId =
        (r.id as string) ||
        (r.file_id as string) ||
        (r.fileId as string) ||
        (r.key as string) ||
        undefined
      return {
        success: true,
        fileId,
        url: (r.url as string) || undefined,
        filename: (r.filename as string) || filename,
      }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }

  async listFiles(
    workspaceId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<unknown> {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) return { files: [] }
    const client = this.deps.getClient()
    if (!client) return { files: [] }
    try {
      return await client.listFiles(ws.id, ws.token, opts)
    } catch {
      return { files: [] }
    }
  }

  async readFile(
    workspaceId: string,
    fileId: string,
  ): Promise<{ success: boolean; contentBase64?: string; error?: string }> {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this.deps.getClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      const buf = await client.readFile(ws.id, ws.token, fileId)
      return {
        success: true,
        contentBase64: Buffer.from(buf).toString("base64"),
      }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }

  async deleteFile(
    workspaceId: string,
    fileId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const ws = this.deps.resolveWorkspace(workspaceId)
    if (!ws) return { success: false, error: "Workspace not found" }
    const client = this.deps.getClient()
    if (!client)
      return { success: false, error: "Workspace client unavailable" }
    try {
      await client.deleteFile(ws.id, ws.token, fileId)
      return { success: true }
    } catch (e: unknown) {
      return { success: false, error: (e as Error).message }
    }
  }
}
