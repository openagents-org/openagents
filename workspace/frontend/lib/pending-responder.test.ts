import { describe, it, expect } from 'vitest';
import { pendingResponderName } from './pending-responder';

const agents = [
  { agentName: 'cherie-bot' }, // workspace master, not in the thread
  { agentName: 'sin1-bot' },
  { agentName: 'opencode0924test' },
];

describe('pendingResponderName', () => {
  it('never picks an agent outside the thread', () => {
    expect(pendingResponderName({
      agents,
      participants: ['sin1-bot', 'opencode0924test'],
    })).toBe('sin1-bot');
  });

  it('prefers the thread master when it is a participant', () => {
    expect(pendingResponderName({
      agents,
      participants: ['sin1-bot', 'opencode0924test'],
      master: 'opencode0924test',
    })).toBe('opencode0924test');
  });

  it('ignores a master that is not a participant', () => {
    expect(pendingResponderName({
      agents,
      participants: ['sin1-bot'],
      master: 'cherie-bot',
    })).toBe('sin1-bot');
  });

  it('prefers an @mentioned agent, then the DM counterpart', () => {
    expect(pendingResponderName({
      agents,
      participants: ['sin1-bot', 'opencode0924test'],
      mentions: ['opencode0924test'],
    })).toBe('opencode0924test');
    expect(pendingResponderName({
      agents,
      participants: [],
      dmCounterpart: 'sin1-bot',
    })).toBe('sin1-bot');
  });

  it('falls back to a generic label when the thread has no known agent', () => {
    expect(pendingResponderName({ agents, participants: [] })).toBe('Agent');
  });
});
