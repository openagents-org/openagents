import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '@/lib/types';
import { arrangeQueuedMessages, deriveQueuedMessages } from './use-queued-messages';

const human = (id: string, content: string, messageType = 'chat'): WorkspaceMessage => ({
  messageId: id, senderId: 'me', senderAddress: 'human:me@example.com', sessionId: 't', senderType: 'human', senderName: 'me',
  content, mentions: [], targetAgents: null, messageType, metadata: {}, createdAt: '',
});
const agent = (id: string, content: string): WorkspaceMessage => ({ ...human(id, content), senderId: null, senderAddress: 'openagents:a', senderType: 'agent', senderName: 'a' });
const status = (id: string, metadata: Record<string, unknown>): WorkspaceMessage => ({
  messageId: id, senderId: null, senderAddress: 'openagents:a', sessionId: 't', senderType: 'agent', senderName: 'a',
  content: 'message queued', mentions: [], targetAgents: null, messageType: 'status', metadata, createdAt: '',
});

describe('deriveQueuedMessages', () => {
  it('lists unprocessed queued messages oldest first', () => {
    const messages = [
      status('1', { queue_id: 'q1', queued_message: 'first' }),
      status('2', { queue_id: 'q2', queued_message: 'second' }),
      status('3', { queue_id: 'q3', queued_message: 'third' }),
      status('4', { queue_id: 'q2', queue_status: 'processed' }),
    ];
    expect(deriveQueuedMessages(messages)).toEqual([
      { queueId: 'q1', content: 'first' },
      { queueId: 'q3', content: 'third' },
    ]);
  });

  it('drops messages the user cancelled', () => {
    const messages = [status('1', { queue_id: 'q1', queued_message: 'first' })];
    expect(deriveQueuedMessages(messages, new Set(['q1']))).toEqual([]);
  });
});

describe('cancelled queue entries', () => {
  it('treats a posted queue_cancel as cancelled', () => {
    const messages = [status('1', { queue_id: 'q1', queued_message: 'first' }), human('2', '__queue_cancel:q1', 'queue_cancel')];
    expect(deriveQueuedMessages(messages)).toEqual([]);
  });
});

describe('arrangeQueuedMessages', () => {
  const ids = (messages: WorkspaceMessage[]) => messages.map((m) => m.messageId);

  it('hides a queued message and its queue status while it waits', () => {
    const messages = [
      human('u1', 'Build the page'), agent('a1', 'working on it'),
      human('u2', 'Also add pricing'), status('s1', { queue_id: 'q1', queued_message: 'Also add pricing' }),
    ];
    expect(ids(arrangeQueuedMessages(messages))).toEqual(['u1', 'a1']);
  });

  it('shows the message where the agent starts processing it', () => {
    const messages = [
      human('u1', 'Build the page'), human('u2', 'Also add pricing'),
      status('s1', { queue_id: 'q1', queued_message: 'Also add pricing' }),
      agent('a1', 'Page is done'), status('s2', { queue_id: 'q1', queue_status: 'processed' }), agent('a2', 'Adding pricing'),
    ];
    expect(ids(arrangeQueuedMessages(messages))).toEqual(['u1', 'a1', 'u2', 'a2']);
  });

  it('drops cancelled messages and the cancel signal', () => {
    const messages = [
      human('u1', 'Also add pricing'), status('s1', { queue_id: 'q1', queued_message: 'Also add pricing' }),
      human('c1', '__queue_cancel:q1', 'queue_cancel'), agent('a1', 'done'),
    ];
    expect(ids(arrangeQueuedMessages(messages))).toEqual(['a1']);
  });

  it('matches long messages on the reported prefix and leaves other messages alone', () => {
    const long = 'x'.repeat(300);
    const messages = [human('u0', 'unrelated'), human('u1', long), status('s1', { queue_id: 'q1', queued_message: long.slice(0, 200) })];
    expect(ids(arrangeQueuedMessages(messages))).toEqual(['u0']);
  });

  it('returns the same array when nothing is queued', () => {
    const messages = [human('u1', 'hi'), agent('a1', 'hello')];
    expect(arrangeQueuedMessages(messages)).toBe(messages);
  });
});
