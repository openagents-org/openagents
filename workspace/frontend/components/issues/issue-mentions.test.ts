import { describe, it, expect } from 'vitest';
import {
  issueMention,
  issueMentionOptions,
  mentionQuery,
  insertIssueMention,
} from './issue-mentions';

describe('issue mentions', () => {
  it('keeps duplicate display names and human/agent identities distinct', () => {
    const options = issueMentionOptions({
      currentUser: { id: 'alice@example.com', name: 'Alice' },
      team: ['alice@example.com', 'another@example.com'].map((email) => ({
        email,
        displayName: 'Alice',
        avatarUrl: null,
        role: 'member',
        joinedAt: null,
      })),
      agents: [
        { agentName: 'alice', displayName: 'Alice', status: 'offline' },
      ] as never[],
    });
    expect(options.map((m) => m.token)).toEqual([
      'alice@example.com',
      'another@example.com',
      'alice',
    ]);
    expect(new Set(options.map((m) => m.source)).size).toBe(3);
  });
  it('detects the caret mention without matching an email or an earlier mention', () => {
    expect(mentionQuery('Ask (@Ali', 9)).toEqual({
      start: 5,
      end: 9,
      query: 'Ali',
    });
    expect(mentionQuery('Hi @小明', 6)?.query).toBe('小明');
    expect(mentionQuery('alice@example.com', 17)).toBeNull();
    expect(mentionQuery('@Alice has context', 18)).toBeNull();
  });
  it('replaces only the active query and preserves the text after the caret', () => {
    const value = 'Ask @Ali about this';
    expect(
      insertIssueMention(
        value,
        mentionQuery(value, 8)!,
        issueMention('human:alice@example.com', 'Alice'),
      ),
    ).toEqual({ value: 'Ask @alice@example.com  about this', cursor: 23 });
  });
});
