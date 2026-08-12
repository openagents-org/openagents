/** Shapes shared by the workspace chat: what the renderer sees over IPC. */

export interface ChatToolCall {
  id: string
  name: string
  category?:
    | "workspace"
    | "files"
    | "browser"
    | "tunnel"
    | "todos"
    | "timers"
    | "terminal"
    | "other"
  status: "pending" | "success" | "error"
  args?: unknown
  result?: unknown
  durationMs?: number
}

export interface ChatAttachment {
  fileId?: string
  filename?: string
  contentType?: string
  size?: number
  url?: string
}

export interface ChatMessage {
  messageId: string
  sessionId: string
  senderType: "human" | "agent" | "system"
  senderName: string
  content: string
  mentions?: string[]
  messageType?: string
  metadata?: Record<string, unknown>
  attachments?: ChatAttachment[]
  createdAt?: string
  toolCalls?: ChatToolCall[]
}

export interface ChatSessionMeta {
  id: string
  workspaceId: string
  workspaceSlug?: string
  workspaceName?: string
  channelName: string
  title: string
  lastMessageAt: string | null
  lastMessagePreview: string | null
  messageCount: number
  participants: string[]
  createdAt: string
}

export interface SendMessageInput {
  workspaceId: string
  channelName?: string
  agentId?: string
  content: string
  mentions?: string[]
  attachments?: ChatAttachment[]
}

export interface SendMessageResult {
  success: boolean
  messageId: string
  error?: string
}

export type ChatStreamEvent =
  | {
      type: "message"
      channel: string
      workspaceId: string
      message: ChatMessage
    }
  | {
      type: "agent-status"
      channel: string
      workspaceId: string
      agentName: string
      status: "thinking" | "idle" | "error"
      detail?: string
    }
  | { type: "error"; channel: string; workspaceId: string; error: string }

/** A workspace as chat needs it: where to talk, and with which token. */
export interface WorkspaceConfig {
  id: string
  slug: string
  name?: string
  endpoint?: string
  token: string
}

/** The slice of the core's workspace client the chat service uses. */
export interface WorkspaceChatClient {
  endpoint?: string
  sendMessage: (
    workspaceId: string,
    channelName: string,
    token: string,
    content: string,
    opts?: Record<string, unknown>,
  ) => Promise<{ id?: string }>
  pollMessages: (
    workspaceId: string,
    channelName: string,
    token: string,
    opts?: { after?: string; limit?: number },
  ) => Promise<ChatMessage[]>
  getRecentMessages: (
    workspaceId: string,
    channelName: string,
    token: string,
    limit?: number,
  ) => Promise<ChatMessage[]>
  getAgents: (
    workspaceId: string,
    token: string,
  ) => Promise<Array<{ agentName: string; role: string; status: string }>>
  uploadFile: (
    workspaceId: string,
    token: string,
    filename: string,
    contentBase64: string,
    opts?: Record<string, unknown>,
  ) => Promise<{ id?: string; url?: string; filename?: string }>
  listFiles: (
    workspaceId: string,
    token: string,
    opts?: { limit?: number; offset?: number },
  ) => Promise<unknown>
  readFile: (
    workspaceId: string,
    token: string,
    fileId: string,
  ) => Promise<Buffer>
  deleteFile: (
    workspaceId: string,
    token: string,
    fileId: string,
  ) => Promise<unknown>
}
