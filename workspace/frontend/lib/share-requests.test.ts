import { describe, expect, it } from 'vitest';
import { isReleasedCopy, isShareNotice, requestDecisions, requestStatus, shareRequestOf } from './share-requests';

const held = { messageId: 'e1', metadata: { share_request: { id: 'r1', status: 'pending' } } };
const notice = (id: string, status: string) => ({ messageId: `n-${id}`, messageType: 'notice', senderAddress: 'system:share', metadata: { share_request_update: { id, messageId: 'e1', status } } });

describe('share requests', () => {
  it('reads a held request and its copy', () => {
    expect(shareRequestOf(held)).toEqual({ id: 'r1', status: 'pending' });
    expect(shareRequestOf({ metadata: { share_request: { status: 'pending' } } })).toBeNull();
    expect(isReleasedCopy({ metadata: { share_released_from: 'e1' } })).toBe(true);
    expect(isReleasedCopy(held)).toBe(false);
    expect(isShareNotice(notice('r1', 'approved'))).toBe(true);
    expect(isShareNotice({ messageType: 'chat', senderAddress: 'human:a@b.c' })).toBe(false);
  });

  it('takes decisions from notices, or a released copy', () => {
    expect(requestDecisions([held, notice('r1', 'declined')])).toEqual({ r1: 'declined' });
    expect(requestDecisions([{ messageId: 'e2', metadata: { share_released_from: 'e1', share_request: { id: 'r2', status: 'approved' } } }])).toEqual({ r2: 'approved' });
  });

  it('lets a decision win over the message snapshot', () => {
    const req = { id: 'r1', status: 'pending' as const };
    expect(requestStatus(req)).toBe('pending');
    expect(requestStatus(req, undefined, { r1: 'approved' })).toBe('approved');
    expect(requestStatus(req, { r1: 'declined' }, { r1: 'approved' })).toBe('declined');
  });
});
