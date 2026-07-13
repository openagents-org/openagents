'use client';

import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { ChatMessages } from './chat-messages';
import { ChatInput, type PendingFile } from './chat-input';
import { ThreadStatusBar } from './thread-status-bar';
import { EmptyState } from './empty-state';
import { useWorkspace } from '@/lib/workspace-context';
import { useMessagePolling } from '@/hooks/use-polling';
import { useComposingSignal } from '@/hooks/use-composing-signal';
import { workspaceApi } from '@/lib/api';
import { capture } from '@/lib/analytics';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ListTree, MessageSquare, CalendarClock, Square, ChevronLeft, X, Plus, Globe, Share2, Crown, AlertTriangle, Sparkles } from 'lucide-react';
import { ShareDialog } from './share-dialog';
import { OrchestrationControl } from './orchestration-control';
import { useLayout } from '@/components/layout/layout-context';
import { cn } from '@/lib/utils';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { CreateRoutineDialog } from '@/components/routines/create-routine-dialog';
import { eventToMessage } from '@/lib/types';
import type { WorkspaceMessage } from '@/lib/types';

// Module-level message cache — survives component re-renders/unmounts.
// Keyed by sessionId, stores the last known messages for instant thread switching.
const messageCache = new Map<string, WorkspaceMessage[]>();
const CACHE_MAX_SESSIONS = 10;
// Track last seen message ID per cached session for incremental refresh
const cacheLastSeenId = new Map<string, string>();

function parseDMSession(sessionId: string | null): [string, string] | null {
  if (!sessionId?.startsWith('dm:')) return null;
  const parts = sessionId.slice(3).split(',', 2);
  if (parts.length === 2) return [parts[0], parts[1]];
  return null;
}

function normalizeAgentAddress(address: string): string {
  return address.replace(/^openagents:/, '');
}

/** Condense an agent description down to a few words for the roster bar. */
function shortDescription(desc: string | null, maxWords = 8): string {
  if (!desc) return '';
  const clean = desc.trim().replace(/\s+/g, ' ');
  const words = clean.split(' ');
  if (words.length <= maxWords) return clean;
  return words.slice(0, maxWords).join(' ') + '…';
}

function messagesForSession(sessionId: string, msgs: WorkspaceMessage[]): WorkspaceMessage[] {
  const dmPair = parseDMSession(sessionId);
  return msgs.flatMap((msg) => {
    const belongsToSession = dmPair
      ? msg.sessionId === sessionId ||
        dmPair.includes(msg.sessionId) ||
        dmPair.map(normalizeAgentAddress).includes(normalizeAgentAddress(msg.sessionId))
      : msg.sessionId === sessionId;
    if (!belongsToSession) return [];
    return dmPair ? [{ ...msg, sessionId }] : [msg];
  });
}

function cacheMessages(sessionId: string, msgs: WorkspaceMessage[]) {
  const scopedMessages = messagesForSession(sessionId, msgs);
  messageCache.set(sessionId, scopedMessages);
  if (scopedMessages.length > 0) {
    cacheLastSeenId.set(sessionId, scopedMessages[scopedMessages.length - 1].messageId);
  } else {
    cacheLastSeenId.delete(sessionId);
  }
  // Evict oldest entries if cache grows too large
  if (messageCache.size > CACHE_MAX_SESSIONS) {
    const oldest = messageCache.keys().next().value;
    if (oldest) {
      messageCache.delete(oldest);
      cacheLastSeenId.delete(oldest);
    }
  }
}

const PREFETCH_COUNT = 6;
const CACHE_REFRESH_INTERVAL = 5_000; // refresh caches every 5s

/** Fetch recent messages for a session (cache prefetch). */
async function fetchSessionMessages(sessionId: string): Promise<WorkspaceMessage[]> {
  try {
    const result = await workspaceApi.loadMessageHistory(sessionId, { limit: 50 });
    // Events come newest-first from sort=desc, reverse for chronological display
    return messagesForSession(sessionId, result.events.map(eventToMessage)).reverse();
  } catch {
    return [];
  }
}

