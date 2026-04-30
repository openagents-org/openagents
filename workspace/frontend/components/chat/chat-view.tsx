'use client';

import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { ChatMessages } from './chat-messages';
import { ChatInput, type PendingFile } from './chat-input';
import { EmptyState } from './empty-state';
import { useWorkspace } from '@/lib/workspace-context';
import { useMessagePolling } from '@/hooks/use-polling';
import { workspaceApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ListTree, UserPlus, MessageSquare, Zap, Eye, Square, ChevronLeft, X, Plus, Globe } from 'lucide-react';
import { useLayout } from '@/components/layout/layout-context';
import { cn } from '@/lib/utils';
import { getAgentColor, getAgentInitials } from '@/lib/helpers';
import { eventToMessage } from '@/lib/types';
import type { WorkspaceMessage } from '@/lib/types';

// Module-level message cache — survives component re-renders/unmounts.
// Keyed by sessionId, stores the last known messages for instant thread switching.
const messageCache = new Map<string, WorkspaceMessage[]>();
const CACHE_MAX_SESSIONS = 10;
// Track last seen message ID per cached session for incremental refresh
const cacheLastSeenId = new Map<string, string>();

function cacheMessages(sessionId: string, msgs: WorkspaceMessage[]) {
  if (msgs.length === 0) return;
  messageCache.set(sessionId, msgs);
  cacheLastSeenId.set(sessionId, msgs[msgs.length - 1].messageId);
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
    return result.events.map(eventToMessage).reverse();
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
    if (msgs.length > 0) cacheMessages(sessionId, msgs);
    return;
  }
  try {
    const result = await workspaceApi.pollMessages(sessionId, lastId);
    if (result.messages.length > 0) {
      const existing = messageCache.get(sessionId) || [];
      const existingIds = new Set(existing.map((m) => m.messageId));
      const unique = result.messages.filter((m) => !existingIds.has(m.messageId));
      if (unique.length > 0) {
        cacheMessages(sessionId, [...existing, ...unique]);
      }
    }
  } catch {
    // Best-effort
  }
}

