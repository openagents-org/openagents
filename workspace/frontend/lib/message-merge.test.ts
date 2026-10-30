import { describe, it, expect } from 'vitest';
import { compareMessages, mergeMessages } from './message-merge';
import type { WorkspaceMessage } from '@/lib/types';

function msg(
  messageId: string,
  createdAt: string | null,
  overrides: Partial<WorkspaceMessage> = {},
): WorkspaceMessage {
  return {
    messageId,
    sessionId: 'session-1',
    senderId: 'user-1',
    senderName: 'User',
    senderType: 'human',
    content: messageId,
    messageType: 'chat',
    mentions: [],
    targetAgents: null,
    createdAt,
    metadata: {},
    ...overrides,
  } as WorkspaceMessage;
}

describe('compareMessages', () => {
  it('orders by createdAt, then messageId', () => {
    const a = msg('b', '2026-01-01T00:00:00.000Z');
    const b = msg('a', '2026-01-01T00:00:01.000Z');
    expect(compareMessages(a, b)).toBeLessThan(0);
    // Same timestamp — id breaks the tie deterministically.
    const c = msg('a', '2026-01-01T00:00:00.000Z');
    expect(compareMessages(c, a)).toBeLessThan(0);
    expect(compareMessages(a, a)).toBe(0);
  });

  it('sorts null createdAt before any timestamp', () => {
    const nullTs = msg('x', null);
    const dated = msg('y', '2026-01-01T00:00:00.000Z');
    expect(compareMessages(nullTs, dated)).toBeLessThan(0);
  });
});

describe('mergeMessages', () => {
  it('keeps chronological order when an older batch lands after a newer message', () => {
    // The reported P1 scenario — SSE delivers the final reply while the
    // catch-up poll is in flight; the poll then returns older status
    // events. The reply must remain the trailing message, otherwise the
    // UI treats the finished agent as still working.
    const reply = msg('reply', '2026-01-01T00:00:10.000Z', {
      senderType: 'agent',
      messageType: 'chat',
    });
    const oldStatuses = [
      msg('status-1', '2026-01-01T00:00:02.000Z', { senderType: 'agent', messageType: 'status' }),
      msg('status-2', '2026-01-01T00:00:05.000Z', { senderType: 'agent', messageType: 'status' }),
    ];
    const merged = mergeMessages([reply], oldStatuses);
    expect(merged.map((m) => m.messageId)).toEqual(['status-1', 'status-2', 'reply']);
    expect(merged[merged.length - 1].messageType).toBe('chat');
  });

  it('merges history hydration into SSE-delivered state without dropping either', () => {
    // History resolves after SSE already appended a message: hydration must
    // not replace live state, and the merged result is fully ordered.
    const sseDelivered = msg('live', '2026-01-01T00:01:00.000Z', { senderType: 'agent' });
    const history = [
      msg('h1', '2026-01-01T00:00:01.000Z'),
      msg('h2', '2026-01-01T00:00:30.000Z', { senderType: 'agent' }),
    ];
    const merged = mergeMessages([sseDelivered], history);
    expect(merged.map((m) => m.messageId)).toEqual(['h1', 'h2', 'live']);
  });

  it('dedupes by messageId', () => {
    const a = msg('a', '2026-01-01T00:00:00.000Z');
    const merged = mergeMessages([a], [msg('a', '2026-01-01T00:00:00.000Z'), msg('b', '2026-01-01T00:00:01.000Z')]);
    expect(merged.map((m) => m.messageId)).toEqual(['a', 'b']);
  });

  it('returns the same array reference when nothing new arrives', () => {
    const prev = [msg('a', '2026-01-01T00:00:00.000Z')];
    expect(mergeMessages(prev, [])).toBe(prev);
    expect(mergeMessages(prev, [msg('a', '2026-01-01T00:00:00.000Z')])).toBe(prev);
  });
});
