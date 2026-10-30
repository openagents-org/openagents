import { expect, it } from 'vitest';
import { applyMessageRecalls } from './message-recall';
import { eventToMessage, type WorkspaceMessage } from './types';
const message = (id: string, metadata = {}): WorkspaceMessage => ({ messageId: id, content: 'original text', metadata } as WorkspaceMessage);
it('removes recalled text, attachments and quote snapshots from already-loaded history', () => {
  const original = message('original', { attachments: [{ fileId: 'private-file' }] });
  const quote = message('reply', { reply_to: { message_id: 'original', content: 'original text' } });
  const notice = message('control', { recalled_message_id: 'original' });
  const result = applyMessageRecalls([original, quote, notice]);
  expect(result).toHaveLength(2);
  expect(result[0].content).toBe('');
  expect(result[0].metadata.attachments).toEqual([]);
  expect(result[1].metadata.reply_to).toEqual({ message_id: 'original', content: '', recalled: true });
  expect(original.content).toBe('original text');
});
it('marks resolved routing choices so stale originals no longer offer assignment or recall', () => {
  const result = applyMessageRecalls([message('original', { routing_choice: { status: 'pending' } }), message('dispatch', { routing_assignment: { message_id: 'original' } })]);
  expect(result[0].metadata.routing_choice).toEqual({ status: 'assigned' });
});
it('does not treat an ordinary user payload as a recall control event', () => {
  const value = eventToMessage({ id: 'x', type: 'workspace.message.posted', source: 'human:ann', target: 'channel/general', timestamp: 1, payload: { recalled_message_id: 'original' }, metadata: { recalled_message_id: 'original' } } as any);
  expect(value.metadata.recalled_message_id).toBeUndefined();
});
