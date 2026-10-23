// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { requestMessageTarget, takeMessageTarget } from './message-target';

it('hands the requested message only to its own thread, and only once', () => {
  requestMessageTarget('thread-a', 'message-1');
  expect(takeMessageTarget('thread-b')).toBeNull();
  expect(takeMessageTarget(null)).toBeNull();
  expect(takeMessageTarget('thread-a')).toBe('message-1');
  expect(takeMessageTarget('thread-a')).toBeNull();
});