export function ChatView() {
  const { agents, currentSessionId, sessions, updateLastMessage, setSessionActive, agentModes, updateAgentMode, toggleAgentMode, stopAllAgents, activeSessionIds, stoppingSessionIds, renameSession, addParticipant, removeParticipant } = useWorkspace();
  const { isMobile, openMobileList, splitBrowser, showBrowserPreview, setShowBrowserPreview } = useLayout();

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
  if (currentSessionId !== initialMessagesRef.current?.[0]?.sessionId) {
    initialMessagesRef.current = currentSessionId ? messageCache.get(currentSessionId) : undefined;
  }

  const { messages, loading, forceRefresh, generation, loadOlder, hasOlder, loadingOlder } = useMessagePolling({
    sessionId: currentSessionId,
    initialMessages: initialMessagesRef.current,
  });
  const [showAllSteps, setShowAllSteps] = useState(false);
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
    // Focus the input when switching threads
    if (currentSessionId) setFocusKey((k) => k + 1);
  }, [currentSessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep cache updated with latest messages for the current session
  useEffect(() => {
    if (currentSessionId && messages.length > 0) {
      cacheMessages(currentSessionId, messages);
    }
  }, [currentSessionId, messages]);

  // Clear optimistic messages progressively:
  // 1. Remove optimistic user msg once the real user message arrives from the server
  // 2. Remove optimistic loading msg once any real agent message arrives after the user msg
  useEffect(() => {
    if (optimisticMessages.length === 0) return;
    let updated = [...optimisticMessages];

    // Check if the real user message has arrived
    const optimisticUser = updated.find((m) => m.messageId.startsWith('optimistic-user-'));
    if (optimisticUser) {
      const realUserFound = messages.some(
        (m) => m.senderType !== 'agent' && m.content === optimisticUser.content
      );
      if (realUserFound) {
        updated = updated.filter((m) => !m.messageId.startsWith('optimistic-user-'));
      }
    }

    // Check if a real agent message has arrived AFTER the user message — clear loading indicator
    const optimisticLoading = updated.find((m) => m.messageId.startsWith('optimistic-loading-'));
    if (optimisticLoading) {
      // Find the index of the real user message that replaced the optimistic one
      const userMsgIdx = messages.findIndex(
        (m) => m.senderType !== 'agent' && m.content === optimisticLoading.metadata?._userContent
      );
      // If user msg is confirmed AND there's an agent message after it, clear loading
      const hasAgentAfterUser = userMsgIdx >= 0 && messages.slice(userMsgIdx + 1).some(
        (m) => m.senderType === 'agent'
      );
      if (hasAgentAfterUser) {
        updated = updated.filter((m) => !m.messageId.startsWith('optimistic-loading-'));
      }
    }

    if (updated.length !== optimisticMessages.length) {
      setOptimisticMessages(updated);
    }
  }, [messages, optimisticMessages]);

  const handleDraftChange = useCallback((draft: string) => {
    setCurrentDraft(draft);
    if (currentSessionId) {
      draftsRef.current[currentSessionId] = draft;
    }
  }, [currentSessionId]);

  const isDM = currentSessionId?.startsWith('dm:') ?? false;
  const currentSession = sessions.find((s) => s.sessionId === currentSessionId);
  const agentNames = agents.map((a) => a.agentName);

  // Merge real messages with optimistic messages for display
  const displayMessages = useMemo(() => [...messages, ...optimisticMessages], [messages, optimisticMessages]);

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

      // Create optimistic messages for instant feedback
      const timestamp = Date.now();
      const userContent = content || (files.length > 0 ? files.map((f) => f.file.name).join(', ') : '');
      const userOptimisticMsg: WorkspaceMessage = {
        messageId: `optimistic-user-${timestamp}`,
        sessionId: currentSessionId,
        senderName: 'You',
        senderType: 'user',
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
      setOptimisticMessages([userOptimisticMsg, loadingOptimisticMsg]);
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
          'user',
          mentions.length > 0 ? mentions : undefined,
          attachments,
        );
        forceRefresh();
      } catch {
        // Error is visible via missing message
        // Remove optimistic messages on error
        setOptimisticMessages([]);
      }
    },
    [currentSessionId, forceRefresh, agents]
  );

  const hasStatusMessages = displayMessages.some((m) => m.messageType === 'status' || m.messageType === 'thinking');

  if (!currentSessionId) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-muted-foreground">
        <div className="opacity-20 mb-3">
          <MessageSquare className="size-10" />
        </div>
        <p className="text-sm font-medium">Select a thread</p>
        <p className="text-xs mt-1">Choose a thread from the list or create a new one.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center justify-between px-2 lg:px-4 py-2 lg:py-3 border-b shrink-0">
        <div className="flex items-center gap-2 lg:gap-3 min-w-0">
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
            const sessionAgents = participants.length > 0
              ? agents.filter((a) => participants.includes(a.agentName))
              : agents;
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
        <div className="flex items-center gap-1 lg:gap-1.5">
          {/* Participant chips — hidden on mobile, shown on desktop, not shown for DMs */}
          {!isDM && <div className="hidden lg:flex items-center gap-1 overflow-x-auto">
            {(() => {
              const participants = currentSession?.participants || [];
              const sessionAgents = participants.length > 0
                ? agents.filter((a) => participants.includes(a.agentName))
                : agents;
              return sessionAgents.map((agent) => {
                const color = getAgentColor(agent.agentName, agentNames);
                const isMaster = currentSession?.master === agent.agentName || agent.role === 'master';
                return (
                  <div
                    key={agent.agentName}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-muted border shrink-0"
                  >
                    <div className={cn(
                      'size-4 rounded-full flex items-center justify-center text-white text-[7px] font-bold',
                      color.initials
                    )}>
                      {getAgentInitials(agent.agentName)}
                    </div>
                    <span className="text-[11px] font-medium">{agent.agentName.split('-')[0]}</span>
                    {isMaster && (
                      <span className="text-[8px] px-1 py-0 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-semibold">
                        M
                      </span>
                    )}
                  </div>
                );
              });
            })()}
          </div>}

          {/* Compact avatar stack on mobile */}
          {isMobile && (() => {
            const participants = currentSession?.participants || [];
            const sessionAgents = participants.length > 0
              ? agents.filter((a) => participants.includes(a.agentName))
              : agents;
            if (sessionAgents.length === 0) return null;
            return (
              <div className="flex -space-x-1.5">
                {sessionAgents.slice(0, 3).map((agent) => {
                  const color = getAgentColor(agent.agentName, agentNames);
                  return (
                    <div
                      key={agent.agentName}
                      className={cn(
                        'size-5 rounded-full flex items-center justify-center text-white text-[7px] font-bold border-2 border-background',
                        color.initials
                      )}
                    >
                      {getAgentInitials(agent.agentName)}
                    </div>
                  );
                })}
                {sessionAgents.length > 3 && (
                  <div className="size-5 rounded-full bg-zinc-200 flex items-center justify-center text-[7px] font-medium text-zinc-600 border-2 border-background">
                    +{sessionAgents.length - 3}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Agent mode toggle — only for Claude agents */}
          {agents.length > 0 && agents[0].agentType === 'claude' && (() => {
            const agent = agents[0];
            const mode = agentModes[agent.agentName] || 'execute';
            const isExecute = mode === 'execute';
            return (
              <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 p-0.5 shrink-0">
                <button
                  onClick={() => !isExecute && toggleAgentMode(agent.agentName)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors',
                    isExecute
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Zap className="size-3" />
                  Execute
                </button>
                <button
                  onClick={() => isExecute && toggleAgentMode(agent.agentName)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors',
                    !isExecute
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Eye className="size-3" />
                  Plan
                </button>
              </div>
            );
          })()}

          {/* Stop button — visible when agents are working */}
          {currentSessionId && (activeSessionIds.has(currentSessionId) || stoppingSessionIds.has(currentSessionId)) && (
            <button
              onClick={stopAllAgents}
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

          {/* Browser live preview toggle — only when split browser is enabled */}
          {splitBrowser && !isMobile && (
            <Button
              variant={showBrowserPreview ? 'outline' : 'ghost'}
              size="sm"
              onClick={() => setShowBrowserPreview(!showBrowserPreview)}
              className={cn(
                'gap-1.5 h-7 text-xs font-medium',
                showBrowserPreview && 'border-primary/30 text-primary bg-primary/5'
              )}
              title={showBrowserPreview ? 'Hide browser preview' : 'Show browser preview'}
            >
              <Globe className="size-3.5" />
            </Button>
          )}

          {/* Manage agents dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="size-7 flex items-center justify-center rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-muted-foreground hover:text-foreground transition-colors"
                title="Manage thread agents"
              >
                <UserPlus className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {(() => {
                const participants = currentSession?.participants || [];
                const onlineAgents = agents.filter((a) => a.status === 'online');
                const inThread = onlineAgents.filter((a) => participants.includes(a.agentName));
                const notInThread = onlineAgents.filter((a) => !participants.includes(a.agentName));
                return (
                  <>
                    {inThread.length > 0 && (
                      <>
                        <DropdownMenuLabel>In this thread</DropdownMenuLabel>
                        {inThread.map((agent) => {
                          const color = getAgentColor(agent.agentName, agentNames);
                          return (
                            <div
                              key={agent.agentName}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-md group"
                            >
                              <div className={cn(
                                'size-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0',
                                color.initials
                              )}>
                                {getAgentInitials(agent.agentName)}
                              </div>
                              <span className="text-sm flex-1 truncate">{agent.agentName}</span>
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
                          );
                        })}
                      </>
                    )}
                    {notInThread.length > 0 && (
                      <>
                        {inThread.length > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel>Add to thread</DropdownMenuLabel>
                        {notInThread.map((agent) => {
                          const color = getAgentColor(agent.agentName, agentNames);
                          return (
                            <button
                              key={agent.agentName}
                              onClick={() => currentSessionId && addParticipant(currentSessionId, agent.agentName)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors"
                            >
                              <div className={cn(
                                'size-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0',
                                color.initials
                              )}>
                                {getAgentInitials(agent.agentName)}
                              </div>
                              <span className="text-sm flex-1 truncate text-left">{agent.agentName}</span>
                              <Plus className="size-3 text-muted-foreground shrink-0" />
                            </button>
                          );
                        })}
                      </>
                    )}
                    {onlineAgents.length === 0 && (
                      <p className="text-sm text-muted-foreground px-2 py-3 text-center">No agents online</p>
                    )}
                  </>
                );
              })()}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

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
              <ChatInput
                onSend={handleSend}
                agents={agents}
                draft={currentDraft}
                onDraftChange={handleDraftChange}
                focusKey={focusKey}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
