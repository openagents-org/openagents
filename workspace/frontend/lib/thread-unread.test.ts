import { describe, it, expect } from 'vitest';
import { threadUnreadState } from './thread-unread';
import type { WorkspaceSession } from './types';
const session = (id: string, unreadCount: number, completionAt: number | null = null) => ({ sessionId: id, unreadCount, readAt: 100, completionAt }) as WorkspaceSession;
describe('thread unread state', () => {
  it('counts all unread messages but only highlights attributed completions', () => {
    const result = threadUnreadState([session('mine', 3, 150), session('others', 5)], { mine: 100, others: 100 }, null);
    expect(result.counts).toEqual({ mine: 3, others: 5 });
    expect([...result.completed]).toEqual(['mine']);
  });
  it('clears counts and highlights on opening or reading despite stale polls', () => {
    const rows = [session('mine', 3, 150)];
    expect(threadUnreadState(rows, { mine: 100 }, 'mine').counts).toEqual({});
    const result = threadUnreadState(rows, { mine: 200 }, null);
    expect(result.counts).toEqual({});
    expect(result.completed.size).toBe(0);
  });
  it('does not count unbaselined or empty threads', () => {
    expect(threadUnreadState([session('new', 10), session('read', 0)], { read: 100 }, null).counts).toEqual({});
  });
});
