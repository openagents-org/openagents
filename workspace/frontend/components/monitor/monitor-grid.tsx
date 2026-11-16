'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquarePlus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { cn } from '@/lib/utils';
import { sessionActivityTime } from '@/lib/conversation-list';
import { useT } from '@/lib/i18n';
import { MonitorTile } from './monitor-tile';
import { MonitorOverlay } from './monitor-overlay';
import { MonitorSearchPanel } from './monitor-search-panel';
import { useMonitorTiles } from './use-monitor-tiles';

export type { TileData } from './use-monitor-tiles';

export function MonitorGrid() {
  const { sessions, activeSessionIds, completedSessionIds, agents, acknowledgeCompletion, lastMessageBySession, currentSessionId } = useWorkspace();
  const { openNewThread } = useLayout();
  const t = useT();
  const [overlaySessionId, setOverlaySessionId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeSessions = useMemo(() => {
    return [...sessions]
      .filter((s) => s.status === 'active' && !s.sessionId.startsWith('routine:'))
      .sort((a, b) => sessionActivityTime(b) - sessionActivityTime(a));
  }, [sessions]);

  const tileCount = activeSessions.length >= 9 ? 9 : 6;
  const topSessions = useMemo(() => activeSessions.slice(0, tileCount), [activeSessions, tileCount]);
  const { tileData, messageCacheRef } = useMonitorTiles(topSessions);


  const overlaySession = sessions.find((s) => s.sessionId === overlaySessionId);

  const handleTileClick = (sessionId: string) => {
    acknowledgeCompletion(sessionId);
    setOverlaySessionId(sessionId);
  };

  // A thread created from the "New thread" FAB becomes the current session
  // (createSession selects it). In monitor mode there is no thread pane to
  // land in, so open it in the overlay — otherwise the user is left staring
  // at the grid with the new tile somewhere in it.
  const seenSessionRef = useRef(currentSessionId);
  useEffect(() => {
    if (currentSessionId && currentSessionId !== seenSessionRef.current) {
      setOverlaySessionId(currentSessionId);
    }
    seenSessionRef.current = currentSessionId;
  }, [currentSessionId]);

  // Keyboard shortcuts: 1-9 opens corresponding tile overlay, / opens search, n starts a new thread
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

      // "n" to start a new thread (same picker as the sidebar button)
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openNewThread();
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
      .sort((a, b) => sessionActivityTime(b) - sessionActivityTime(a));
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

  const closeSearch = () => { setSearchOpen(false); setSearchQuery(''); };
  const gridIds = useMemo(() => new Set(topSessions.map((s) => s.sessionId)), [topSessions]);
  const fab = 'absolute bottom-3 z-10 rounded-full shadow-lg';

  return (
    <>
      <div className="relative flex h-full flex-col">
        {/* Tile grid */}
        <div className={cn('grid min-h-0 flex-1 grid-cols-3 gap-2.5', tileCount === 9 ? 'grid-rows-3' : 'grid-rows-2')}>
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
              className="flex items-center justify-center rounded-xl border border-dashed border-input text-xs text-muted-foreground/40"
            >
              {t('monitor.noThread')}
            </div>
          ))}
        </div>

        {/* FABs — bottom right: new thread, then search */}
        {!searchOpen && (
          <>
            <Button size="icon-lg" onClick={openNewThread} className={cn(fab, 'right-15')} title={t('threads.newThread')} aria-label={t('threads.newThread')}>
              <MessageSquarePlus />
            </Button>
            <Button size="icon-lg" onClick={() => { setSearchOpen(true); setSearchQuery(''); }} className={cn(fab, 'right-3')} title={t('monitor.searchThreads')} aria-label={t('monitor.searchThreads')}>
              <Search />
            </Button>
          </>
        )}

        {searchOpen && (
          <MonitorSearchPanel
            inputRef={searchInputRef}
            query={searchQuery}
            onQuery={setSearchQuery}
            sessions={filteredSessions}
            gridIds={gridIds}
            lastMessageBySession={lastMessageBySession}
            agents={agents}
            onSelect={handleSearchSelect}
            onClose={closeSearch}
          />
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
