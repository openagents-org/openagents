'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { workspaceApi } from '@/lib/api';
import { eventToMessage } from '@/lib/types';
import type { WorkspaceMessage } from '@/lib/types';
import { MonitorTile } from './monitor-tile';
import { MonitorOverlay } from './monitor-overlay';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/lib/helpers';

const POLL_INTERVAL = 5_000;

export interface TileData {
  lastUserMessage: WorkspaceMessage | null;
  lastAgentMessage: WorkspaceMessage | null;
  /** Recent thinking/status steps when agent is actively working (newest first) */
  recentSteps: WorkspaceMessage[];
}

export function MonitorGrid() {
  const { sessions, activeSessionIds, completedSessionIds, agents, acknowledgeCompletion, lastMessageBySession } = useWorkspace();
  const [overlaySessionId, setOverlaySessionId] = useState<string | null>(null);
  const [tileData, setTileData] = useState<Record<string, TileData>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Message cache for instant overlay loading — stores all fetched messages per session (chronological)
  const messageCacheRef = React.useRef<Record<string, WorkspaceMessage[]>>({});

  const activeSessions = useMemo(() => {
    return [...sessions]
      .filter((s) => s.status === 'active')
      .sort((a, b) => {
        const aTime = a.lastEventAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const bTime = b.lastEventAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return bTime - aTime;
      });
  }, [sessions]);

  const tileCount = activeSessions.length >= 9 ? 9 : 6;
  const topSessions = useMemo(() => activeSessions.slice(0, tileCount), [activeSessions, tileCount]);

  // Fetch last turn data for all visible tiles
  const fetchTileData = useCallback(async () => {
    const results: Record<string, TileData> = {};
    await Promise.all(
      topSessions.map(async (session) => {
        try {
          const result = await workspaceApi.pollEvents({
            channel: session.sessionId,
            type: 'workspace.message',
            sort: 'desc',
            limit: 50,
          });
          const msgs = result.events.map(eventToMessage);

          // Find indices of key messages (msgs sorted newest-first)
          const lastUserIdx = msgs.findIndex((m) => m.senderType !== 'agent');
          const lastUser = lastUserIdx >= 0 ? msgs[lastUserIdx] : null;

          // Find last agent chat message (not status/thinking)
          const lastAgentChatIdx = msgs.findIndex(
            (m) => m.senderType === 'agent' && m.messageType !== 'status' && m.messageType !== 'thinking'
          );
          const lastAgentChat = lastAgentChatIdx >= 0 ? msgs[lastAgentChatIdx] : null;

          // Find last agent status/thinking
          const lastAgentStatus = msgs.find(
            (m) => m.senderType === 'agent' && (m.messageType === 'status' || m.messageType === 'thinking')
          ) || null;

          // If the latest agent message is status/thinking, agent is working — show that
          // Otherwise show the final chat response
          const latestAgentAny = msgs.find((m) => m.senderType === 'agent');
          const agentIsWorking = latestAgentAny && (latestAgentAny.messageType === 'status' || latestAgentAny.messageType === 'thinking');

          // Only show agent chat response if it's newer than the last user message
          // (lower index = newer in desc-sorted array). If user message is newer,
          // the old agent response is stale and shouldn't be shown.
          const agentChatIsStale = lastAgentChat && lastUser && lastAgentChatIdx > lastUserIdx;

          // Collect recent thinking/status steps (newest first, deduplicated)
          const recentSteps: WorkspaceMessage[] = [];
          if (agentIsWorking) {
            const seen = new Set<string>();
            for (const m of msgs) {
              if (m.senderType !== 'agent') break; // stop at first non-agent msg
              if (m.messageType === 'status' || m.messageType === 'thinking') {
                // Deduplicate by content (status can repeat)
                const key = m.content.slice(0, 100);
                if (!seen.has(key) && m.content.trim()) {
                  seen.add(key);
                  recentSteps.push(m);
                }
              }
            }
          }

          results[session.sessionId] = {
            lastUserMessage: lastUser,
            lastAgentMessage: agentIsWorking ? lastAgentStatus : (agentChatIsStale ? null : lastAgentChat),
            recentSteps,
          };

          // Cache messages in chronological order for instant overlay loading
          messageCacheRef.current[session.sessionId] = [...msgs].reverse();
        } catch {
          // Keep existing data on error
        }
      })
    );
    setTileData((prev) => ({ ...prev, ...results }));
  }, [topSessions]);

  // Initial fetch + polling
  useEffect(() => {
    if (topSessions.length === 0) return;
    fetchTileData();
    const interval = setInterval(fetchTileData, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchTileData, topSessions.length]);

  const overlaySession = sessions.find((s) => s.sessionId === overlaySessionId);

  const handleTileClick = (sessionId: string) => {
    acknowledgeCompletion(sessionId);
    setOverlaySessionId(sessionId);
  };

  // Keyboard shortcuts: 1-6 opens corresponding tile overlay, / opens search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in an input/textarea or when overlay is open
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (overlaySessionId) return;

      // "/" to open search
      if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
        setSearchQuery('');
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }

      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 9) {
        const idx = num - 1;
        const session = topSessions[idx];
        if (session) {
          e.preventDefault();
          handleTileClick(session.sessionId);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [topSessions, overlaySessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [searchOpen]);

  // All active sessions for search (beyond the top 6)
  const allActiveSessions = useMemo(() => {
    return [...sessions]
      .filter((s) => s.status === 'active')
      .sort((a, b) => {
        const aTime = a.lastEventAt || (a.createdAt ? new Date(a.createdAt).getTime() : 0);
        const bTime = b.lastEventAt || (b.createdAt ? new Date(b.createdAt).getTime() : 0);
        return bTime - aTime;
      });
  }, [sessions]);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return allActiveSessions;
    const q = searchQuery.toLowerCase();
    return allActiveSessions.filter((s) => {
      const title = (s.title || '').toLowerCase();
      const preview = lastMessageBySession[s.sessionId]?.content?.toLowerCase() || '';
      return title.includes(q) || preview.includes(q);
    });
  }, [allActiveSessions, searchQuery, lastMessageBySession]);

  const handleSearchSelect = (sessionId: string) => {
    setSearchOpen(false);
    setSearchQuery('');
    handleTileClick(sessionId);
  };

  return (
    <>
      <div className="relative h-full flex flex-col">
        {/* Tile grid */}
        <div className={cn('grid grid-cols-3 gap-2.5 flex-1 min-h-0', tileCount === 9 ? 'grid-rows-3' : 'grid-rows-2')}>
          {topSessions.map((session, idx) => (
            <MonitorTile
              key={session.sessionId}
              session={session}
              tileData={tileData[session.sessionId]}
              isActive={activeSessionIds.has(session.sessionId)}
              isCompleted={completedSessionIds.has(session.sessionId)}
              agents={agents}
              onClick={() => handleTileClick(session.sessionId)}
              shortcutKey={idx + 1}
            />
          ))}
          {Array.from({ length: Math.max(0, tileCount - topSessions.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="border border-dashed border-input rounded-xl flex items-center justify-center text-muted-foreground/40 text-xs"
            >
              No thread
            </div>
          ))}
        </div>

        {/* Search FAB — bottom right */}
        {!searchOpen && (
          <button
            onClick={() => { setSearchOpen(true); setSearchQuery(''); }}
            className="absolute bottom-3 right-3 size-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors z-10"
            title="Search threads (/)"
          >
            <Search className="size-4" />
          </button>
        )}

        {/* Search panel — bottom right overlay */}
        {searchOpen && (
          <div className="absolute bottom-3 right-3 w-80 bg-popover border rounded-xl shadow-xl z-20 overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b">
              <Search className="size-4 text-muted-foreground shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchOpen(false);
                    setSearchQuery('');
                  }
                  if (e.key === 'Enter' && filteredSessions.length > 0) {
                    handleSearchSelect(filteredSessions[0].sessionId);
                  }
                }}
                placeholder="Search threads..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                className="size-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* Thread list */}
            <div className="max-h-64 overflow-y-auto">
              {filteredSessions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No threads found</p>
              ) : (
                filteredSessions.map((session) => {
                  const isInGrid = topSessions.some((t) => t.sessionId === session.sessionId);
                  const preview = lastMessageBySession[session.sessionId];
                  const activityMs = session.lastEventAt;
                  const displayTime = activityMs
                    ? timeAgo(new Date(activityMs).toISOString())
                    : session.createdAt ? timeAgo(session.createdAt) : '';
                  return (
                    <button
                      key={session.sessionId}
                      onClick={() => handleSearchSelect(session.sessionId)}
                      className="w-full text-left px-3 py-2 hover:bg-accent transition-colors flex flex-col gap-0.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate flex-1">
                          {session.title || 'Untitled'}
                        </span>
                        {isInGrid && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
                            in grid
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground shrink-0">{displayTime}</span>
                      </div>
                      {preview?.content && (
                        <p className="text-[11px] text-muted-foreground truncate">
                          {preview.senderName}: {preview.content}
                        </p>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {overlaySessionId && overlaySession && (
        <MonitorOverlay
          sessionId={overlaySessionId}
          session={overlaySession}
          initialMessages={messageCacheRef.current[overlaySessionId]}
          open
          onOpenChange={(open) => { if (!open) setOverlaySessionId(null); }}
        />
      )}
    </>
  );
}
