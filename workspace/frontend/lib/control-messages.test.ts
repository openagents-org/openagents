import { describe, expect, it } from 'vitest';
import { isControlMessage } from './control-messages';

describe('isControlMessage', () => {
  it('flags queue-cancel signals', () => {
    expect(isControlMessage({ messageType: 'queue_cancel' })).toBe(true);
  });
  it('leaves conversation and agent steps alone', () => {
    for (const messageType of ['chat', 'status', 'thinking', 'todos', 'loading', 'approval']) {
      expect(isControlMessage({ messageType })).toBe(false);
    }
    expect(isControlMessage(null)).toBe(false);
  });
});
