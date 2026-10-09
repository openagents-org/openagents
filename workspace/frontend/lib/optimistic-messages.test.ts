import { describe, it, expect } from 'vitest';
import { pendingOptimisticMessages } from './optimistic-messages';
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
function sent(content: string): WorkspaceMessage[] {
  return [
    msg('optimistic-user-1', { content }),
    msg('optimistic-loading-1', {
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
});
