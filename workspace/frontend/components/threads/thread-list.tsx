'use client';

import { toast } from 'sonner';
import { useState, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { channelSessions, isIssueWorkSession, isRoutineSession, mergeConversationRows, sessionActivityTime, type ConversationRow } from '@/lib/conversation-list';
import { agentLabel } from '@/lib/helpers';
import { useWorkspace } from '@/lib/workspace-context';
import { useLayout } from '@/components/layout/layout-context';
import { useFormatters, useT } from '@/lib/i18n';
import { workspaceApi } from '@/lib/api';
import { addressName, dmCounterpart, dmSessionId, LEGACY_HUMAN, myAddress } from '@/lib/dm';
import { onlineMemberNames } from '@/lib/sidebar-members';
import { useHumanNames, useTeamRoster } from '@/hooks/use-team-roster';
import { filterMentionPeople } from '@/lib/people-mentions';
import type { DMConversation, WorkspaceSession } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DmRow } from './dm-row';
import { NewDmMenu } from './new-dm-menu';
import { ThreadListEmpty } from './thread-list-empty';
import { ThreadConversationFilter, ThreadListHeader, ThreadSearch } from './thread-list-header';
import { buildThreadPreview } from './thread-preview';
import { ThreadRow } from './thread-row';
import { ThreadRowMenu } from './thread-row-menu';
import { useThreadProjectActions } from './use-thread-project-actions';
import { MoveToProjectMenu, ProjectPersonalHint, startThreadDrag, ThreadProjectBar, ThreadProjectGroup, ThreadProjectLayoutToggle } from './thread-projects';
import { useThreadSearch, useThreadShortcuts } from './use-thread-list-input';
import { TABS, dmDedupKey, dmDisplayTitle, dmRowId, highlightMatch, type FilterTab, type SortOrder } from './thread-list-utils';
import { threadPrivacyApplies } from '@/components/chat/thread-privacy-control';
import { prefetchChannelParticipants } from '@/lib/channel-participants-store';

