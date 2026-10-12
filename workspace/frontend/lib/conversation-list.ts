import type { DMConversation, WorkspaceSession } from './types';
/** Issue execution channels use this reserved, server-generated ID prefix.
 * Keep them in workspace state for issue links and direct URLs, but out of
 * conversation navigation. Linking an ordinary thread never changes its ID. */
export function isIssueWorkSession(session: Pick<WorkspaceSession, 'sessionId'>) {
  return session.sessionId.startsWith('issue-work-');
}

export type ConversationRow = { kind: 'thread'; id: string; thread: WorkspaceSession; time: number; title: string } | { kind: 'dm'; id: string; dm: DMConversation; time: number; title: string };
export function mergeConversationRows(threads: WorkspaceSession[], dms: DMConversation[], order: 'recent' | 'oldest' | 'title', dmTitle: (dm: DMConversation) => string): ConversationRow[] {
  const rows: ConversationRow[] = [
    ...threads.filter(s => !isIssueWorkSession(s) && !s.sessionId.startsWith('dm:')).map(thread => ({ kind: 'thread' as const, id: thread.sessionId, thread, time: thread.lastEventAt || (thread.createdAt ? Date.parse(thread.createdAt) : 0), title: thread.title || '' })),
    ...dms.map(dm => ({ kind: 'dm' as const, id: `dm:${dm.agents[0]},${dm.agents[1]}`, dm, time: dm.lastMessage.timestamp, title: dmTitle(dm) })),
  ];
  return rows.sort((a, b) => {
    const aPinned = a.kind === 'thread' && !!a.thread.pinned;
    const bPinned = b.kind === 'thread' && !!b.thread.pinned;
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    return order === 'title' ? a.title.localeCompare(b.title) : order === 'oldest' ? a.time - b.time : b.time - a.time;
  });
}

/** Channels are a label on active threads, not a separate conversation type. */
export function channelSessions(sessions: WorkspaceSession[]) {
  return sessions.filter((s) => !isIssueWorkSession(s) && s.isChannel && s.status === 'active' && !s.sessionId.startsWith('dm:'));
}
