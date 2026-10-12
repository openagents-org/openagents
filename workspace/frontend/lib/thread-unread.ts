import type { WorkspaceSession } from './types';

export function threadUnreadState(sessions: WorkspaceSession[], readAt: Record<string, number>, open: string | null) {
  const counts: Record<string, number> = {};
  const completed = new Set<string>();
  for (const session of sessions) {
    const id = session.sessionId;
    if (id === open || readAt[id] === undefined) continue;
    // An in-flight poll may still be based on the marker from before opening.
    if (session.readAt === readAt[id] && session.unreadCount) counts[id] = session.unreadCount;
    if ((session.completionAt || 0) > readAt[id]) completed.add(id);
  }
  return { counts, completed };
}
