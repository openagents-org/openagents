import { describe, expect, it } from 'vitest';
import { newDesktopAgentReply } from './desktop-agent-reply';
import type { ONMEvent } from './types';

const event = (id: string, timestamp: number, source: string, message_type: string): ONMEvent => ({
  id, timestamp, source, type: 'workspace.message.posted', target: 'channel/thread',
  payload: { content: id, message_type }, metadata: {}, visibility: 'workspace',
});

describe('desktop agent reply selection', () => {
  it('ignores initial history, human messages, and intermediate agent output', () => {
    const events = [event('status', 110, 'openagents:agent', 'status'), event('human', 105, 'human:me', 'chat')];
    expect(newDesktopAgentReply(events, undefined)).toBeNull();
    expect(newDesktopAgentReply(events, 100)).toBeNull();
  });

  it('selects a new chat reply but not an older reply after status activity', () => {
    const events = [event('status', 120, 'openagents:agent', 'status'), event('reply', 110, 'openagents:agent', 'chat')];
    expect(newDesktopAgentReply(events, 100)?.id).toBe('reply');
    expect(newDesktopAgentReply(events, 115)).toBeNull();
  });
});
