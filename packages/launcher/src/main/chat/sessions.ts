/**
 * Chat session metadata on disk — one JSON file per workspace/channel under
 * ~/.openagents/launcher-sessions. It is a local index for the sidebar (title,
 * last message, count); the messages themselves live in the workspace.
 */
import path from "path"
import fs from "fs"
import crypto from "crypto"
import { LAUNCHER_SESSIONS_DIR, ensureDir } from "../agents/paths"
import type { ChatSessionMeta, WorkspaceConfig } from "./types"

export function sessionFilePath(
  workspaceId: string,
  channelName: string,
): string {
  return path.join(LAUNCHER_SESSIONS_DIR, workspaceId, `${channelName}.json`)
}

/** Every saved session, newest activity first; optionally one workspace only. */
export function listChatSessions(workspaceId?: string): ChatSessionMeta[] {
  ensureDir(LAUNCHER_SESSIONS_DIR)
  const out: ChatSessionMeta[] = []
  let wsDirs: string[]
  try {
    wsDirs = fs.readdirSync(LAUNCHER_SESSIONS_DIR)
  } catch {
    return []
  }
  for (const wsDir of wsDirs) {
    if (workspaceId && wsDir !== workspaceId) continue
    const dir = path.join(LAUNCHER_SESSIONS_DIR, wsDir)
    let files: string[]
    try {
      files = fs.readdirSync(dir)
    } catch {
      continue
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue
      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(dir, f), "utf-8"),
        ) as ChatSessionMeta
        out.push(data)
      } catch {}
    }
  }
  out.sort((a, b) => {
    const ta = a.lastMessageAt ? Date.parse(a.lastMessageAt) : 0
    const tb = b.lastMessageAt ? Date.parse(b.lastMessageAt) : 0
    return tb - ta
  })
  return out
}

export function loadChatSession(
  workspaceId: string,
  channelName: string,
): ChatSessionMeta | null {
  try {
    return JSON.parse(
      fs.readFileSync(sessionFilePath(workspaceId, channelName), "utf-8"),
    ) as ChatSessionMeta
  } catch {
    return null
  }
}

export function deleteChatSession(
  workspaceId: string,
  channelName: string,
): boolean {
  try {
    fs.unlinkSync(sessionFilePath(workspaceId, channelName))
    return true
  } catch {
    return false
  }
}

export function clearChatSessions(workspaceId?: string): number {
  let removed = 0
  for (const s of listChatSessions(workspaceId)) {
    if (deleteChatSession(s.workspaceId, s.channelName)) removed++
  }
  return removed
}

/** A fresh channel in this workspace, with a name nothing else has taken. */
export function createChatSession(ws: WorkspaceConfig): ChatSessionMeta {
  const dir = path.join(LAUNCHER_SESSIONS_DIR, ws.id)
  ensureDir(dir)

  let channelName = ""
  let file = ""
  do {
    channelName = `chat-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    file = path.join(dir, `${channelName}.json`)
  } while (fs.existsSync(file))

  const now = new Date().toISOString()
  const meta: ChatSessionMeta = {
    id: `${ws.id}:${channelName}`,
    workspaceId: ws.id,
    workspaceSlug: ws.slug,
    workspaceName: ws.name,
    channelName,
    title: ws.name || ws.slug || channelName,
    lastMessageAt: null,
    lastMessagePreview: null,
    messageCount: 0,
    participants: [],
    createdAt: now,
  }

  fs.writeFileSync(file, JSON.stringify(meta, null, 2), "utf-8")
  return meta
}

/** Record activity on a session, creating its file if this is the first message. */
export function touchChatSession(
  ws: WorkspaceConfig,
  channelName: string,
  preview: string,
): void {
  try {
    const dir = path.join(LAUNCHER_SESSIONS_DIR, ws.id)
    ensureDir(dir)
    const file = path.join(dir, `${channelName}.json`)
    const existing: ChatSessionMeta | null = (() => {
      try {
        return JSON.parse(fs.readFileSync(file, "utf-8")) as ChatSessionMeta
      } catch {
        return null
      }
    })()
    const now = new Date().toISOString()
    const cleaned = preview.replace(/\s+/g, " ").trim().slice(0, 140)
    const meta: ChatSessionMeta = {
      id: `${ws.id}:${channelName}`,
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      workspaceName: ws.name,
      channelName,
      title: existing?.title || ws.name || ws.slug || channelName,
      lastMessageAt: now,
      lastMessagePreview: cleaned || existing?.lastMessagePreview || null,
      messageCount: (existing?.messageCount || 0) + 1,
      participants: existing?.participants || [],
      createdAt: existing?.createdAt || now,
    }
    fs.writeFileSync(file, JSON.stringify(meta, null, 2), "utf-8")
  } catch {}
}
