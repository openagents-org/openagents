import { expect, it } from 'vitest';
import { sidebarMembers } from './sidebar-members';
import type { DMConversation, OnlineUser, TeamMember } from './types';
const me = 'human:me@example.com';
const team = ['me', 'sam', 'priya', 'jonas', 'a', 'b', 'c', 'd'].map(name => ({ email: `${name}@example.com`, displayName: name, role: 'member', avatarUrl: null, joinedAt: null })) as TeamMember[];
const online = (names: string[]): OnlineUser[] => names.map(name => ({ id: `${name}@example.com`, name, status: 'online', lastSeen: 1 }));
const dm = (name: string, timestamp: number): DMConversation => ({ agents: [me, `human:${name}@example.com`], lastMessage: { content: 'Hi', sender: me, timestamp }, messageCount: 1 });
it('sorts DM history by recency, keeps offline contacts, and caps new online suggestions at three', () => {
  const rows = sidebarMembers(team, online(['me', 'sam', 'a', 'b', 'c', 'd']), [dm('sam', 10), dm('priya', 30), dm('jonas', 20)], me);
  expect(rows.map(row => row.name)).toEqual(['me', 'priya', 'jonas', 'sam', 'a', 'b', 'c']);
  expect(rows[1]).toMatchObject({ online: false, hasHistory: true });
  expect(rows[4]).toMatchObject({ online: true, hasHistory: false });
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
