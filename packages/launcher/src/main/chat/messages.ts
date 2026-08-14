/** Translating between the workspace API's wire shapes and the renderer's. */
import type { ChatAttachment, ChatMessage, ChatToolCall } from "./types"

export function classifyTool(name: string): ChatToolCall["category"] {
  const n = (name || "").toLowerCase()
  if (n.includes("browser")) return "browser"
  if (n.includes("file")) return "files"
  if (n.includes("tunnel")) return "tunnel"
  if (n.includes("todo")) return "todos"
  if (n.includes("timer")) return "timers"
  if (
    n.includes("shell") ||
    n.includes("exec") ||
    n.includes("terminal") ||
    n.includes("bash")
  )
    return "terminal"
  if (n.includes("workspace")) return "workspace"
  return "other"
}

// The agent adapters (see agent-connector/src/adapters/utils.js
// formatAttachmentsForPrompt) read attachments in camelCase — they look up
// att.fileId, att.contentType. The workspace API stores attachments verbatim
// and replays them through _eventToMessage. So we MUST send camelCase end to
// end. Snake_case here would land in the agent prompt as an empty file_id,
// which is the literal bug the user reported.
export function attachmentsToServer(
  attachments?: ChatAttachment[],
): unknown[] | undefined {
  if (!attachments || attachments.length === 0) return undefined
  return attachments.map((a) => {
    const out: Record<string, unknown> = {}
    if (a.fileId) out.fileId = a.fileId
    if (a.filename) out.filename = a.filename
    if (a.contentType) out.contentType = a.contentType
    if (typeof a.size === "number") out.size = a.size
    if (a.url) out.url = a.url
    return out
  })
}

// Defensive: tolerate either casing on the way in (older messages, future
// schema changes) and normalize to camelCase for the renderer.
export function attachmentsFromServer(
  raw: unknown,
): ChatAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  return raw.map((entry) => {
    const e = (entry || {}) as Record<string, unknown>
    return {
      fileId:
        (e.fileId as string) ||
        (e.file_id as string) ||
        (e.id as string) ||
        undefined,
      filename: (e.filename as string) || (e.name as string) || undefined,
      contentType:
        (e.contentType as string) || (e.content_type as string) || undefined,
      size: typeof e.size === "number" ? e.size : undefined,
      url: (e.url as string) || undefined,
    }
  })
}

export function normalizeIncomingMessage(m: ChatMessage): ChatMessage {
  return {
    ...m,
    attachments: m.attachments
      ? attachmentsFromServer(m.attachments)
      : undefined,
    toolCalls: extractToolCalls(m),
  }
}

/**
 * A raw workspace event as a ChatMessage. Mirrors the connector client's own
 * mapping, which is only reachable through its channel-scoped readers — see
 * `getWorkspaceMessages`, which has to query /v1/events itself.
 */
export function eventToMessage(raw: unknown): ChatMessage {
  const e = (raw || {}) as Record<string, unknown>
  const payload = (e.payload || {}) as Record<string, unknown>
  const source = (e.source as string) || ""
  const target = (e.target as string) || ""
  const ts = e.timestamp as string | number | undefined
  return {
    messageId: (e.id as string) || "",
    sessionId: target.startsWith("channel/")
      ? target.replace("channel/", "")
      : target,
    senderType: source.startsWith("human:") ? "human" : "agent",
    // Prefer the sender's own display name. `source` is a stable identity
    // rather than a label — a message bridged in from Slack carries
    // `human:slack:T123:U456`, which would show in the chat as a raw user id.
    senderName:
      (payload.sender_name as string) ||
      source.replace("openagents:", "").replace("human:", ""),
    content: (payload.content as string) || (e.content as string) || "",
    mentions: (payload.mentions as string[]) || [],
    messageType: (payload.message_type as string) || "chat",
    metadata: (e.metadata as Record<string, unknown>) || {},
    attachments: payload.attachments as ChatMessage["attachments"],
    createdAt: ts ? new Date(ts).toISOString() : undefined,
  }
}

export function extractToolCalls(msg: ChatMessage): ChatToolCall[] | undefined {
  const meta = (msg.metadata || {}) as Record<string, unknown>
  const raw =
    (meta.tool_calls as unknown[] | undefined) ||
    (meta.toolCalls as unknown[] | undefined) ||
    undefined
  if (!Array.isArray(raw) || raw.length === 0) return undefined

  return raw.map((entry, i) => {
    const e = (entry || {}) as Record<string, unknown>
    const name = (e.name as string) || (e.tool as string) || `tool_${i}`
    const status =
      (e.status as ChatToolCall["status"]) ||
      (e.error ? "error" : e.result !== undefined ? "success" : "pending")
    return {
      id: (e.id as string) || `${msg.messageId}:${i}`,
      name,
      category: classifyTool(name),
      status,
      args: e.args ?? e.arguments,
      result: e.result ?? e.error,
      durationMs:
        typeof e.duration_ms === "number"
          ? e.duration_ms
          : typeof e.durationMs === "number"
            ? e.durationMs
            : undefined,
    }
  })
}

export function extractMentions(text: string): string[] {
  const out: string[] = []
  const re = /(^|\s)@([a-zA-Z0-9_-]+)/g
  let match = re.exec(text)
  while (match !== null) {
    if (!out.includes(match[2])) out.push(match[2])
    match = re.exec(text)
  }
  return out
}
