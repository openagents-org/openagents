import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNREAD_WINDOW_MS } from './unread-window';
import { dmUnreadCounts } from './dm-unread';
import { dmSessionId } from './dm';
import type { DMConversation } from './types';

const me = 'human:me@example.com';
const person = 'human:sam@example.com';
const agent = 'openagents:scout';
const conversation = (other: string, count: number): DMConversation => ({ agents: [me, other], messageCount: 20, lastMessage: { content: 'Hi', sender: other, timestamp: 200 }, unreadCount: count, readAt: 100 });
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(UNREAD_WINDOW_MS); });
afterEach(() => vi.restoreAllMocks());

describe('DM unread badges', () => {
  it('expires old badges and fallback dots, including when a signal exists', () => {
    vi.mocked(Date.now).mockReturnValue(UNREAD_WINDOW_MS + 200);
    const id = dmSessionId(me, person), c = conversation(person, 3);
    expect(dmUnreadCounts([c], me, null, { [id]: 100 }, {})).toEqual({ [id]: 3 });
    vi.mocked(Date.now).mockReturnValue(UNREAD_WINDOW_MS + 201);
    expect(dmUnreadCounts([c], me, null, { [id]: 100 }, {})).toEqual({});
    expect(dmUnreadCounts([{ ...c, unreadCount: undefined }], me, null, { [id]: 100 }, {
      [id]: { dms: 2, mentions: 0, latest: {} as never },
    })).toEqual({});
  });
  it('uses incoming message counts for both humans and agents', () => {
    const a = dmSessionId(me, person), b = dmSessionId(me, agent);
    expect(dmUnreadCounts([conversation(person, 3), conversation(agent, 5)], me, null, { [a]: 100, [b]: 100 }, {})).toEqual({ [a]: 3, [b]: 5 });
  });
  it('clears on opening and rejects stale responses after reading', () => {
    const id = dmSessionId(me, person), c = conversation(person, 3);
    expect(dmUnreadCounts([c], me, id, { [id]: 100 }, {})).toEqual({});
    expect(dmUnreadCounts([c], me, null, { [id]: 250 }, {})).toEqual({});
  });
  it('ignores other people’s conversations and zero counts', () => {
    const c = conversation(person, 0), id = dmSessionId(me, person);
    const foreign = { ...conversation(agent, 10), agents: [person, agent] as [string, string] };
    expect(dmUnreadCounts([c, foreign], me, null, { [id]: 100 }, {})).toEqual({});
  });
  it('does not mistake outgoing messages for unread incoming messages', () => {
    const c = { ...conversation(person, 0), unreadCount: undefined, lastMessage: { content: 'Sent', sender: me, timestamp: 200 } };
    expect(dmUnreadCounts([c], me, null, { [dmSessionId(me, person)]: 100 }, {})).toEqual({});
  });
});
