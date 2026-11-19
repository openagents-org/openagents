import { expect, it } from 'vitest';
import { messageModel } from './message-model';

it('keeps a response model when the agent configuration has changed', () => {
  expect(messageModel({ metadata: { model: 'claude-sonnet-4-6' } }, { model: 'claude-opus-4-6' })).toBe('claude-sonnet-4-6');
});

it('uses an explicit configured model when older messages have no model', () => {
  expect(messageModel({ metadata: {} }, { model: ' custom-provider/my-model ' })).toBe('custom-provider/my-model');
});

it('hides unknown and default models rather than guessing a provider default', () => {
  for (const model of [null, '', ' ', 'auto', 'Auto (agent default)', 'default', 'unknown']) {
    expect(messageModel({ metadata: {} }, { model })).toBeNull();
  }
  expect(messageModel({ metadata: { model: { id: 'untrusted-object' } } })).toBeNull();
});