/** Incrementally refresh a cached session — fetch only new messages since last seen. */
async function refreshCachedSession(sessionId: string): Promise<void> {
  const lastId = cacheLastSeenId.get(sessionId);
  if (!lastId) {
    // No cache yet — do full fetch
    const msgs = await fetchSessionMessages(sessionId);
    cacheMessages(sessionId, msgs);
    return;
  }
  try {
    const result = await workspaceApi.pollMessages(sessionId, lastId);
    const scopedMessages = messagesForSession(sessionId, result.messages);
    if (scopedMessages.length > 0) {
      const existing = messageCache.get(sessionId) || [];
      const existingIds = new Set(existing.map((m) => m.messageId));
      const unique = scopedMessages.filter((m) => !existingIds.has(m.messageId));
      if (unique.length > 0) {
        cacheMessages(sessionId, [...existing, ...unique]);
      }
    }
  } catch {
    // Best-effort
  }
}

export function ChatView() {
  const { agents, currentUser, currentSessionId, sessions, updateLastMessage, setSessionActive, updateAgentMode, stopAllAgents, activeSessionIds, stoppingSessionIds, renameSession, addParticipant, removeParticipant, setSessionMaster, setSessionOrchestration, consumeSkipFocus, createRoutine, knowledge } = useWorkspace();
  const [showCreateRoutine, setShowCreateRoutine] = useState(false);
  const {
    isMobile,
    openMobileList,
    viewMode,
    splitBrowser,
    setSplitBrowser,
    showBrowserPreview,
    setShowBrowserPreview,
    openNewThread,
    setSelectedAgentName,
  } = useLayout();

  // Continuously refresh message caches for top recent sessions in the background.
  // This ensures clicking any recent thread shows messages instantly and up-to-date.
  const currentSessionIdRef = useRef<string | null>(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  useEffect(() => {
    if (sessions.length === 0) return;

    const getTopSessions = () =>
      [...sessions]
        .filter((s) => s.status === 'active')
        .sort((a, b) => {
          const aTime = a.lastEventAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const bTime = b.lastEventAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return bTime - aTime;
        })
        .slice(0, PREFETCH_COUNT);

    // Initial fetch — staggered
    const initial = getTopSessions();
    initial.forEach((s, i) => {
      if (!messageCache.has(s.sessionId)) {
        setTimeout(() => fetchSessionMessages(s.sessionId).then((msgs) => {
          if (msgs.length > 0) cacheMessages(s.sessionId, msgs);
        }), i * 300);
      }
    });

    // Periodic incremental refresh — skip the session the user is currently viewing
    // (useMessagePolling handles that one)
    const interval = setInterval(async () => {
      const top = getTopSessions();
      for (const s of top) {
        if (s.sessionId === currentSessionIdRef.current) continue;
        await refreshCachedSession(s.sessionId);
      }
    }, CACHE_REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [sessions]);

  // Look up cached messages for the current session (read once per session switch)
  const initialMessagesRef = useRef<WorkspaceMessage[] | undefined>(undefined);
  const initialMessagesSessionRef = useRef<string | null>(null);
  if (currentSessionId !== initialMessagesSessionRef.current) {
    initialMessagesRef.current = currentSessionId
      ? messagesForSession(currentSessionId, messageCache.get(currentSessionId) || [])
      : undefined;
    initialMessagesSessionRef.current = currentSessionId;
  }

  const { messages, loading, forceRefresh, generation, loadOlder, hasOlder, loadingOlder } = useMessagePolling({
    sessionId: currentSessionId,
    initialMessages: initialMessagesRef.current,
  });
  const { notifyFocus, notifyBlur, notifyTyping } = useComposingSignal(currentSessionId);
  const [showAllSteps, setShowAllSteps] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Optimistic message state for instant feedback
  const [optimisticMessages, setOptimisticMessages] = useState<WorkspaceMessage[]>([]);
  // scrollKey triggers scroll-to-bottom: incremented on user send + backfill completion
  const [scrollKey, setScrollKey] = useState(0);
  const [focusKey, setFocusKey] = useState(0);

  // Scroll to bottom when backfill replaces messages (generation changes)
  useEffect(() => {
    if (generation > 0) setScrollKey((k) => k + 1);
  }, [generation]);

  const sessionMessages = useMemo(
    () => currentSessionId ? messagesForSession(currentSessionId, messages) : [],
    [currentSessionId, messages]
  );

  // Per-thread message drafts
  const draftsRef = useRef<Record<string, string>>({});
  const [currentDraft, setCurrentDraft] = useState('');

  // Save/restore draft when switching threads + cache messages
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    // Save draft and messages from previous session
    if (prevSessionIdRef.current && prevSessionIdRef.current !== currentSessionId) {
      draftsRef.current[prevSessionIdRef.current] = currentDraft;
      // Cache messages for instant switching back
      if (messages.length > 0) {
        cacheMessages(prevSessionIdRef.current, messages);
      }
    }
    // Restore draft for new session
    setCurrentDraft(currentSessionId ? (draftsRef.current[currentSessionId] ?? '') : '');
    prevSessionIdRef.current = currentSessionId;
    // Clear optimistic messages when switching sessions
    setOptimisticMessages([]);
    // Focus the input when switching threads — unless the switch was made
    // via a keyboard shortcut (e.g. 1-9 from the sidebar), in which case
    // the user wanted to navigate, not start typing.
    if (currentSessionId && !consumeSkipFocus()) setFocusKey((k) => k + 1);
  }, [currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep cache updated with latest messages for the current session
  useEffect(() => {
    if (currentSessionId) {
      cacheMessages(currentSessionId, messages);
    }
  }, [currentSessionId, messages]);

  const handleDraftChange = useCallback((draft: string) => {
    setCurrentDraft(draft);
    if (currentSessionId) {
      draftsRef.current[currentSessionId] = draft;
    }
    notifyTyping();
  }, [currentSessionId, notifyTyping]);

  const isDM = currentSessionId?.startsWith('dm:') ?? false;
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);
  const sessionOptimisticMessages = useMemo(
    () => currentSessionId ? messagesForSession(currentSessionId, optimisticMessages) : [],
    [currentSessionId, optimisticMessages]
  );

  // Clear optimistic messages progressively for the current session only:
  // 1. Remove optimistic user msg once the real user message arrives from the server
  // 2. Remove optimistic loading msg once any real agent message arrives after the user msg
  useEffect(() => {
    if (sessionOptimisticMessages.length === 0) return;
    const removeIds = new Set<string>();

    // Check if the real user message has arrived
    const optimisticUser = sessionOptimisticMessages.find((m) => m.messageId.startsWith('optimistic-user-'));
    if (optimisticUser) {
      const realUserFound = sessionMessages.some(
        (m) => m.senderType !== 'agent' && m.content === optimisticUser.content
      );
      if (realUserFound) {
        removeIds.add(optimisticUser.messageId);
      }
    }

    // Check if a real agent message has arrived AFTER the user message — clear loading indicator
    const optimisticLoading = sessionOptimisticMessages.find((m) => m.messageId.startsWith('optimistic-loading-'));
    if (optimisticLoading) {
      // Find the index of the real user message that replaced the optimistic one
      const userMsgIdx = sessionMessages.findIndex(
        (m) => m.senderType !== 'agent' && m.content === optimisticLoading.metadata?._userContent
      );
      // If user msg is confirmed AND there's an agent message after it, clear loading
      const hasAgentAfterUser = userMsgIdx >= 0 && sessionMessages.slice(userMsgIdx + 1).some(
        (m) => m.senderType === 'agent'
      );
      if (hasAgentAfterUser) {
        removeIds.add(optimisticLoading.messageId);
      }
    }

    if (removeIds.size > 0) {
      setOptimisticMessages((prev) => prev.filter((m) => !removeIds.has(m.messageId)));
    }
  }, [sessionMessages, sessionOptimisticMessages]);

  // Merge real messages with optimistic messages for display
  const displayMessages = useMemo(
    () => [...sessionMessages, ...sessionOptimisticMessages],
    [sessionMessages, sessionOptimisticMessages]
  );

  const startEditingTitle = () => {
    setTitleDraft(currentSession?.title || '');
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && currentSessionId && trimmed !== currentSession?.title) {
      renameSession(currentSessionId, trimmed);
    }
  };

  // Update last message cache for thread list preview
  useEffect(() => {
    if (!currentSessionId) return;
    const lastMsg = displayMessages[displayMessages.length - 1];
    if (lastMsg) {
      const isTerminalStatus = /stopped|stopping failed/i.test(lastMsg.content);
      const isWorking = !isTerminalStatus && (
        lastMsg.messageType === 'status' ||
        lastMsg.messageType === 'thinking' ||
        lastMsg.messageType === 'loading'
      );
      updateLastMessage(currentSessionId, lastMsg.senderName, lastMsg.content, isWorking);
    } else {
      updateLastMessage(currentSessionId, '', '');
    }
  }, [currentSessionId, displayMessages, updateLastMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track whether the agent is actively working in this session
  const prevActiveSessionRef = useRef<string | null>(null);
  useEffect(() => {
    // Clear active state for previously viewed session when switching
    if (prevActiveSessionRef.current && prevActiveSessionRef.current !== currentSessionId) {
      setSessionActive(prevActiveSessionRef.current, false);
    }
    prevActiveSessionRef.current = currentSessionId;

    if (!currentSessionId || displayMessages.length === 0) {
      if (currentSessionId) setSessionActive(currentSessionId, false);
      return;
    }
    const lastMsg = displayMessages[displayMessages.length - 1];
    const isTerminalStatus = /stopped|stopping failed/i.test(lastMsg.content);
    const isAgentWorking = lastMsg.senderType === 'agent' && !isTerminalStatus && (
      lastMsg.messageType === 'status' ||
      lastMsg.messageType === 'thinking' ||
      lastMsg.messageType === 'loading'
    );
    setSessionActive(currentSessionId, isAgentWorking);
  }, [currentSessionId, displayMessages, setSessionActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extract agent mode from status message metadata
  useEffect(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg: WorkspaceMessage = displayMessages[i];
      if (msg.senderType === 'agent' && msg.metadata?.agent_mode) {
        updateAgentMode(msg.senderName, msg.metadata.agent_mode as string);
        break;
      }
    }
  }, [displayMessages, updateAgentMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (content: string, mentions: string[] = [], files: PendingFile[] = []) => {
      if (!currentSessionId) return;
      if (!currentUser.id || !currentUser.name.trim()) return;

      // Create optimistic messages for instant feedback
      const timestamp = Date.now();
      const userContent = content || (files.length > 0 ? files.map((f) => f.file.name).join(', ') : '');
      const userOptimisticMsg: WorkspaceMessage = {
        messageId: `optimistic-user-${timestamp}`,
        sessionId: currentSessionId,
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderType: 'human',
        content: userContent,
        messageType: 'chat',
        mentions: [],
        targetAgents: null,
        createdAt: new Date().toISOString(),
        metadata: {},
      };
      const loadingOptimisticMsg: WorkspaceMessage = {
        messageId: `optimistic-loading-${timestamp}`,
        sessionId: currentSessionId,
        senderName: agents.find((a) => a.role === 'master')?.agentName || agents[0]?.agentName || 'Agent',
        senderType: 'agent',
        content: '',
        messageType: 'loading',
        mentions: [],
        targetAgents: null,
        createdAt: new Date().toISOString(),
        metadata: { _userContent: userContent },
      };

      // Add optimistic messages immediately and scroll to bottom
      setOptimisticMessages((prev) => [
        ...prev.filter((m) => m.sessionId !== currentSessionId),
        userOptimisticMsg,
        loadingOptimisticMsg,
      ]);
      setScrollKey((k) => k + 1);

      try {
        // Upload files first, then send message with attachment metadata
        let attachments: { fileId: string; filename: string; contentType: string; url: string }[] | undefined;
        if (files.length > 0) {
          const uploaded = await Promise.all(
            files.map((pf) => workspaceApi.uploadFile(pf.file, currentSessionId))
          );
          attachments = uploaded.map((f) => ({
            fileId: f.id,
            filename: f.filename,
            contentType: f.contentType,
            url: workspaceApi.getFileUrl(f.id),
          }));
        }

        await workspaceApi.sendMessage(
          currentSessionId,
          content || (attachments ? attachments.map((a) => a.filename).join(', ') : ''),
          currentUser.name,
          mentions.length > 0 ? mentions : undefined,
          attachments,
          currentUser.id,
        );
        capture('message_sent', {
          has_attachments: (attachments?.length ?? 0) > 0,
          has_mentions: mentions.length > 0,
          attachment_count: attachments?.length ?? 0,
        });
        forceRefresh();
      } catch {
        // Error is visible via missing message
        // Remove optimistic messages on error
        setOptimisticMessages((prev) =>
          prev.filter(
            (m) => m.messageId !== userOptimisticMsg.messageId && m.messageId !== loadingOptimisticMsg.messageId
          )
        );
      }
    },
    [currentSessionId, currentUser.id, currentUser.name, forceRefresh, agents]
  );

  const hasStatusMessages = displayMessages.some((m) => m.messageType === 'status' || m.messageType === 'thinking');

  if (!currentSessionId) {
    const isRoutinesView = viewMode === 'routines';
    return (
      <div className="flex flex-col h-full items-center justify-center text-center text-muted-foreground px-8">
        {isRoutinesView ? (
          <>
            <div className="opacity-20 mb-3">
              <CalendarClock className="size-10" />
            </div>
            <p className="text-sm font-medium">No routines yet</p>
            <p className="text-xs mt-1">Create a routine to get started.</p>
          </>
        ) : (
          <>
            <div className="flex items-center p-4 rounded-full bg-primary/10 mb-4">
              <MessageSquare className="size-8 text-primary" />
            </div>
            <p className="text-lg font-semibold text-foreground">Start a new session</p>
            <p className="text-sm mt-1 max-w-xs">
              Create a session and pick which agents join to start collaborating.
            </p>
            {agents.length > 0 && (
              <Button className="mt-5 gap-1.5" onClick={openNewThread}>
                <Plus className="size-4" />
                New Thread
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-2 px-2 lg:px-4 py-2 lg:py-3 border-b shrink-0">
        <div className="flex flex-1 items-center gap-2 lg:gap-3 min-w-0">
          {/* Back button — mobile only */}
          {isMobile && (
            <button
              onClick={openMobileList}
              className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground transition-colors shrink-0 -ml-1"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          {isDM ? (
            <h2 className="text-sm font-semibold truncate flex items-center gap-1.5">
              <MessageSquare className="size-3.5 text-muted-foreground" />
              {currentSessionId!.slice(3).split(',').map((a) => a.replace(/^openagents:/, '')).join(' ↔ ')}
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium">
                read-only
              </span>
            </h2>
          ) : editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') setEditingTitle(false);
              }}
              className="text-sm font-semibold bg-transparent border-b border-primary outline-none min-w-0 max-w-[300px]"
              autoFocus
            />
          ) : (
            <h2
              className="text-sm font-semibold truncate cursor-pointer hover:text-primary transition-colors"
              onClick={startEditingTitle}
              title="Click to rename"
            >
              {currentSession?.title || 'Thread'}
            </h2>
          )}
          {(() => {
            const participants = currentSession?.participants || [];
            const sessionAgents = agents.filter((a) => participants.includes(a.agentName));
            return (
              <>
                {sessionAgents.length > 1 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-medium shrink-0">
                    group
                  </span>
                )}
              </>
            );
          })()}
        </div>
        <div className="flex items-center gap-1 lg:gap-1.5 shrink-0">
          {/* Compact avatar stack — click to manage thread agents (add / remove /
              set leader). Replaces the old standalone manage-agents button. Not
              shown for DMs. */}
          {!isDM && (() => {
            const participants = currentSession?.participants || [];
            const sessionAgents = agents.filter((a) => participants.includes(a.agentName));
            if (sessionAgents.length === 0) return null;
            // In-thread list must include OFFLINE participants too — otherwise an
            // agent whose daemon is down can never be removed from the thread.
            const agentByName = new Map(agents.map((a) => [a.agentName, a]));
            const inThread = participants.map(
              (name) => agentByName.get(name) || { agentName: name, status: 'offline' }
            );
            // The "Add to thread" picker still only offers online agents.
            const notInThread = agents.filter(
              (a) => a.status === 'online' && !participants.includes(a.agentName)
            );
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex -space-x-1.5 shrink-0 mr-1 items-center rounded-full outline-none hover:opacity-80 transition-opacity cursor-pointer"
                    title="Manage thread agents"
                  >
                    {sessionAgents.slice(0, 3).map((agent) => (
                      <div key={agent.agentName} className="border-2 border-background rounded-full" title={agent.agentName}>
                        <AgentAvatar name={agent.agentName} size={18} />
                      </div>
                    ))}
                    {sessionAgents.length > 3 && (
                      <div className="size-5 rounded-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-[7px] font-medium text-zinc-600 dark:text-zinc-400 border-2 border-background" title={sessionAgents.map((agent) => agent.agentName).join(', ')}>
                        +{sessionAgents.length - 3}
                      </div>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {inThread.length > 0 && (
                    <>
                      <DropdownMenuLabel>In this thread</DropdownMenuLabel>
                      {inThread.map((agent) => (
                        <div
                          key={agent.agentName}
                          className="flex items-center gap-2 px-2 py-1.5 rounded-md group"
                        >
                          <AgentAvatar name={agent.agentName} size={20} />
                          <span className="text-sm flex-1 truncate">{agent.agentName}</span>
                          {agent.status !== 'online' && (
                            <span className="text-[10px] text-muted-foreground shrink-0">offline</span>
                          )}
                          {currentSession?.master === agent.agentName ? (
                            <span
                              className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 shrink-0"
                              title="Thread leader — receives messages that don't @mention anyone"
                            >
                              <Crown className="size-3" /> leader
                            </span>
                          ) : (
                            <button
                              onClick={() => currentSessionId && setSessionMaster(currentSessionId, agent.agentName)}
                              className="size-5 flex items-center justify-center rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                              title="Set as thread leader"
                            >
                              <Crown className="size-3" />
                            </button>
                          )}
                          {inThread.length > 1 && (
                            <button
                              onClick={() => currentSessionId && removeParticipant(currentSessionId, agent.agentName)}
                              className="size-5 flex items-center justify-center rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                              title="Remove from thread"
                            >
                              <X className="size-3" />
                            </button>
                          )}
                        </div>
                      ))}
                    </>
                  )}
                  {notInThread.length > 0 && (
                    <>
                      {inThread.length > 0 && <DropdownMenuSeparator />}
                      <DropdownMenuLabel>Add to thread</DropdownMenuLabel>
                      {notInThread.map((agent) => (
                        <button
                          key={agent.agentName}
                          onClick={() => currentSessionId && addParticipant(currentSessionId, agent.agentName)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                        >
                          <AgentAvatar name={agent.agentName} size={20} />
                          <span className="text-sm flex-1 truncate text-left">{agent.agentName}</span>
                          <Plus className="size-3 text-muted-foreground shrink-0" />
                        </button>
                      ))}
                    </>
                  )}
                  {inThread.length === 0 && notInThread.length === 0 && (
                    <p className="text-sm text-muted-foreground px-2 py-3 text-center">No agents online</p>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            );
          })()}

          {/* Stop button — visible when agents are working */}
          {currentSessionId && (activeSessionIds.has(currentSessionId) || stoppingSessionIds.has(currentSessionId)) && (
            <button
              onClick={() => stopAllAgents(currentSessionId!)}
              disabled={stoppingSessionIds.has(currentSessionId)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors shrink-0 disabled:opacity-60 disabled:pointer-events-none"
            >
              <Square className="size-3 fill-current" />
              {stoppingSessionIds.has(currentSessionId) ? 'Stopping...' : 'Stop'}
            </button>
          )}

          {/* All steps toggle */}
          {hasStatusMessages && (
            <Button
              variant={showAllSteps ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setShowAllSteps((prev) => !prev)}
              className={cn(
                'gap-1.5 h-7 text-xs font-medium',
                showAllSteps && 'border-primary/30 text-primary bg-primary/5'
              )}
              title={showAllSteps ? 'Showing all intermediate steps' : 'Showing only latest steps'}
            >
              <ListTree className="size-3.5" />
            </Button>
          )}

          {/* Browser live preview toggle */}
          {!isMobile && (
            <Button
              variant={splitBrowser && showBrowserPreview ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => {
                if (!splitBrowser) setSplitBrowser(true);
                setShowBrowserPreview(!(splitBrowser && showBrowserPreview));
              }}
              className={cn(
                'gap-1.5 h-7 text-xs font-medium',
                splitBrowser && showBrowserPreview && 'border-primary/30 text-primary bg-primary/5'
              )}
              title={splitBrowser && showBrowserPreview ? 'Hide browser preview' : 'Show browser preview'}
            >
              <Globe className="size-3.5" />
            </Button>
          )}

          {/* Orchestration mode picker — only for multi-agent threads */}
          {!isDM && currentSession && (() => {
            const participants = currentSession.participants || [];
            const sessionAgents = agents.filter((a) => participants.includes(a.agentName));
            if (sessionAgents.length < 2) return null;
            return (
              <OrchestrationControl
                session={currentSession}
                agents={sessionAgents}
                onChange={(updates) => setSessionOrchestration(currentSessionId!, updates)}
              />
            );
          })()}

          {/* Share conversation */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShareDialogOpen(true)}
            className="gap-1.5 h-7 text-xs font-medium"
            title="Share conversation"
          >
            <Share2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Agent roster bar — thin strip listing who's in the thread + a hint of
          their responsibility. Only shown for group threads (>1 agent), never DMs. */}
      {!isDM && (() => {
        const participants = currentSession?.participants || [];
        const sessionAgents = agents.filter((a) => participants.includes(a.agentName));
        if (sessionAgents.length <= 1) return null;
        return (
          <div className="flex items-center gap-2 px-2 lg:px-4 py-1.5 border-b shrink-0 overflow-x-auto bg-zinc-50/60 dark:bg-zinc-900/40">
            {sessionAgents.map((agent, i) => {
              const desc = shortDescription(agent.description);
              const isMaster = currentSession?.master === agent.agentName;
              return (
                <div key={agent.agentName} className="flex items-center gap-2 shrink-0">
                  {i > 0 && <span className="text-zinc-300 dark:text-zinc-700 select-none">|</span>}
                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    title={agent.description ? `${agent.agentName} — ${agent.description}` : agent.agentName}
                  >
                    <AgentAvatar name={agent.agentName} size={16} status={agent.status} showStatus />
                    <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-200 shrink-0">
                      {agent.agentName}
                    </span>
                    {isMaster && <Crown className="size-2.5 text-amber-500 shrink-0" />}
                    {desc && (
                      <span className="text-[11px] text-muted-foreground truncate max-w-[220px]">
                        {desc}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Missing-description warning — routing accuracy (dynamic/workflow router
          and the master's own delegation) depends on agent descriptions. Nudge
          the user to fill any that are blank; each chip opens that agent's
          profile, where a one-click auto-generate button drafts one. */}
      {!isDM && (() => {
        const participants = currentSession?.participants || [];
        const sessionAgents = agents.filter((a) => participants.includes(a.agentName));
        if (sessionAgents.length <= 1) return null;
        const missing = sessionAgents.filter((a) => !a.description || !a.description.trim());
        if (missing.length === 0) return null;
        return (
          <div className="flex items-center gap-2 px-2 lg:px-4 py-1.5 border-b shrink-0 overflow-x-auto bg-amber-50 dark:bg-amber-900/15 text-amber-800 dark:text-amber-300">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="text-[11px] leading-snug shrink-0">
              Routing may be less accurate — no description for:
            </span>
            {missing.map((a) => (
              <button
                key={a.agentName}
                onClick={() => setSelectedAgentName(a.agentName)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 hover:bg-amber-200 dark:hover:bg-amber-900/60 transition-colors shrink-0"
                title={`Add a description for ${a.agentName}`}
              >
                <Sparkles className="size-2.5" />
                {a.agentName}
              </button>
            ))}
          </div>
        );
      })()}

      {/* Messages */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center flex-1">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : displayMessages.length === 0 ? (
          <EmptyState />
        ) : (
          <ChatMessages
            messages={displayMessages}
            agents={agents}
            showAllSteps={showAllSteps}
            scrollKey={scrollKey}
            loadOlder={loadOlder}
            hasOlder={hasOlder}
            loadingOlder={loadingOlder}
            className="flex-1 overflow-y-auto px-3 lg:px-5 py-3"
          />
        )}

        {/* Input — hidden for read-only DM views */}
        {!isDM && (
          <div className="px-3 lg:px-4 py-2 lg:py-3">
            <div className="max-w-3xl mx-auto w-full">
              {currentSessionId && <ThreadStatusBar channelName={currentSessionId} messages={displayMessages} />}
              <ChatInput
                onSend={handleSend}
                agents={agents}
                knowledge={knowledge}
                draft={currentDraft}
                onDraftChange={handleDraftChange}
                onFocusChange={(focused) => focused ? notifyFocus() : notifyBlur()}
                focusKey={focusKey}
                onCreateRoutine={() => setShowCreateRoutine(true)}
                disabled={!currentUser.name.trim()}
              />
            </div>
          </div>
        )}

        <CreateRoutineDialog
          open={showCreateRoutine}
          onOpenChange={setShowCreateRoutine}
          agents={agents}
          conversationHistory={(() => {
            if (!sessionMessages.length) return undefined;
            const recent = sessionMessages.filter((m) => m.messageType === 'chat').slice(-20);
            if (!recent.length) return undefined;
            return recent.map((m) => `${m.senderName}: ${m.content}`).join('\n');
          })()}
          onCreateRoutine={createRoutine}
        />

        {currentSessionId && (
          <ShareDialog
            open={shareDialogOpen}
            onOpenChange={setShareDialogOpen}
            sessionId={currentSessionId}
          />
        )}
      </div>
    </div>
  );
}