export function ThreadList() {
  const {
    workspace, sessions, currentSessionId, setCurrentSessionId, agents, lastMessageBySession,
    activeSessionIds, completedSessionIds, dmConversations,
    unreadSessionIds, unreadThreadCounts, unreadDmSessionIds, unreadSignals, refreshAgents, refreshDMConversations, currentUser, onlineUsers,
  } = useWorkspace();
  const me = myAddress(currentUser);
  const humanNames = useHumanNames();
  const { isMobile, openMobileDetail, openNewThread, openNewChannel, threadFilter: filter, setThreadFilter: setFilter, setSelectedAgentName } = useLayout();
  const t = useT();
  const { timeAgo } = useFormatters();

  const [sortOrder, setSortOrder] = useState<SortOrder>('recent');
  const { searchQuery, setSearchQuery, searching, hitsByChannel, isSearching } = useThreadSearch();

  // Sort by backend last_event_at so rows don't jump around client-side
  const sortedSessions = useMemo(() => {
    return [...sessions]
      .filter((s) =>
        s.status !== 'deleted' && !isIssueWorkSession(s) &&
        // Task working threads live on the Kanban board, not the thread list.
        !s.sessionId.startsWith('task:') && !s.sessionId.startsWith('dm:') &&
        !isRoutineSession(s))
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        if (sortOrder === 'title') return (a.title || '').localeCompare(b.title || '');
        if (sortOrder === 'oldest') return sessionActivityTime(a) - sessionActivityTime(b);
        return sessionActivityTime(b) - sessionActivityTime(a);
      });
  }, [sessions, currentSessionId, sortOrder]);

  const { projectModel, projectCounts, createProject, renameProject, removeProject } = useThreadProjectActions({
    workspaceId: workspace?.workspaceId || '',
    userId: currentUser.id,
    sessions: sortedSessions,
    setFilter,
    setSearchQuery,
  });
  const grouped = projectModel.grouped && !isSearching && filter !== 'dms';

  const activeSessions = useMemo(() => sortedSessions.filter((s) => s.status === 'active'), [sortedSessions]);
  const channels = useMemo(() => channelSessions(sortedSessions), [sortedSessions]);
  const starredSessions = useMemo(() => activeSessions.filter((s) => s.starred), [activeSessions]);
  const archivedSessions = useMemo(() => sortedSessions.filter((s) => s.status === 'archived'), [sortedSessions]);

  // Keep the viewer's DM history even when the counterpart is offline.
  const visibleDMs = useMemo(() => {
    const filtered = [...dmConversations]
      .filter(c => !!dmCounterpart(c.agents, me))
      .sort((a, b) => b.lastMessage.timestamp - a.lastMessage.timestamp);
    const seen = new Set<string>();
    return filtered.filter((c) => {
      const key = dmDedupKey(c.agents, me);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [dmConversations, me]);

  // While searching, the query spans every thread regardless of the active tab
  const tabSessions = isSearching
    ? sortedSessions.filter((s) => s.title?.toLowerCase().includes(searchQuery.toLowerCase()) || hitsByChannel.has(s.sessionId))
    : filter === 'channels' ? channels
    : filter === 'starred' ? starredSessions
    : filter === 'archived' ? archivedSessions
    : activeSessions;
  const visibleSessions = isSearching || projectModel.selected === 'all' ? tabSessions
    : tabSessions.filter(s => (projectModel.assignments[s.sessionId] || 'unorganized') === projectModel.selected);

  const dmTitle = (convo: DMConversation) => {
    const counterpart = dmCounterpart(convo.agents, me);
    if (!counterpart) return dmDisplayTitle(convo.agents, me);
    if (counterpart === me) return t('threads.you');
    const name = addressName(counterpart);
    const agent = agents.find(a => a.agentName === name);
    return agent ? agentLabel(agent) : humanNames[name.toLowerCase()] || name;
  };
  const matchingDMs = !isSearching && projectModel.selected !== 'all' ? [] : isSearching ? visibleDMs.filter(c =>
    `${dmTitle(c)} ${c.agents.join(' ')} ${c.lastMessage.content}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
    hitsByChannel.has(dmRowId(c.agents))) : visibleDMs;
  const allRows = mergeConversationRows(visibleSessions, matchingDMs, sortOrder, dmTitle);
  const sortedDMRows = mergeConversationRows([], matchingDMs, sortOrder, dmTitle);
  const starredRows = mergeConversationRows(visibleSessions, matchingDMs.filter(dm => dm.starred), sortOrder, dmTitle);
  const shortcutIds = isSearching || grouped ? [] : filter === 'all' ? allRows.map(r => r.id)
    : filter === 'dms' ? sortedDMRows.map(r => r.id) : filter === 'starred' ? starredRows.map(r => r.id) : visibleSessions.map(s => s.sessionId);

  const inProject = (s: WorkspaceSession) => projectModel.selected === 'all' || (projectModel.assignments[s.sessionId] || 'unorganized') === projectModel.selected;
  const unreadThreadCount = activeSessions.filter((s) => inProject(s) && unreadSessionIds.has(s.sessionId)).length;
  const unreadDmCount = (projectModel.selected === 'all' ? visibleDMs : []).filter((c) => unreadDmSessionIds.has(dmRowId(c.agents))).length;
  const unreadCount = unreadThreadCount + unreadDmCount;

  // All and DMs count what's unread (Slack-style), hidden at zero; Starred and
  // Archived keep their totals.
  const tabCount: Record<FilterTab, number | undefined> = {
    all: unreadCount,
    channels: channels.filter((s) => inProject(s) && unreadSessionIds.has(s.sessionId)).length,
    starred: starredSessions.filter(inProject).length + (projectModel.selected === 'all' ? visibleDMs : []).filter(dm => dm.starred).length,
    archived: archivedSessions.filter(inProject).length,
    dms: unreadDmCount,
  };

  const selectSession = (sessionId: string) => {
    setSelectedAgentName(null);
    setCurrentSessionId(sessionId);
    if (isMobile) openMobileDetail();
  };

  useThreadShortcuts({ shortcutIds, currentSessionId, isMobile, setCurrentSessionId, openMobileDetail });

  const previewContext = { isSearching, searchQuery, hitsByChannel, lastMessageBySession, agents, humanNames, t };

  const renderSessionRows = (rows: WorkspaceSession[], muted = false, offset = 0) =>
    rows.map((session, idx) => {
      const { node, isStatus } = buildThreadPreview(session.sessionId, previewContext);
      const activityMs = session.lastEventAt;
      return (
        // Hovering a thread reads its roster, so the header opens complete.
        <div key={session.sessionId} draggable onDragStart={event => startThreadDrag(event, session.sessionId)} onPointerEnter={() => { if (threadPrivacyApplies(session.sessionId)) prefetchChannelParticipants(session.sessionId); }}>
        <ThreadRow
          session={session}
          agents={agents}
          isSelected={session.sessionId === currentSessionId}
          isUnread={unreadSessionIds.has(session.sessionId)}
          unreadCount={unreadThreadCounts[session.sessionId] || 0}
          mentionCount={session.sessionId === currentSessionId ? 0 : unreadSignals[session.sessionId]?.mentions ?? 0}
          isRunning={activeSessionIds.has(session.sessionId)}
          isCompleted={completedSessionIds.has(session.sessionId) && !activeSessionIds.has(session.sessionId)}
          preview={node}
          previewIsStatus={isStatus}
          displayTime={activityMs ? timeAgo(new Date(activityMs).toISOString()) : session.createdAt ? timeAgo(session.createdAt) : ''}
          // Hidden while searching: the rendered list reorders but the 1-9
          // handler still operates on activeSessions.
          shortcutKey={!isSearching && !grouped && !muted && idx + offset < 9 ? idx + offset + 1 : null}
          title={isSearching ? highlightMatch(session.title || t('threads.untitled'), searchQuery) : (session.title || t('threads.untitled'))}
          muted={muted}
          onSelect={() => selectSession(session.sessionId)}
          actions={<ThreadRowMenu session={session} projectActions={<MoveToProjectMenu model={projectModel} threadId={session.sessionId} onCreate={() => void createProject(session.sessionId)} />} />}
        />
        </div>
      );
    });

  // ── Start a new DM ──
  // Candidates: online agents plus the workspace's other people (roster
  // cached per workspace; token-only sessions may not have team access, in
  // which case the picker just shows agents).
  const team = useTeamRoster();
  const onlinePeople = useMemo(() => onlineMemberNames(team, onlineUsers), [team, onlineUsers]);
  const dmPeople = useMemo(
    () => [...(me !== LEGACY_HUMAN ? [{ email: addressName(me), name: t('threads.you') }] : []), ...filterMentionPeople(team, '', currentUser.id.includes('@') ? currentUser.id : null)],
    [team, currentUser.id, me, t],
  );
  // Canonical DM id: sorted pair, matching the backend's (lesser, greater)
  // conversation normalization — so opening the same counterpart always
  // lands on the same session id.
  const startDM = (address: string) => selectSession(dmSessionId(me, address));

  const [pendingDm, setPendingDm] = useState<string | null>(null);
  const changeDMPreference = async (id: string, update: { pinned?: boolean; starred?: boolean }) => {
    if (pendingDm) return;
    setPendingDm(id);
    try { await workspaceApi.updateDMPreference(id, update); await refreshDMConversations(); }
    catch { toast.error(t('threads.preferenceFailed')); }
    finally { setPendingDm(null); }
  };

  const renderDMRows = (rows: DMConversation[], offset = 0) =>
    rows.map((convo, idx) => (
      <DmRow
        key={dmRowId(convo.agents)}
        convo={convo}
        shortcutKey={!isSearching && !grouped && idx + offset < 9 ? idx + offset + 1 : null}
        onlinePeople={onlinePeople}
        pendingDm={pendingDm}
        onSelect={selectSession}
        onPreference={(id, update) => void changeDMPreference(id, update)}
      />
    ));

  const renderConversations = (rows: ConversationRow[], muted = false) => {
    if (!grouped) return rows.map((row, index) => row.kind === 'thread' ? renderSessionRows([row.thread], muted, index) : renderDMRows([row.dm], index));
    const groups = [...projectModel.projects, { id: 'unorganized', name: t('threadProjects.unorganized'), color: 4 }].filter(p => projectModel.selected === 'all' || p.id === projectModel.selected);
    return <>
      {groups.map(project => {
        const threads = rows.filter((row): row is Extract<ConversationRow, { kind: 'thread' }> => row.kind === 'thread' && (projectModel.assignments[row.id] || 'unorganized') === project.id).map(row => row.thread);
        if (project.id === 'unorganized' && !threads.length && projectModel.selected !== 'unorganized') return null;
        const projectIndex = projectModel.projects.findIndex(p => p.id === project.id);
        return <ThreadProjectGroup onReorder={projectIndex < 0 ? undefined : (id, placement) => projectModel.reorder(id, project.id, placement)} onMoveUp={projectIndex > 0 ? () => projectModel.moveOrder(project.id, -1) : undefined} onMoveDown={projectIndex >= 0 && projectIndex < projectModel.projects.length - 1 ? () => projectModel.moveOrder(project.id, 1) : undefined} key={project.id} project={project} count={threads.length} unread={threads.filter(s => unreadSessionIds.has(s.sessionId)).length} collapsed={projectModel.collapsed.includes(project.id)} onToggle={() => projectModel.toggle(project.id)} onDrop={id => { if (sortedSessions.some(s => s.sessionId === id)) projectModel.move(id, project.id === 'unorganized' ? null : project.id); }} onRename={project.id === 'unorganized' ? undefined : () => void renameProject(project)} onRemove={() => void removeProject(project)}>{renderSessionRows(threads, muted)}</ThreadProjectGroup>;
      })}
      {rows.some(row => row.kind === 'dm') && <div className="mb-2"><p className="px-3 py-3 text-xs font-semibold text-muted-foreground">{t('threads.tabDms')}</p>{rows.flatMap(row => row.kind === 'dm' ? renderDMRows([row.dm]) : [])}</div>}
    </>;
  };

  const emptyState = (tab: FilterTab) => (
    <ThreadListEmpty
      tab={tab}
      isSearching={isSearching}
      onClearSearch={() => setSearchQuery('')}
      onNewThread={openNewThread}
      onNewChannel={openNewChannel}
    />
  );

  return (
    <div className="flex h-full flex-col bg-background">
      <ThreadListHeader
        onNewThread={openNewThread}
        onRefresh={() => { refreshAgents(); refreshDMConversations(); }}
        onSort={setSortOrder}
        sortOrder={sortOrder}
      />

      <div className="flex shrink-0 items-center gap-1 px-3 pt-2 pb-1">
        <ThreadSearch inline value={searchQuery} searching={searching} onChange={setSearchQuery} />
        <ThreadConversationFilter value={isSearching ? 'all' : filter} counts={tabCount} disabled={isSearching} onChange={value => { setFilter(value); if (value === 'dms') projectModel.select('all'); }} />
      </div>

      {isSearching && <p className="px-4 pb-2 text-xs text-muted-foreground">{t('threadProjects.searchAll')}</p>}
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-3 pt-0.5 pb-2">
        <ThreadProjectBar model={{ ...projectModel, select: id => { projectModel.select(id); if (filter === 'dms') setFilter('all'); } }} counts={projectCounts} onCreate={() => void createProject()} />
        <ThreadProjectLayoutToggle grouped={projectModel.grouped} onChange={projectModel.setGrouped} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {TABS.filter(tab => tab.id === (isSearching ? 'all' : filter)).map((tab) => (
          <div key={tab.id} className="min-h-0 grow" role="region" aria-label={t(tab.labelKey)}>
            {/* Gutters on the viewport, not the rows: the selected row is
                outlined and rounded, and flush against the edge its ring
                collided with the scrollbar. */}
            <ScrollArea className="h-full" viewportClassName="px-2 [&>div]:flex! [&>div]:min-h-full [&>div]:flex-col">
              {tab.id === 'all' ? (
                allRows.length === 0 && !(grouped && projectModel.projects.length) ? emptyState('all') : renderConversations(allRows)
              ) : tab.id === 'dms' ? (
                <>
                  {!isSearching && <NewDmMenu agents={agents} people={me === LEGACY_HUMAN ? [] : dmPeople} onStart={startDM} />}
                  {sortedDMRows.length === 0 ? emptyState('dms') : sortedDMRows.map((row, idx) => row.kind === 'dm' ? renderDMRows([row.dm], idx) : null)}
                </>
              ) : tab.id === 'starred' ? (
                starredRows.length === 0 ? emptyState('starred') : renderConversations(starredRows)
              ) : tab.id === 'channels' && visibleSessions.length > 0 && !isSearching ? (
                <>
                  <div className="flex px-1 py-2">
                    <Button variant="outline" size="sm" onClick={openNewChannel}>
                      <Plus data-icon="inline-start" />
                      {t('threads.newChannel')}
                    </Button>
                  </div>
                  {renderConversations(mergeConversationRows(visibleSessions, [], sortOrder, dmTitle))}
                </>
              ) : visibleSessions.length === 0 ? (
                emptyState(tab.id)
              ) : (
                renderConversations(mergeConversationRows(visibleSessions, [], sortOrder, dmTitle), tab.id === 'archived' && !isSearching)
              )}
            </ScrollArea>
          </div>
        ))}
      </div>
      <ProjectPersonalHint />
    </div>
  );
}
