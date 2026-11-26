import { describe, expect, it, vi } from 'vitest';
import type { ONMEvent } from './types';
import type { GuestThreadAgent } from './guest-thread-api';
import {
  agentTypeLabel,
  composeOutgoing,
  defaultAskAgent,
  guestEventToMessage,
  isDelivered,
  markSendFailed,
  mergeEvents,
  newPendingSend,
  nextCursor,
  nextPollDelay,
  normalizeGuestName,
  olderCursor,
  optimisticMessage,
  randomId,
  reconcileSent,
  senderIdentity,
  sendPending,
  splitSeed,
  threadPeople,
  toWorkspaceAgents,
  upsertMessage,
  willRunAgent,
  mentionsAgent,
} from './guest-thread';

let clock = 1_700_000_000_000;
function event(partial: Partial<ONMEvent> & { id: string }): ONMEvent {
  return {
    type: 'workspace.message',
    source: 'human:alex@example.com',
    target: 'channel/thread-1',
    payload: { content: 'hi' },
    metadata: {},
    timestamp: (clock += 1000),
    visibility: 'channel',
    ...partial,
  };
}

const AGENTS: GuestThreadAgent[] = [{ name: 'claude-code', displayName: 'Claude Code', type: 'claude', online: true }];
const WS_AGENTS = toWorkspaceAgents(AGENTS);

describe('event → message identity', () => {
  it('maps agent sources to the agent and names it by its handle', () => {
    const m = guestEventToMessage(event({ id: 'e1', source: 'openagents:claude-code', payload: { content: 'Found it', sender_name: 'whatever' } }));
    expect(m.senderType).toBe('agent');
    expect(m.senderName).toBe('claude-code');
    const who = senderIdentity(m, WS_AGENTS, null);
    // The handle, never the display label: the same name in every share-page surface.
    expect(who).toMatchObject({ kind: 'agent', name: 'claude-code', isSelf: false });
    expect(who.agent?.agentName).toBe('claude-code');
  });

  it('marks guest messages as people even from a non-human address, and recognises the viewer', () => {
    const e = event({ id: 'e2', source: 'guest:g-1', payload: { content: 'Please review', sender_name: 'Maya' }, metadata: { guest: { id: 'g-1', name: 'Maya' } } });
    const m = guestEventToMessage(e);
    expect(m.senderType).toBe('human');
    expect(m.senderName).toBe('Maya');
    expect(senderIdentity(m, WS_AGENTS, null)).toMatchObject({ kind: 'guest', name: 'Maya', isSelf: false });
    expect(senderIdentity(m, WS_AGENTS, 'g-1')).toMatchObject({ kind: 'guest', isSelf: true });
    expect(senderIdentity(m, WS_AGENTS, 'g-2').isSelf).toBe(false);
  });

  it('names other people by sender_name, else the part of the email before @', () => {
    const named = guestEventToMessage(event({ id: 'e3', payload: { content: 'x', sender_name: 'Alex Kim' } }));
    expect(senderIdentity(named, WS_AGENTS, null)).toMatchObject({ kind: 'human', name: 'Alex Kim' });
    const bare = guestEventToMessage(event({ id: 'e4', source: 'human:alex@example.com', payload: { content: 'x' } }));
    expect(senderIdentity(bare, WS_AGENTS, null)).toMatchObject({ kind: 'human', name: 'alex' });
  });

  it('puts share-seed excerpts first, in order, apart from the live thread', () => {
    const messages = mergeEvents([], [
      event({ id: 's1', metadata: { share_seed: true } }),
      event({ id: 's2', source: 'openagents:claude-code', metadata: { share_seed: true } }),
      event({ id: 'l1' }),
      event({ id: 'l2', metadata: { share_seed: false } }),
    ]);
    const { seed, rest } = splitSeed(messages);
    expect(seed.map((m) => m.messageId)).toEqual(['s1', 's2']);
    expect(rest.map((m) => m.messageId)).toEqual(['l1', 'l2']);
  });

  it('labels agent types for the seed divider', () => {
    expect(agentTypeLabel('claude')).toBe('Claude Code');
    expect(agentTypeLabel('codex')).toBe('Codex');
    expect(agentTypeLabel('my-custom_agent')).toBe('My Custom Agent');
    expect(agentTypeLabel(null)).toBeNull();
  });
});

