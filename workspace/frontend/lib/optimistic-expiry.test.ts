import { describe, it, expect } from 'vitest';
import { OPTIMISTIC_EXPIRY_MS, nextOptimisticExpiry, pendingOptimisticMessages } from './optimistic-messages';
import type { WorkspaceMessage } from '@/lib/types';

function msg(messageId: string, overrides: Partial<WorkspaceMessage> = {}): WorkspaceMessage {
  return {
    messageId,
    sessionId: 'thread-a',
    senderId: 'user-1',
    senderName: 'User',
    senderType: 'human',
    content: messageId,
    messageType: 'chat',
    mentions: [],
    targetAgents: null,
    createdAt: null,
    metadata: {},
    ...overrides,
  } as WorkspaceMessage;
}

const agentMsg = (messageId: string, messageType: WorkspaceMessage['messageType'] = 'chat') =>
  msg(messageId, { senderType: 'agent', senderName: 'bot', messageType });

/** What handleSend adds for one sent message. */
function sent(content: string, createdAt: string | null = null): WorkspaceMessage[] {
  return [
    msg('optimistic-user-1', { content, createdAt }),
    msg('optimistic-loading-1', {
      createdAt,
      senderType: 'agent',
      senderName: 'bot',
      content: '',
      messageType: 'loading',
      metadata: { _userContent: content },
    }),
  ];
}

const ids = (msgs: WorkspaceMessage[]) => msgs.map((m) => m.messageId);

describe('pendingOptimisticMessages', () => {
  it('keeps both until the server echoes the user message', () => {
    const thread = [msg('m1', { content: 'earlier' }), agentMsg('m2')];
    expect(ids(pendingOptimisticMessages(sent('hurry up'), thread)))
      .toEqual(['optimistic-user-1', 'optimistic-loading-1']);
  });

  it('drops the optimistic user message once the real one arrives, keeps the waiting bubble', () => {
    const thread = [msg('m1', { content: 'earlier' }), agentMsg('m2'), msg('m3', { content: 'hurry up' })];
    expect(ids(pendingOptimisticMessages(sent('hurry up'), thread))).toEqual(['optimistic-loading-1']);
  });

  it('keeps the waiting bubble in a busy thread — agent steps from before the message do not answer it', () => {
    // The agent is mid-task when the user writes again. Its earlier status
    // sits before the new message, so nothing has acknowledged it yet. This
    // is the thread a user comes back to after looking at another one.
    const thread = [
      msg('m1', { content: 'do the report' }),
      agentMsg('m2', 'status'),
      agentMsg('m3', 'thinking'),
      msg('m4', { content: 'hurry up' }),
    ];
    expect(ids(pendingOptimisticMessages(sent('hurry up'), thread))).toEqual(['optimistic-loading-1']);
  });

  it('drops the waiting bubble once an agent message follows the user message', () => {
    const thread = [
      msg('m1', { content: 'do the report' }),
      agentMsg('m2', 'status'),
      msg('m3', { content: 'hurry up' }),
      agentMsg('m4', 'status'),
    ];
    expect(pendingOptimisticMessages(sent('hurry up'), thread)).toEqual([]);
  });

  it('shows nothing stale over a reply that landed while the thread was not open', () => {
    const thread = [msg('m1', { content: 'hurry up' }), agentMsg('m2', 'status'), agentMsg('m3')];
    expect(pendingOptimisticMessages(sent('hurry up'), thread)).toEqual([]);
  });

  it('keeps everything while the thread has no messages loaded yet', () => {
    expect(ids(pendingOptimisticMessages(sent('first message'), [])))
      .toEqual(['optimistic-user-1', 'optimistic-loading-1']);
  });

  describe('the same text sent twice', () => {
    const t0 = Date.parse('2026-10-12T10:00:00Z');
    const at = (ms: number) => new Date(t0 + ms).toISOString();
    // "ok" was sent and answered a minute ago; now "ok" again.
    const earlier = [
      msg('m1', { content: 'ok', createdAt: at(-60_000) }),
      agentMsg('m2'),
    ];
    earlier[1].createdAt = at(-55_000);

    it('keeps both for the second send — the earlier "ok" and its answer do not confirm it', () => {
      expect(ids(pendingOptimisticMessages(sent('ok', at(0)), earlier, t0 + 1_000)))
        .toEqual(['optimistic-user-1', 'optimistic-loading-1']);
    });

    it('keeps the waiting bubble once the second "ok" is echoed, until the agent answers it', () => {
      const echoed = [...earlier, msg('m3', { content: 'ok', createdAt: at(800) })];
      expect(ids(pendingOptimisticMessages(sent('ok', at(0)), echoed, t0 + 2_000)))
        .toEqual(['optimistic-loading-1']);
      const answered = [...echoed, agentMsg('m4', 'status')];
      expect(pendingOptimisticMessages(sent('ok', at(0)), answered, t0 + 3_000)).toEqual([]);
    });

    it('tolerates a server clock a few seconds behind', () => {
      const echoed = [...earlier, msg('m3', { content: 'ok', createdAt: at(-3_000) })];
      expect(ids(pendingOptimisticMessages(sent('ok', at(0)), echoed, t0 + 2_000)))
        .toEqual(['optimistic-loading-1']);
    });
  });

  it('drops an entry nobody answered within 3 minutes', () => {
    const t0 = Date.parse('2026-10-12T10:00:00Z');
    const pending = sent('hello?', new Date(t0).toISOString());
    expect(ids(pendingOptimisticMessages(pending, [], t0 + OPTIMISTIC_EXPIRY_MS - 1)))
      .toEqual(['optimistic-user-1', 'optimistic-loading-1']);
    expect(pendingOptimisticMessages(pending, [], t0 + OPTIMISTIC_EXPIRY_MS + 1)).toEqual([]);
    expect(nextOptimisticExpiry(pending)).toBe(t0 + OPTIMISTIC_EXPIRY_MS);
  });
});
