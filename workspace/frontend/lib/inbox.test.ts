import { describe, expect, it } from 'vitest';
import { groupInboxRows, inboxActionKind, isActionableNotification, isAddressedToMe, inboxDestination, threadFilterFor } from './inbox';
import type { NotificationItem } from './types';

let seq = 0;
function row(over: Partial<NotificationItem> = {}): NotificationItem {
  seq += 1;
  return {
    id: `n${seq}`,
    title: 'Question from agent-alpha',
    message: 'agent-alpha is asking you: ship it?',
    priority: 'normal',
    isRead: false,
    createdBy: 'openagents:agent-alpha',
    channelName: 'general',
    threadId: null,
    linkUrl: null,
    status: 'active',
    kind: null,
    actionRef: null,
    recipientEmail: null,
    createdAt: new Date(1_700_000_000_000 + seq * 60_000).toISOString(),
    readAt: null,
    ...over,
  };
}

const ME = 'mia@acme.test';

describe('inboxActionKind / isActionableNotification', () => {
  it('needs both a known kind and an action ref', () => {
    expect(inboxActionKind(row({ kind: 'approval', actionRef: 'a1' }))).toBe('approval');
    expect(inboxActionKind(row({ kind: 'approval', actionRef: 'a1' }))).toBe('approval');
    expect(inboxActionKind(row({ kind: 'approval', actionRef: null }))).toBeNull();
    expect(inboxActionKind(row({ kind: 'handoff', actionRef: 'x' }))).toBeNull();
    expect(inboxActionKind(row({ kind: null, actionRef: null }))).toBeNull();
    expect(isActionableNotification(row({ kind: 'approval', actionRef: 'a1' }))).toBe(true);
    expect(isActionableNotification(row())).toBe(false);
  });
});

describe('isAddressedToMe', () => {
  it('treats an unaddressed row as everyone\'s, and matches emails case-insensitively', () => {
    expect(isAddressedToMe(row({ recipientEmail: null }), ME)).toBe(true);
    expect(isAddressedToMe(row({ recipientEmail: null }), null)).toBe(true);
    expect(isAddressedToMe(row({ recipientEmail: 'Mia@Acme.test' }), ME)).toBe(true);
    expect(isAddressedToMe(row({ recipientEmail: 'adam@acme.test' }), ME)).toBe(false);
    expect(isAddressedToMe(row({ recipientEmail: 'adam@acme.test' }), null)).toBe(false);
  });
});

describe('groupInboxRows', () => {
  it('puts unresolved actionable rows addressed to me (or nobody) under Needs you', () => {
    const mine = row({ kind: 'approval', actionRef: 'a1', recipientEmail: ME });
    const anyone = row({ kind: 'approval', actionRef: 'a2', recipientEmail: null });
    const theirs = row({ kind: 'approval', actionRef: 'a3', recipientEmail: 'adam@acme.test' });
    const notice = row({ title: 'Deploy finished' });
    const { needsYou, updates } = groupInboxRows([notice, theirs, anyone, mine], ME);
    // Same priority → newest first; `anyone` was created after `mine`.
    expect(needsYou.map((n) => n.id)).toEqual([anyone.id, mine.id]);
    expect(updates.map((n) => n.id).sort()).toEqual([notice.id, theirs.id].sort());
  });

  it('moves a resolved request to Updates even when it was addressed to me', () => {
    const open = row({ kind: 'approval', actionRef: 'p1', recipientEmail: ME });
    const done = row({ kind: 'approval', actionRef: 'h1', recipientEmail: ME });
    const { needsYou, updates } = groupInboxRows([open, done], ME, new Set(['h1']));
    expect(needsYou.map((n) => n.id)).toEqual([open.id]);
    expect(updates.map((n) => n.id)).toEqual([done.id]);
  });

  it('orders Needs you by priority then newest, and Updates unread-first then newest', () => {
    const oldHigh = row({ kind: 'approval', actionRef: 'a', priority: 'high', createdAt: '2026-01-01T00:00:00Z' });
    const newNormal = row({ kind: 'approval', actionRef: 'b', priority: 'normal', createdAt: '2026-02-01T00:00:00Z' });
    const newLow = row({ kind: 'approval', actionRef: 'c', priority: 'low', createdAt: '2026-03-01T00:00:00Z' });
    const readNew = row({ isRead: true, createdAt: '2026-03-01T00:00:00Z' });
    const unreadOld = row({ isRead: false, createdAt: '2026-01-01T00:00:00Z' });
    const unreadNew = row({ isRead: false, createdAt: '2026-02-01T00:00:00Z' });
    const { needsYou, updates } = groupInboxRows([newLow, newNormal, oldHigh, readNew, unreadOld, unreadNew], ME);
    expect(needsYou.map((n) => n.id)).toEqual([oldHigh.id, newNormal.id, newLow.id]);
    expect(updates.map((n) => n.id)).toEqual([unreadNew.id, unreadOld.id, readNew.id]);
  });

  it('never drops a row and handles an unknown caller', () => {
    const rows = [row(), row({ kind: 'approval', actionRef: 'a1' }), row({ kind: 'approval', actionRef: 'a2', recipientEmail: 'x@y.z' })];
    const { needsYou, updates } = groupInboxRows(rows, null);
    expect(needsYou.length + updates.length).toBe(3);
    // Nobody signed in: only the unaddressed request is a to-do.
    expect(needsYou.map((n) => n.actionRef)).toEqual(['a1']);
  });
});

describe('inboxDestination', () => {
  it('sends credit notices to the checklist, whatever thread they name', () => {
    expect(inboxDestination(row({ createdBy: 'system:campaign', channelName: null }))).toEqual({ kind: 'credits' });
  });

  it('tells task threads, DMs and ordinary threads apart', () => {
    expect(inboxDestination(row({ channelName: 'task:42' }))).toEqual({ kind: 'task', channel: 'task:42' });
    expect(inboxDestination(row({ channelName: 'dm:a,b' }))).toEqual({ kind: 'dm', channel: 'dm:a,b' });
    expect(inboxDestination(row({ channelName: 'launch' }))).toEqual({ kind: 'thread', channel: 'launch' });
    expect(inboxDestination(row({ channelName: null }))).toBeNull();
  });
});

describe('threadFilterFor', () => {
  const thread = { status: 'active', starred: false, isChannel: false };
  it('shows an archived thread under Archived', () => {
    expect(threadFilterFor({ ...thread, status: 'archived' }, 'all')).toBe('archived');
  });

  it('keeps the tab when it lists the thread, and falls back to All when not', () => {
    expect(threadFilterFor({ ...thread, isChannel: true }, 'channels')).toBe('channels');
    expect(threadFilterFor({ ...thread, starred: true }, 'starred')).toBe('starred');
    expect(threadFilterFor(thread, 'channels')).toBe('all');
    expect(threadFilterFor(thread, 'dms')).toBe('all');
  });
});
