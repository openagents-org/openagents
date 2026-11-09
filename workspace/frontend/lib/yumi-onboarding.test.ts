import { expect, it } from 'vitest';
import { isYumiWelcome } from './yumi-onboarding';

const agent = { agentName: 'yumi', builtin: true };
const message = { senderName: 'yumi', senderType: 'agent', messageType: 'chat', metadata: { onboarding: 'agent_location' } };
it('recognizes newly seeded and legacy welcome messages', () => {
  expect(isYumiWelcome(message, agent)).toBe(true);
  expect(isYumiWelcome({ ...message, metadata: { suggestions: ['Give me a quick tour of this workspace', 'What can agents do for me?', 'How do I connect a coding agent?'] } }, agent)).toBe(true);
});
it('leaves user messages, other agents, and ordinary replies alone', () => {
  expect(isYumiWelcome({ ...message, senderType: 'human' }, agent)).toBe(false);
  expect(isYumiWelcome(message, { ...agent, builtin: false })).toBe(false);
  expect(isYumiWelcome({ ...message, senderName: 'other' }, { agentName: 'other', builtin: true })).toBe(false);
  expect(isYumiWelcome({ ...message, messageType: 'status' }, agent)).toBe(false);
  expect(isYumiWelcome({ ...message, metadata: { suggestions: ['Another question'] } }, agent)).toBe(false);
});
