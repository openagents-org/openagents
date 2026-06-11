import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useChatStore, channelKey } from '../../store/chat'
import { useWorkspacesStore } from '../../store/workspaces'
import type {
  Attachment,
  ChatMessage,
  ChatStreamEvent,
  Workspace,
} from '../../types'
import MessageList from '../../components/chat/MessageList'
import MessageInput from '../../components/chat/MessageInput'
import SessionList from '../../components/chat/SessionList'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import type { ToastType } from '../../hooks/useToast'

interface ChatPageProps {
  showToast: (msg: string, type?: ToastType) => void
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error || new Error('read error'))
    reader.readAsDataURL(file)
  })
}

function triggerDownload(filename: string, base64: string, mime = 'application/octet-stream'): void {
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const blob = new Blob([bytes], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch {}
}

export default function ChatPage({ showToast }: ChatPageProps): React.JSX.Element {
  const { workspaces, setWorkspaces } = useWorkspacesStore(
    useShallow((s) => ({ workspaces: s.workspaces, setWorkspaces: s.setWorkspaces })),
  )

  const {
    active, setActive,
    messages, setMessages, appendMessage, clearMessages,
    pendingMessages, addPending, removePending,
    thinkingAgents,
    sessions, setSessions,
    participants, setParticipants,
  } = useChatStore(useShallow((s) => ({
    active: s.active,
    setActive: s.setActive,
    messages: s.messages,
    setMessages: s.setMessages,
    appendMessage: s.appendMessage,
    clearMessages: s.clearMessages,
    pendingMessages: s.pendingMessages,
    addPending: s.addPending,
    removePending: s.removePending,
    thinkingAgents: s.thinkingAgents,
    sessions: s.sessions,
    setSessions: s.setSessions,
    participants: s.participants,
    setParticipants: s.setParticipants,
  })))

  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [clearAllOpen, setClearAllOpen] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<{
    workspaceId: string
    channelName: string
  } | null>(null)
  const [deletingSession, setDeletingSession] = useState(false)
  const subscribedKeyRef = useRef<{ workspaceId: string; channelName: string } | null>(null)

  const activeKey = active ? channelKey(active.workspaceId, active.channelName) : null
  const activeMessages = useMemo<ChatMessage[]>(
    () => (activeKey ? messages[activeKey] || [] : []),
    [messages, activeKey],
  )
  const activePending = useMemo<ChatMessage[]>(
    () => (activeKey ? pendingMessages[activeKey] || [] : []),
    [pendingMessages, activeKey],
  )
  const activeThinking = useMemo<string[]>(() => {
    if (!activeKey) return []
    const set = thinkingAgents[activeKey]
    return set ? Array.from(set) : []
  }, [thinkingAgents, activeKey])

  // Load workspaces once
  const refreshWorkspaces = useCallback(async () => {
    try {
      const list = await window.api.listWorkspaces()
      setWorkspaces(list)
      if (!selectedWorkspaceId && list.length > 0) {
        setSelectedWorkspaceId(list[0].id)
      }
    } catch {}
  }, [setWorkspaces, selectedWorkspaceId])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  // Load sessions
  const refreshSessions = useCallback(async () => {
    try {
      const list = await window.api.sessionList()
      setSessions(list)
    } catch {}
  }, [setSessions])

  useEffect(() => {
    void refreshSessions()
    const t = setInterval(refreshSessions, 5000)
    return () => clearInterval(t)
  }, [refreshSessions])

  // Subscribe to chat events globally
  useEffect(() => {
    const unsub = window.api.onChatEvent((ev: ChatStreamEvent) => {
      const key = `${ev.workspaceId}:${ev.channel}`
      if (ev.type === 'message') {
        appendMessage(key, ev.message)
        // If this is our own optimistic message echoed back, drop the pending copy.
        if (ev.message.senderType === 'human') {
          // Best-effort: clear all pending entries — server message arrived
          for (const p of (useChatStore.getState().pendingMessages[key] || [])) {
            removePending(key, p.messageId)
          }
        }
      } else if (ev.type === 'error') {
        showToast(`Chat error: ${ev.error}`, 'error')
      }
    })
    return () => { if (typeof unsub === 'function') unsub() }
  }, [appendMessage, removePending, showToast])

  // Activate a channel: load history + start polling
  const activate = useCallback(async (workspaceId: string, channelName: string) => {
    const ws = workspaces.find((w) => w.id === workspaceId || w.slug === workspaceId)
    const newActive = { workspaceId, channelName, workspaceName: ws?.name || ws?.slug }

    // Unsubscribe from previous channel
    const prev = subscribedKeyRef.current
    if (prev && (prev.workspaceId !== workspaceId || prev.channelName !== channelName)) {
      try { await window.api.chatStopPolling(prev.workspaceId, prev.channelName) } catch {}
    }
    subscribedKeyRef.current = { workspaceId, channelName }

    setActive(newActive)
    setLoadingMessages(true)
    try {
      const [history, parts] = await Promise.all([
        window.api.chatGetMessages(workspaceId, channelName, 100),
        window.api.chatListParticipants(workspaceId),
      ])
      setMessages(channelKey(workspaceId, channelName), history)
      setParticipants(workspaceId, parts)
    } catch (e: unknown) {
      showToast(`Failed to load chat: ${(e as Error).message}`, 'error')
    } finally {
      setLoadingMessages(false)
    }
    try { await window.api.chatStartPolling(workspaceId, channelName) } catch {}
  }, [workspaces, setActive, setMessages, setParticipants, showToast])

  // Cleanup on unmount: stop polling
  useEffect(() => {
    return () => {
      const prev = subscribedKeyRef.current
      if (prev) window.api.chatStopPolling(prev.workspaceId, prev.channelName).catch(() => {})
    }
  }, [])

  const handleSend = async (content: string, attachments: Attachment[]): Promise<void> => {
    if (!active) {
      showToast('Select a workspace first', 'warning')
      return
    }
    const key = channelKey(active.workspaceId, active.channelName)
    const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimistic: ChatMessage = {
      messageId: tempId,
      sessionId: active.channelName,
      senderType: 'human',
      senderName: 'user',
      content,
      attachments,
      createdAt: new Date().toISOString(),
    }
    addPending(key, optimistic)
    try {
      const result = await window.api.chatSendMessage({
        workspaceId: active.workspaceId,
        channelName: active.channelName,
        content,
        attachments,
      })
      if (!result.success) {
        // Send failed — drop the optimistic copy and surface the error.
        removePending(key, tempId)
        showToast(`Send failed: ${result.error}`, 'error')
        return
      }
      // Send succeeded — keep the optimistic message visible until polling
      // (~2.5s) echoes the canonical server copy back. The onChatEvent handler
      // clears matching pending entries when human messages arrive. As a safety
      // net, drop the pending after 15s in case polling never delivers it.
      setTimeout(() => removePending(key, tempId), 15_000)
    } catch (e: unknown) {
      removePending(key, tempId)
      showToast(`Send error: ${(e as Error).message}`, 'error')
    }
  }

  const handleUpload = async (file: File): Promise<Attachment | null> => {
    if (!active) {
      showToast('Select a workspace first', 'warning')
      return null
    }
    try {
      const base64 = await fileToBase64(file)
      const res = await window.api.chatUploadFile(active.workspaceId, file.name, base64, {
        contentType: file.type || 'application/octet-stream',
        channelName: active.channelName,
      })
      if (res.success) {
        if (!res.fileId) {
          // Upload technically succeeded but the server didn't return a
          // file_id — agents won't be able to read the attachment.
          showToast(`Uploaded ${file.name} but no file_id was returned; agents may not be able to access it.`, 'warning')
        }
        return { fileId: res.fileId, filename: res.filename || file.name, contentType: file.type, size: file.size, url: res.url }
      }
      showToast(`Upload failed: ${res.error}`, 'error')
      return null
    } catch (e: unknown) {
      showToast(`Upload error: ${(e as Error).message}`, 'error')
      return null
    }
  }

  const handleDownload = async (fileId: string, filename: string): Promise<void> => {
    if (!active) return
    try {
      const res = await window.api.chatReadFile(active.workspaceId, fileId)
      if (res.success && res.contentBase64) {
        triggerDownload(filename, res.contentBase64)
      } else {
        showToast(`Download failed: ${res.error || 'unknown error'}`, 'error')
      }
    } catch (e: unknown) {
      showToast(`Download error: ${(e as Error).message}`, 'error')
    }
  }

  const handleSelectSession = (workspaceId: string, channelName: string): void => {
    setSelectedWorkspaceId(workspaceId)
    void activate(workspaceId, channelName)
  }

  const handleNewChat = async (): Promise<void> => {
    if (!selectedWorkspaceId) return
    try {
      const session = await window.api.sessionCreate(selectedWorkspaceId)
      setSelectedWorkspaceId(session.workspaceId)
      await refreshSessions()
      await activate(session.workspaceId, session.channelName)
    } catch (e: unknown) {
      showToast(`New chat failed: ${(e as Error).message}`, 'error')
    }
  }

  const requestDeleteSession = (workspaceId: string, channelName: string): void => {
    setDeleteSessionTarget({ workspaceId, channelName })
  }

  const performDeleteSession = async (): Promise<void> => {
    if (!deleteSessionTarget) return
    const { workspaceId, channelName } = deleteSessionTarget
    setDeletingSession(true)
    try {
      await window.api.sessionDelete(workspaceId, channelName)
      void refreshSessions()
      const key = channelKey(workspaceId, channelName)
      clearMessages(key)
      if (active && active.workspaceId === workspaceId && active.channelName === channelName) {
        setActive(null)
        if (subscribedKeyRef.current?.workspaceId === workspaceId && subscribedKeyRef.current?.channelName === channelName) {
          try { await window.api.chatStopPolling(workspaceId, channelName) } catch {}
          subscribedKeyRef.current = null
        }
      }
    } catch (e: unknown) {
      showToast(`Delete failed: ${(e as Error).message}`, 'error')
    } finally {
      setDeletingSession(false)
      setDeleteSessionTarget(null)
    }
  }

  const requestClearAll = (): void => {
    if (!selectedWorkspaceId) return
    setClearAllOpen(true)
  }

  const performClearAll = async (): Promise<void> => {
    if (!selectedWorkspaceId) return
    setClearingAll(true)
    try {
      const removed = await window.api.sessionClear(selectedWorkspaceId)

      // Reset the right panel if it was showing a session under this workspace.
      if (active && active.workspaceId === selectedWorkspaceId) {
        const key = channelKey(active.workspaceId, active.channelName)
        clearMessages(key)
        setActive(null)
        if (subscribedKeyRef.current) {
          try { await window.api.chatStopPolling(subscribedKeyRef.current.workspaceId, subscribedKeyRef.current.channelName) } catch {}
          subscribedKeyRef.current = null
        }
      }

      showToast(`Cleared ${removed} session${removed === 1 ? '' : 's'}`, 'success')
      void refreshSessions()
    } catch (e: unknown) {
      showToast(`Clear failed: ${(e as Error).message}`, 'error')
    } finally {
      setClearingAll(false)
      setClearAllOpen(false)
    }
  }

  const activeWorkspace: Workspace | undefined =
    active ? workspaces.find((w) => w.id === active.workspaceId || w.slug === active.workspaceId) : undefined

  const activeParticipants = active ? participants[active.workspaceId] || [] : []

  return (
    <div className="flex flex-1 min-h-0">
      <SessionList
        workspaces={workspaces}
        sessions={sessions}
        activeKey={activeKey}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={(id) => {
          setSelectedWorkspaceId(id)
        }}
        onSelectSession={handleSelectSession}
        onDeleteSession={requestDeleteSession}
        onClearAll={requestClearAll}
        onNewChat={handleNewChat}
      />

      <section className="flex-1 min-w-0 flex flex-col bg-(--bg-primary)">
        <header className="px-5 py-3.5 border-b border-(--border) bg-(--bg-card) flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold m-0 truncate text-(--text-primary)">
              {active
                ? activeWorkspace?.name || activeWorkspace?.slug || active.workspaceId
                : 'No chat selected'}
            </h2>
            <div className="text-[11px] text-(--text-tertiary) mt-1">
              {active
                ? activeParticipants.length > 0
                  ? <>
                      <span className="text-(--success-text) font-medium">
                        {activeParticipants.filter((p) => p.status === 'online').length}
                      </span>
                      {` of ${activeParticipants.length} agent${activeParticipants.length === 1 ? '' : 's'} online · #${active.channelName}`}
                    </>
                  : <>No agents joined yet · #{active.channelName}</>
                : 'Pick a workspace and start a new chat to talk with your agents'}
            </div>
          </div>
          {activeParticipants.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[60%]">
              {activeParticipants.slice(0, 4).map((p) => (
                <span
                  key={p.agentName}
                  title={`${p.agentName} (${p.status})`}
                  className="text-[11px] px-2 py-1 rounded-full bg-(--bg-input) flex items-center gap-1.5"
                >
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${
                      p.status === 'online' ? 'bg-(--success)' : 'bg-(--text-tertiary)'
                    }`}
                  />
                  <span className="text-(--text-primary)">{p.agentName}</span>
                </span>
              ))}
              {activeParticipants.length > 4 && (
                <span className="text-[11px] text-(--text-tertiary) px-1.5">
                  +{activeParticipants.length - 4}
                </span>
              )}
            </div>
          )}
        </header>

        {loadingMessages && active ? (
          <div className="flex-1 flex items-center justify-center text-(--text-tertiary) text-[12px]">Loading messages…</div>
        ) : active ? (
          <MessageList
            messages={activeMessages}
            pending={activePending}
            thinkingAgents={activeThinking}
            onDownloadAttachment={handleDownload}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-6">
            <div className="w-14 h-14 rounded-full bg-(--accent-bg) text-(--accent) flex items-center justify-center">
              <Bot className="w-7 h-7" />
            </div>
            <h3 className="text-[15px] font-semibold m-0">Chat with your agents</h3>
            <p className="text-[12px] text-(--text-secondary) max-w-[420px]">
              Pick a workspace on the left, then click <strong>+ New chat</strong> to open the default <code>#main</code> channel,
              or open any previous session.
            </p>
          </div>
        )}

        <MessageInput
          participants={activeParticipants}
          disabled={!active}
          onSend={handleSend}
          onUpload={handleUpload}
        />
      </section>

      <ConfirmDialog
        open={!!deleteSessionTarget}
        title="Delete this chat session?"
        description={
          deleteSessionTarget
            ? `Removes the local session for #${deleteSessionTarget.channelName}. Server-side messages are kept.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        busy={deletingSession}
        onCancel={() => {
          if (!deletingSession) setDeleteSessionTarget(null)
        }}
        onConfirm={performDeleteSession}
      />

      <ConfirmDialog
        open={clearAllOpen}
        title="Clear all chat sessions?"
        description="Clears every local session for this workspace. Server-side messages are kept; only the local session list is cleared."
        confirmLabel="Clear all"
        destructive
        busy={clearingAll}
        onCancel={() => {
          if (!clearingAll) setClearAllOpen(false)
        }}
        onConfirm={performClearAll}
      />
    </div>
  )
}
