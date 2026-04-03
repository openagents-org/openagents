'use client';

import { useState, useEffect, useRef } from 'react';
import { PanelLeft, RefreshCw, Search, Star, Archive, Trash2, MoreVertical, ArchiveRestore, Wrench, Loader2, CheckCircle2, MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { getAgentColor, getAgentInitials, timeAgo } from '@/lib/helpers';
import { workspaceApi } from '@/lib/api';
import type { WorkspaceAgent } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

function AvatarStack({ agents, max = 3 }: { agents: WorkspaceAgent[]; max?: number }) {
  const shown = agents.slice(0, max);
  const extra = agents.length - max;
  const agentNames = agents.map((a) => a.agentName);

  // Single agent: show a larger avatar
  if (shown.length <= 1) {
    const agent = shown[0];
    if (!agent) return null;
    const color = getAgentColor(agent.agentName, agentNames);
    return (
      <div
        className={cn(
          'size-[30px] rounded-full flex items-center justify-center text-white text-[10px] font-bold',
          color.initials
        )}
      >
        {getAgentInitials(agent.agentName)}
      </div>
    );
  }

  // Multiple agents: compact overlapping stack
  return (
    <div className="flex -space-x-1.5">
      {shown.map((agent) => {
        const color = getAgentColor(agent.agentName, agentNames);
        return (
          <div
            key={agent.agentName}
            className={cn(
              'size-[18px] rounded-full flex items-center justify-center text-white text-[7px] font-bold ring-2 ring-white dark:ring-zinc-900',
              color.initials
            )}
          >
            {getAgentInitials(agent.agentName)}
          </div>
        );
      })}
      {extra > 0 && (
        <div className="size-[18px] rounded-full bg-zinc-200 flex items-center justify-center text-[7px] font-medium text-zinc-600 ring-2 ring-white dark:ring-zinc-900">
          +{extra}
        </div>
      )}
    </div>
  );
}

interface SearchHit {
  channelName: string;
  snippet: string;
  messageId: string;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 text-foreground rounded-sm px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function DMSection({
  conversations,
  currentSessionId,
  onSelect,
}: {
  conversations: { agents: [string, string]; lastMessage: { content: string; sender: string; timestamp: number }; messageCount: number }[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <MessageCircle className="size-3" />
        <span>Agent DMs ({conversations.length})</span>
        <svg
          className={cn('size-3 ml-auto transition-transform', expanded && 'rotate-180')}
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M3 5l3 3 3-3" />
        </svg>
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {conversations.map((convo) => {
            const dmId = `dm:${convo.agents[0]},${convo.agents[1]}`;
            const isSelected = currentSessionId === dmId;
            const agentA = convo.agents[0].replace(/^openagents:/, '');
            const agentB = convo.agents[1].replace(/^openagents:/, '');
            const sender = convo.lastMessage.sender.replace(/^openagents:/, '');
            const preview = `${sender}: ${convo.lastMessage.content}`;
            const displayTime = convo.lastMessage.timestamp
              ? timeAgo(new Date(convo.lastMessage.timestamp).toISOString())
              : '';

            return (
              <div
                key={dmId}
                onClick={() => onSelect(dmId)}
                className={cn(
                  'w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors cursor-pointer',
                  isSelected ? 'bg-zinc-100 dark:bg-zinc-800 ring-2 ring-indigo-500 dark:ring-indigo-400' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                )}
              >
                <div className="shrink-0 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 rounded-full size-[30px] bg-white dark:bg-zinc-900">
                  <MessageCircle className="size-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm flex-1 min-w-0 truncate font-normal text-foreground">
                      {agentA} ↔ {agentB}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">{displayTime}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{preview}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ThreadList() {
  const { sessions, currentSessionId, setCurrentSessionId, agents, lastMessageBySession, activeSessionIds, completedSessionIds, updateSession, dmConversations } = useWorkspace();
  const { sidebarToggle, isMobile, openMobileDetail } = useLayout();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounced content search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const hits = await workspaceApi.searchMessages(searchQuery.trim());
        setSearchResults(hits);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  // When searching, show sessions that match by title OR have content hits
  const isSearching = searchQuery.trim().length > 0;
  const hitsByChannel = new Map<string, SearchHit>();
  for (const hit of searchResults) {
    if (!hitsByChannel.has(hit.channelName)) {
      hitsByChannel.set(hit.channelName, hit);
    }
  }

  const [showArchived, setShowArchived] = useState(false);

  // Sort sessions by backend last_event_at (stable, no client-side jumping)
  const sortedSessions = [...sessions]
    .filter((s) => s.status !== 'deleted')
    .sort((a, b) => {
      // Starred items first
      if (a.starred && !b.starred) return -1;
      if (!a.starred && b.starred) return 1;
      const aTime = a.lastEventAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
      const bTime = b.lastEventAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
      return bTime - aTime;
    });

  const activeSessions = sortedSessions.filter((s) => s.status === 'active');
  const archivedSessions = sortedSessions.filter((s) => s.status === 'archived');

  const filteredSessions = isSearching
    ? sortedSessions.filter((s) =>
        s.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        hitsByChannel.has(s.sessionId)
      )
    : activeSessions;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-3 shrink-0">
        {!isMobile && (
          <button
            onClick={sidebarToggle}
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-muted-foreground transition-colors shrink-0"
          >
            <PanelLeft className="size-4" />
          </button>
        )}
        <div className="flex items-center w-full gap-1">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-muted/50 border border-input text-muted-foreground">
            <Search className="size-3.5" />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs bg-transparent outline-none flex-1 placeholder:text-muted-foreground"
            />
            {searching && (
              <div className="size-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
            )}
          </div>
          <button
            className="size-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-muted-foreground transition-colors shrink-0"
            title="Refresh"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Thread rows */}
      <div className="flex-1 overflow-y-auto px-4 py-1">
        <div className="space-y-1">
          {filteredSessions.map((session) => {
            const isSelected = session.sessionId === currentSessionId;
            const lastMsg = lastMessageBySession[session.sessionId];
            const isActive = activeSessionIds.has(session.sessionId);
            const isCompleted = completedSessionIds.has(session.sessionId);
            const contentHit = hitsByChannel.get(session.sessionId);

            // Show last activity time from backend
            const activityMs = session.lastEventAt;
            const displayTime = activityMs
              ? timeAgo(new Date(activityMs).toISOString())
              : session.createdAt ? timeAgo(session.createdAt) : '';

            // Determine the preview line
            let preview: React.ReactNode;
            let previewIsStatus = false;
            if (isSearching && contentHit) {
              // Show matching snippet with highlight
              const snippet = contentHit.snippet.length > 80
                ? contentHit.snippet.slice(0, 80) + '...'
                : contentHit.snippet;
              preview = highlightMatch(snippet, searchQuery);
            } else if (lastMsg && lastMsg.content) {
              const sender = lastMsg.senderName === 'user' ? 'You' : lastMsg.senderName;
              if (lastMsg.isStatus) {
                previewIsStatus = true;
                // Parse "Using tool: <tool_name>" pattern from status messages
                const toolMatch = lastMsg.content.match(/Using tool:?\**\s*`?([^`\n]+)`?/i);
                if (toolMatch) {
                  // Clean MCP prefix: mcp__openagents-workspace__foo → foo, mcp__playwright__bar → bar
                  const rawTool = toolMatch[1].trim();
                  const cleanTool = rawTool.replace(/^mcp__[^_]+__/, '');
                  preview = (
                    <span className="flex items-center gap-1">
                      {sender}: <Wrench className="size-3 shrink-0" /> {cleanTool}
                    </span>
                  );
                } else if (lastMsg.content.includes('thinking')) {
                  preview = (
                    <span className="flex items-center gap-1">
                      {sender}: <Loader2 className="size-3 shrink-0 animate-spin" /> thinking...
                    </span>
                  );
                } else {
                  // Other status messages — strip markdown
                  const cleaned = lastMsg.content
                    .replace(/\*\*/g, '')
                    .replace(/`/g, '')
                    .replace(/```[\s\S]*/g, '')
                    .trim();
                  preview = `${sender}: ${cleaned}`;
                }
              } else {
                preview = `${sender}: ${lastMsg.content}`;
              }
            } else {
              preview = 'No messages yet';
            }

            return (
              <div
                key={session.sessionId}
                onClick={() => {
                  setCurrentSessionId(session.sessionId);
                  if (isMobile) openMobileDetail();
                }}
                className={cn(
                  'w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-all relative group cursor-pointer',
                  isSelected ? 'bg-zinc-100 dark:bg-zinc-800 ring-2 ring-indigo-500 dark:ring-indigo-400' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                  'has-data-[state=open]:bg-zinc-50 dark:has-data-[state=open]:bg-zinc-800/50',
                  isActive && 'thread-wip',
                  isCompleted && !isSelected && 'bg-amber-50 dark:bg-amber-900/20 ring-1 ring-amber-200/60 dark:ring-amber-700/40 animate-[glow_2s_ease-in-out_infinite]'
                )}
              >
                {/* Avatar stack — show only channel participants */}
                <div className="shrink-0">
                  <AvatarStack agents={
                    session.participants.length > 0
                      ? agents.filter((a) => session.participants.includes(a.agentName))
                      : agents
                  } />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    {session.starred && (
                      <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                    )}
                    <span className="text-sm flex-1 min-w-0 truncate font-normal text-foreground">
                      {isSearching
                        ? highlightMatch(session.title || 'Untitled', searchQuery)
                        : (session.title || 'Untitled')}
                    </span>
                    {isCompleted && !isSelected ? (
                      <CheckCircle2 className="size-3.5 shrink-0 text-amber-500" />
                    ) : (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {displayTime}
                      </span>
                    )}
                  </div>
                  <p className={cn(
                    'text-xs text-muted-foreground truncate',
                    previewIsStatus && 'italic'
                  )}>
                    {preview}
                  </p>
                </div>

                {/* Hover actions */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="size-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSession(session.sessionId, { starred: !session.starred });
                      }}
                    >
                      <Star className={cn('size-4', session.starred && 'fill-amber-400 text-amber-400')} />
                      <span>{session.starred ? 'Unstar' : 'Star'}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSession(session.sessionId, { status: session.status === 'archived' ? 'active' : 'archived' });
                      }}
                    >
                      {session.status === 'archived'
                        ? <><ArchiveRestore className="size-4" /><span>Unarchive</span></>
                        : <><Archive className="size-4" /><span>Archive</span></>
                      }
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSession(session.sessionId, { status: 'deleted' });
                      }}
                    >
                      <Trash2 className="size-4" />
                      <span>Delete</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}

          {filteredSessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              {isSearching ? (
                <>
                  <p className="text-sm">No results found</p>
                  <p className="text-xs mt-1">Try a different search term</p>
                </>
              ) : (
                <>
                  <p className="text-sm">No threads yet</p>
                  <p className="text-xs mt-1">Create a thread to start chatting</p>
                </>
              )}
            </div>
          )}

          {/* Agent DMs section */}
          {!isSearching && dmConversations.length > 0 && (
            <DMSection
              conversations={dmConversations}
              currentSessionId={currentSessionId}
              onSelect={(id) => {
                setCurrentSessionId(id);
                if (isMobile) openMobileDetail();
              }}
            />
          )}

          {/* Archived section */}
          {!isSearching && archivedSessions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => setShowArchived(!showArchived)}
                className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <Archive className="size-3" />
                <span>Archived ({archivedSessions.length})</span>
                <svg
                  className={cn('size-3 ml-auto transition-transform', showArchived && 'rotate-180')}
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 5l3 3 3-3" />
                </svg>
              </button>
              {showArchived && (
                <div className="mt-1 space-y-1 opacity-60">
                  {archivedSessions.map((session) => {
                    const isSelected = session.sessionId === currentSessionId;
                    const lastMsg = lastMessageBySession[session.sessionId];
                    const activityMs = session.lastEventAt;
                    const displayTime = activityMs
                      ? timeAgo(new Date(activityMs).toISOString())
                      : session.createdAt ? timeAgo(session.createdAt) : '';
                    const preview = lastMsg && lastMsg.content
                      ? `${lastMsg.senderName === 'user' ? 'You' : lastMsg.senderName}: ${lastMsg.content}`
                      : 'No messages yet';

                    return (
                      <div
                        key={session.sessionId}
                        onClick={() => {
                          setCurrentSessionId(session.sessionId);
                          if (isMobile) openMobileDetail();
                        }}
                        className={cn(
                          'w-full flex items-center gap-2.5 p-2 rounded-lg text-left transition-colors relative group cursor-pointer',
                          isSelected ? 'bg-zinc-100 dark:bg-zinc-800 ring-2 ring-indigo-500 dark:ring-indigo-400' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50',
                          'has-data-[state=open]:bg-zinc-50 dark:has-data-[state=open]:bg-zinc-800/50'
                        )}
                      >
                        <div className="shrink-0 flex items-center justify-center border border-zinc-200 dark:border-zinc-700 rounded-full size-[30px] bg-white dark:bg-zinc-900">
                          <AvatarStack agents={
                            session.participants.length > 0
                              ? agents.filter((a) => session.participants.includes(a.agentName))
                              : agents
                          } />
                        </div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm flex-1 min-w-0 truncate font-normal text-foreground">
                              {session.title || 'Untitled'}
                            </span>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {displayTime}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {preview}
                          </p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="size-3.5 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                updateSession(session.sessionId, { status: 'active' });
                              }}
                            >
                              <ArchiveRestore className="size-4" />
                              <span>Unarchive</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateSession(session.sessionId, { status: 'deleted' });
                              }}
                            >
                              <Trash2 className="size-4" />
                              <span>Delete</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
