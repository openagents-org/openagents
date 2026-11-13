import { expect, it } from 'vitest';
import { SIDEBAR_MEMBER_LIMIT, sidebarMembers } from './sidebar-members';
import type { DMConversation, OnlineUser, TeamMember } from './types';
const me = 'human:me@example.com';
const team = ['me', 'sam', 'priya', 'jonas', 'a', 'b', 'c', 'd'].map(name => ({ email: `${name}@example.com`, displayName: name, role: 'member', avatarUrl: null, joinedAt: null })) as TeamMember[];
const online = (names: string[]): OnlineUser[] => names.map(name => ({ id: `${name}@example.com`, name, status: 'online', lastSeen: 1 }));
const dm = (name: string, timestamp: number): DMConversation => ({ agents: [me, `human:${name}@example.com`], lastMessage: { content: 'Hi', sender: me, timestamp }, messageCount: 1 });
it('puts online people first, then recent DMs, and stops at five rows including yourself', () => {
  const rows = sidebarMembers(team, online(['me', 'sam', 'a', 'b', 'c', 'd']), [dm('sam', 10), dm('priya', 30), dm('jonas', 20)], me);
  expect(rows.map(row => row.name)).toEqual(['me', 'sam', 'a', 'b', 'c']);
  expect(rows).toHaveLength(SIDEBAR_MEMBER_LIMIT);
  expect(rows[1]).toMatchObject({ online: true, lastMessageAt: 10 });
  expect(rows[2]).toMatchObject({ online: true, lastMessageAt: 0 });
});
it('fills the rest with offline contacts by recency once the online people run out', () => {
  const rows = sidebarMembers(team, online(['me', 'a']), [dm('sam', 10), dm('priya', 30), dm('jonas', 20), dm('b', 5)], me);
  expect(rows.map(row => row.name)).toEqual(['me', 'a', 'priya', 'jonas', 'sam']);
  expect(rows[2]).toMatchObject({ online: false, lastMessageAt: 30 });
});
it('never cuts a row with unread DMs and lists it first', () => {
  // Three online colleagues would fill the list; an offline one has written to you.
  const unread = (email: string) => (email === 'jonas@example.com' ? 2 : 0);
  const rows = sidebarMembers(team, online(['me', 'sam', 'a', 'b', 'c']), [dm('jonas', 5)], me, undefined, unread);
  expect(rows.map(row => row.name)).toEqual(['me', 'jonas', 'a', 'b', 'c']);
  expect(rows[1]).toMatchObject({ online: false, unread: 2 });
  // More unread rows than the limit: all of them stay.
  const all = sidebarMembers(team, online(['me', 'a', 'b']), ['sam', 'priya', 'jonas', 'c', 'd'].map((name, i) => dm(name, i + 1)), me, undefined, email => (/^(sam|priya|jonas|c|d)@/.test(email) ? 1 : 0));
  expect(all.map(row => row.name)).toEqual(['me', 'd', 'c', 'jonas', 'priya', 'sam']);
});
it('deduplicates history and ignores agent DMs, other people’s DMs and empty conversations', () => {
  const rows = sidebarMembers(team, [], [dm('sam', 10), dm('sam', 50), { ...dm('priya', 60), messageCount: 0 }, { ...dm('priya', 70), agents: ['human:jonas@example.com', 'human:priya@example.com'] }, { ...dm('sam', 99), agents: [me, 'openagents:scout'] }], me);
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ email: 'sam@example.com', lastMessageAt: 50 });
});
it('resolves legacy presence ids only through unique roster names', () => {
  expect(sidebarMembers(team, [{ id: 'device-id', name: 'sam', status: 'online', lastSeen: 1 }], [], me)[1].email).toBe('sam@example.com');
  expect(sidebarMembers([...team, { ...team[0], email: 'other@example.com', displayName: 'sam' }], [{ id: 'device-id', name: 'sam', status: 'online', lastSeen: 1 }], [], me).map(row => row.email)).toEqual(['me@example.com']);
});

it('always offers an authenticated self DM, even without roster or history, and never duplicates it', () => {
  const rows = sidebarMembers([], [], [dm('me', 10)], me, 'Maya Chen');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ email: 'me@example.com', name: 'Maya Chen' });
  expect(sidebarMembers([], [], [], 'human:user')).toEqual([]);
});

it('names yourself by your profile, not the email the session started with', () => {
  expect(sidebarMembers(team, [], [], me, 'me@example.com')[0].name).toBe('me');
});
