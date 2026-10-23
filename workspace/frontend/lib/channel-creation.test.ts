import { afterEach, expect, it, vi } from 'vitest';
import { workspaceApi } from './api';
import type { ONMEvent } from './types';
afterEach(() => vi.restoreAllMocks());
it('sends creator identity separately from selected invitees and uses server ownership', async () => {
  const send = vi.spyOn(workspaceApi, 'sendEvent').mockResolvedValue({
    source: 'human:creator@example.com', timestamp: Date.now(),
    metadata: { channel_name: 'group-1', visibility: 'private', owner_email: 'creator@example.com' },
  } as unknown as ONMEvent);
  const thread = await workspaceApi.createChannel({
    creatorId: 'creator@example.com', participants: [],
    humanParticipants: ['teammate@example.com'], visibility: 'private',
  });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    source: 'human:creator@example.com',
    payload: expect.objectContaining({ sender_id: 'creator@example.com', human_participants: ['teammate@example.com'] }),
  }));
  expect(thread.createdBy).toBe('human:creator@example.com');
  expect(thread.ownerEmail).toBe('creator@example.com');
  expect(thread.visibility).toBe('private');
});
