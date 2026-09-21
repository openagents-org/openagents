import { expect, it } from 'vitest';
import { requestedDesktopThread } from './desktop-host';

it('selects the encoded notification thread only when it belongs to the loaded workspace', () => {
  const hash = '#/team?token=device-secret&thread=thread%2Fone';
  expect(requestedDesktopThread(hash, ['thread/one', 'other'])).toBe('thread/one');
  expect(requestedDesktopThread(hash, ['other'])).toBeNull();
  expect(requestedDesktopThread('#/team', ['thread/one'])).toBeNull();
});
