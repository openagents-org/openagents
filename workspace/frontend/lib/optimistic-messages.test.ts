import { expect, it } from 'vitest';
import { acknowledgeMessage, pendingMessagesForDisplay } from './optimistic-messages';
import { eventToMessage, type ONMEvent, type WorkspaceMessage } from './types';

const event = {
  id: 'saved', source: 'human:ann@example.com', target: 'channel/general', timestamp: Date.now(),
  type: 'workspace.message.posted', visibility: 'channel', payload: { content: 'people/ann/20261014_image.png', attachments: [{ filename: 'people/ann/20261014_image.png', fileId: 'image' }] },
  metadata: { target_agents: ['__no_response__'] },
} as ONMEvent;
const user = { ...eventToMessage(event), messageId: 'optimistic-user-1', content: 'image.png', metadata: {} };
const loading = { ...user, messageId: 'optimistic-loading-1', messageType: 'loading', senderType: 'agent' } as WorkspaceMessage;

it('replaces an upload placeholder with the canonical image and removes it when polling arrives', () => {
  const pending = acknowledgeMessage([user, loading], user.messageId, loading.messageId, event);
  expect(pending).toHaveLength(1);
  expect(pending[0]).toEqual(eventToMessage(event));
  expect(pendingMessagesForDisplay([], pending)).toEqual(pending);
  expect(pendingMessagesForDisplay([eventToMessage(event)], pending)).toEqual([]);
});

it('does not match repeated text to an old message or clear loading for an old reply', () => {
  const sent = { ...event, payload: { content: 'hi' }, metadata: { target_agents: ['agent'] } } as ONMEvent;
  const old = { ...eventToMessage(sent), messageId: 'old' };
  const oldReply = { ...old, messageId: 'old-reply', senderType: 'agent' } as WorkspaceMessage;
  const pending = acknowledgeMessage([user, loading], user.messageId, loading.messageId, sent);
  expect(pendingMessagesForDisplay([old, oldReply], pending)).toHaveLength(2);
  expect(pendingMessagesForDisplay([old, oldReply, eventToMessage(sent)], pending)).toHaveLength(1);
  expect(pendingMessagesForDisplay([old, oldReply, eventToMessage(sent), { ...oldReply, messageId: 'new-reply' }], pending)).toEqual([]);
});

it('keeps captions, multiple attachments, and the local DM session identity', () => {
  const sent = { ...event, target: 'human:sam', payload: { content: 'Review these', attachments: [{ filename: 'stored/a.png' }, { filename: 'stored/b.png' }] } } as ONMEvent;
  const pending = acknowledgeMessage([{ ...user, sessionId: 'dm:human:ann,human:sam' }], user.messageId, loading.messageId, sent);
  expect(pending[0].content).toBe('Review these');
  expect(pending[0].metadata.attachments).toHaveLength(2);
  expect(pending[0].sessionId).toBe('dm:human:ann,human:sam');
});


it('shows a proactive waiting bubble only after the server selects an agent', () => {
  const sent = { ...event, metadata: { target_agents: ['worker'] } } as ONMEvent;
  const pending = acknowledgeMessage([user], user.messageId, loading.messageId, sent, loading);
  expect(pending.map(m => m.messageType)).toEqual(['chat', 'loading']);
  expect(pending[1].senderName).toBe('worker');
  expect(pending[1].metadata._requestId).toBe(sent.id);
  expect(acknowledgeMessage([user], user.messageId, loading.messageId, event, loading)).toHaveLength(1);
});
