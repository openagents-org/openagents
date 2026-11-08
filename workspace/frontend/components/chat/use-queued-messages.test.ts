import { describe, expect, it } from 'vitest';
import type { WorkspaceMessage } from '@/lib/types';
import { deriveQueuedMessages } from './use-queued-messages';

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