describe('poll merge', () => {
  it('dedupes by id across overlapping pages and keeps order', () => {
    const a = event({ id: 'a' }); const b = event({ id: 'b' }); const c = event({ id: 'c' });
    let list = mergeEvents([], [a, b]);
    list = mergeEvents(list, [b, c]);
    list = mergeEvents(list, [c]);
    expect(list.map((m) => m.messageId)).toEqual(['a', 'b', 'c']);
  });

  it('returns the same array when a poll brings nothing new', () => {
    const list = mergeEvents([], [event({ id: 'a' })]);
    expect(mergeEvents(list, [])).toBe(list);
    expect(mergeEvents(list, [event({ id: 'a' })])).toBe(list);
  });

  it('advances the cursor to the newest id only when a page has events', () => {
    expect(nextCursor(null, [event({ id: 'a' }), event({ id: 'b' })])).toBe('b');
    expect(nextCursor('b', [])).toBe('b');
  });

  it('replaces the optimistic copy whether the POST or the poll lands first', () => {
    const guest = { id: 'g-1', name: 'Maya' };
    const pending = newPendingSend('@claude-code review', (() => { let n = 0; return () => `id-${++n}`; })());
    const optimistic = optimisticMessage(pending, guest);
    // The server echoes the send's idempotency key as metadata.client_key.
    const real = event({ id: 'srv-1', source: 'guest:g-1', payload: { content: '@claude-code review' }, metadata: { guest, client_key: pending.idempotencyKey } });

    // POST resolves first, then the poll repeats the event.
    let list = upsertMessage([], optimistic);
    list = reconcileSent(list, pending.localId, real);
    list = mergeEvents(list, [real]);
    expect(list.map((m) => m.messageId)).toEqual(['srv-1']);

    // Poll sees it first (matched by client_key), then the POST resolves.
    let other = upsertMessage([], optimistic);
    other = mergeEvents(other, [real]);
    expect(other.map((m) => m.messageId)).toEqual(['srv-1']);
    other = reconcileSent(other, pending.localId, real);
    expect(other.map((m) => m.messageId)).toEqual(['srv-1']);
  });

  it('keeps a different send with the same text (keys differ)', () => {
    const guest = { id: 'g-1', name: 'Maya' };
    const first = newPendingSend('same'); const second = newPendingSend('same');
    const real = event({ id: 'srv-1', payload: { content: 'same' }, metadata: { guest, client_key: first.idempotencyKey } });
    let list = upsertMessage(upsertMessage([], optimisticMessage(first, guest)), optimisticMessage(second, guest));
    list = mergeEvents(list, [real]);
    expect(list.map((m) => m.messageId).sort()).toEqual([second.localId, 'srv-1'].sort());
  });

  it('does not resurrect a failed copy of a send the poll already brought back', () => {
    const guest = { id: 'g-1', name: 'Maya' };
    const pending = newPendingSend('hello');
    const real = event({ id: 'srv-1', payload: { content: 'hello' }, metadata: { guest, client_key: pending.idempotencyKey } });
    let list = upsertMessage([], optimisticMessage(pending, guest));
    list = mergeEvents(list, [real]);
    expect(isDelivered(list, pending.idempotencyKey)).toBe(true);
    list = markSendFailed(list, optimisticMessage(pending, guest, 'failed', 'failed'));
    expect(list.map((m) => m.messageId)).toEqual(['srv-1']);
    // Not delivered: the failed row stays for a retry.
    const other = newPendingSend('again');
    const failed = markSendFailed(list, optimisticMessage(other, guest, 'failed', 'failed'));
    expect(failed.map((m) => m.messageId)).toEqual(['srv-1', other.localId]);
    expect(failed[1].metadata.send_status).toBe('failed');
  });

  it('pages back with the oldest id and prepends in order', () => {
    const latest = [event({ id: 'c' }), event({ id: 'd' })];
    clock -= 10_000;
    const older = [event({ id: 'a' }), event({ id: 'b' })];
    expect(olderCursor(null, latest)).toBe('c');
    expect(olderCursor('c', older)).toBe('a');
    expect(olderCursor('a', [])).toBe('a');
    const list = mergeEvents(mergeEvents([], latest), older);
    expect(list.map((m) => m.messageId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps the shared excerpts together at the top once earlier pages bring them in', () => {
    clock += 100_000;
    const latest = [event({ id: 'l2' }), event({ id: 'l3' })];
    clock -= 50_000;
    const older = [event({ id: 's1', metadata: { share_seed: true } }), event({ id: 's2', metadata: { share_seed: true } }), event({ id: 'l1' })];
    const before = splitSeed(mergeEvents([], latest));
    expect(before.seed).toEqual([]);
    const after = splitSeed(mergeEvents(mergeEvents([], latest), older));
    expect(after.seed.map((m) => m.messageId)).toEqual(['s1', 's2']);
    expect(after.rest.map((m) => m.messageId)).toEqual(['l1', 'l2', 'l3']);
  });

  it('backs off when hidden and on repeated errors', () => {
    expect(nextPollDelay(false, 0)).toBe(3000);
    expect(nextPollDelay(true, 0)).toBeGreaterThan(3000);
    expect(nextPollDelay(false, 2)).toBe(12000);
    expect(nextPollDelay(false, 20)).toBe(30000);
  });
});

describe('Ask agent prefix', () => {
  it('is on by default only with exactly one agent', () => {
    expect(defaultAskAgent(AGENTS)).toBe(true);
    expect(defaultAskAgent([])).toBe(false);
    expect(defaultAskAgent([...AGENTS, { name: 'codex', displayName: null, type: 'codex', online: false }])).toBe(false);
  });

  it('prefixes @name when asking, never doubles it, and leaves comments alone', () => {
    expect(composeOutgoing('  review this PR  ', true, 'claude-code')).toBe('@claude-code review this PR');
    expect(composeOutgoing('@claude-code review this', true, 'claude-code')).toBe('@claude-code review this');
    expect(composeOutgoing('@claude-codex hi', true, 'claude-code')).toBe('@claude-code @claude-codex hi');
    expect(composeOutgoing('nice work', false, 'claude-code')).toBe('nice work');
    expect(composeOutgoing('   ', true, 'claude-code')).toBe('');
  });

  it('knows whether a send will run the agent', () => {
    expect(willRunAgent('hello', true, 'claude-code', AGENTS)).toBe(true);
    expect(willRunAgent('hello', false, null, AGENTS)).toBe(false);
    expect(willRunAgent('@claude-code hello', false, null, AGENTS)).toBe(true);
    expect(willRunAgent('email me@claude-code', false, null, AGENTS)).toBe(false);
    // The server routes a mention anywhere in the message, not only a leading one.
    expect(willRunAgent('hey @claude-code, review this', false, null, AGENTS)).toBe(true);
  });

  it('finds an agent mention anywhere, but not inside an email or a longer name', () => {
    expect(mentionsAgent('please @claude-code look', 'claude-code')).toBe(true);
    expect(mentionsAgent('(@claude-code)', 'claude-code')).toBe(true);
    expect(mentionsAgent('me@claude-code', 'claude-code')).toBe(false);
    expect(mentionsAgent('@claude-codex hi', 'claude-code')).toBe(false);
    expect(mentionsAgent('a.@claude-code', 'claude-code')).toBe(false);
  });
});

describe('sending', () => {
  it('reuses the idempotency key on every retry of the same send', async () => {
    const pending = newPendingSend('hello');
    const post = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(event({ id: 'srv-1' }));
    await expect(sendPending(pending, post)).rejects.toThrow('network');
    await expect(sendPending(pending, post)).resolves.toMatchObject({ id: 'srv-1' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]).toEqual(['hello', pending.idempotencyKey]);
    expect(post.mock.calls[1]).toEqual(['hello', pending.idempotencyKey]);
  });

  it('gives each new send its own key', () => {
    const a = newPendingSend('x'); const b = newPendingSend('x');
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(a.localId).not.toBe(b.localId);
    expect(a.localId.startsWith('optimistic-')).toBe(true);
  });

  it('makes keys the server accepts (16–128 chars), with or without randomUUID', () => {
    expect(randomId().length).toBeGreaterThanOrEqual(16);
    vi.stubGlobal('crypto', {});
    try {
      const key = randomId();
      expect(key.length).toBeGreaterThanOrEqual(16);
      expect(key.length).toBeLessThanOrEqual(128);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('validates display names: trimmed, 1–40 characters', () => {
    expect(normalizeGuestName('  Maya  ')).toBe('Maya');
    expect(normalizeGuestName('   ')).toBeNull();
    expect(normalizeGuestName('x'.repeat(40))).toBe('x'.repeat(40));
    expect(normalizeGuestName('x'.repeat(41))).toBeNull();
    expect(normalizeGuestName('😀'.repeat(40))).toBe('😀'.repeat(40));
  });
});

describe('people', () => {
  it('lists the owner, posters and guests once, and the viewer as You', () => {
    const messages = mergeEvents([], [
      event({ id: '1', payload: { content: 'a', sender_name: 'Alex' } }),
      event({ id: '2', source: 'guest:g-2', metadata: { guest: { id: 'g-2', name: 'Sam' } } }),
      event({ id: '3', source: 'guest:g-2', metadata: { guest: { id: 'g-2', name: 'Sam' } } }),
      event({ id: '4', source: 'openagents:claude-code' }),
    ]);
    const people = threadPeople(messages, 'Alex', { id: 'g-1', name: 'Maya' });
    expect(people.map((p) => [p.name, p.role, p.isSelf])).toEqual([
      ['Alex', 'owner', false],
      ['Sam', 'guest', false],
      ['Maya', 'guest', true],
    ]);
  });
});
