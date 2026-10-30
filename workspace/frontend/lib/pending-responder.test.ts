import { describe, it, expect } from 'vitest';
import { pendingResponderName, expectsAgentResponse } from './pending-responder';

describe('expectsAgentResponse', () => {
  const base = { content: 'hello', mentions: [], mentionedHumans: [] };
  it('does not show agent activity for a person-only mention, even without roster metadata', () => {
    expect(expectsAgentResponse({ ...base, content: '@sam@demo.acenta.ai hey' })).toBe(false);
    expect(expectsAgentResponse({ ...base, content: '@Sam Weber hey', mentionedHumans: ['sam@demo.acenta.ai'] })).toBe(false);
  });
  it('still expects replies when an agent is explicitly mentioned alongside a person', () => {
    expect(expectsAgentResponse({ ...base, content: '@sam@demo.acenta.ai @claude-dev hey', mentions: ['claude-dev'], mentionedHumans: ['sam@demo.acenta.ai'] })).toBe(true);
  });
  it('preserves default routing and distinguishes human DMs from agent DMs', () => {
    expect(expectsAgentResponse(base)).toBe(true);
    expect(expectsAgentResponse({ ...base, content: 'email sam@demo.acenta.ai' })).toBe(true);
    expect(expectsAgentResponse({ ...base, mentions: ['claude-dev'], dmCounterpart: 'human:sam@demo.acenta.ai' })).toBe(false);
    expect(expectsAgentResponse({ ...base, content: '@sam@demo.acenta.ai', dmCounterpart: 'openagents:claude-dev' })).toBe(true);
  });
});

const agents = [
  { agentName: 'cherie-bot' }, // workspace master, not in the thread
  { agentName: 'sin1-bot' },
  { agentName: 'opencode0924test' },
];

describe('pendingResponderName', () => {
  it('names the only agent in the thread', () => {
    expect(pendingResponderName({
      agents,
      participants: ['sin1-bot'],
    })).toBe('sin1-bot');
  });

  it('does not guess between several agents when nothing singles one out', () => {
    expect(pendingResponderName({
      agents,
      participants: ['sin1-bot', 'opencode0924test'],
    })).toBe('');
  });

  it('never picks an agent outside the thread', () => {
    expect(pendingResponderName({
      agents,
      participants: ['sin1-bot', 'opencode0924test'],
    })).not.toBe('cherie-bot');
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

  it('stays unattributed when the thread has no known agent', () => {
    expect(pendingResponderName({ agents, participants: [] })).toBe('');
  });
});

it('only predicts leading mentions while thread response routing is pending', () => {
  for (const responseMode of ['proactive', 'passive'] as const) {
    const options = { responseMode, mentions: ['claude-dev'], mentionedHumans: [] };
    expect(expectsAgentResponse({ ...options, content: '@claude-dev help' })).toBe(true);
    expect(expectsAgentResponse({ ...options, content: 'look at @claude-dev' })).toBe(false);
    expect(expectsAgentResponse({ ...options, content: '@claude-dev@example.com hi' })).toBe(false);
    expect(expectsAgentResponse({ ...options, content: 'Sam, are you there?' })).toBe(false);
    expect(expectsAgentResponse({ ...options, content: 'hi', dmCounterpart: 'claude-dev' })).toBe(true);
  }
});

it('does not show an agent reply placeholder for @all', () => {
  expect(expectsAgentResponse({ content: '@All hello', mentions: [], mentionedHumans: [] })).toBe(false);
});

import { needsProactiveRouting } from './pending-responder';
it('shows routing for ambiguous proactive threads, including one agent with several people', () => {
  const opts = { content: 'did you open the page', mentions: [], mentionedHumans: [], participants: ['writer', 'reviewer'], responseMode: 'proactive' as const };
  expect(needsProactiveRouting(opts)).toBe(true);
  expect(needsProactiveRouting({ ...opts, participants: ['writer'], humanCount: 2 })).toBe(true);
  expect(needsProactiveRouting({ ...opts, participants: ['writer'], humanCount: 1 })).toBe(false);
  expect(needsProactiveRouting({ ...opts, participants: [] })).toBe(false);
  expect(needsProactiveRouting({ ...opts, direct: true })).toBe(false);
  expect(needsProactiveRouting({ ...opts, responseMode: 'passive' })).toBe(false);
  expect(needsProactiveRouting({ ...opts, mentions: ['writer'] })).toBe(false);
  expect(needsProactiveRouting({ ...opts, mentionedHumans: ['ann@test.com'] })).toBe(false);
  expect(needsProactiveRouting({ ...opts, content: '@all hello' })).toBe(false);
});
