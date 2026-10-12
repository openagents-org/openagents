import { describe, expect, it } from 'vitest';
import { displayHumanMentions, extractMentionedAgents, extractMentionedHumans, filterMentionPeople } from './people-mentions';
import type { TeamMember } from './types';

const member = (email: string, displayName: string | null): TeamMember => ({
  email, displayName, avatarUrl: null, role: 'member' as TeamMember['role'], joinedAt: null,
});

describe('extractMentionedHumans', () => {
  const roster = ['sam@demo.io', 'Ana@demo.io', 'me@demo.io'];
  it('collects roster emails, deduped and lowercased', () => {
    expect(extractMentionedHumans('hey @sam@demo.io and @ana@demo.io, also @sam@demo.io.', roster))
      .toEqual(['sam@demo.io', 'ana@demo.io']);
  });
  it('ignores non-roster addresses, plain emails and yourself', () => {
    expect(extractMentionedHumans('mail x@demo.io or @who@else.io or @me@demo.io', roster, 'me@demo.io'))
      .toEqual([]);
  });
});

describe('extractMentionedAgents', () => {
  it('keeps whole-word agent tokens only', () => {
    const names = ['scout', 'sam', 'demo'];
    expect(extractMentionedAgents('@scout look; ping @sam@demo.io (not sam@demo.io)', names)).toEqual(['scout']);
    expect(extractMentionedAgents('thanks @scout.', names)).toEqual(['scout']);
  });
});

describe('filterMentionPeople', () => {
  const team = [member('sam@demo.io', 'Sam Okafor'), member('me@demo.io', 'Me'), member('lee@demo.io', null)];
  it('excludes yourself and matches name or email', () => {
    expect(filterMentionPeople(team, '', 'ME@demo.io').map((p) => p.email)).toEqual(['lee@demo.io', 'sam@demo.io']);
    expect(filterMentionPeople(team, 'oka', 'me@demo.io').map((p) => p.name)).toEqual(['Sam Okafor']);
    expect(filterMentionPeople(team, 'lee@', 'me@demo.io').map((p) => p.name)).toEqual(['lee@demo.io']);
  });
});

describe('displayHumanMentions in conversation previews', () => {
  const names = { 'lx9803@gmail.com': '李翔', 'sam@demo.io': 'Sam Okafor' };
  it('renders the same name as the message, including multiple mentions and punctuation', () => {
    expect(displayHumanMentions('@lx9803@gmail.com hi', names)).toBe('@李翔 hi');
    expect(displayHumanMentions('Hi @LX9803@gmail.com, ask (@sam@demo.io)!', names))
      .toBe('Hi @李翔, ask (@Sam Okafor)!');
  });
  it('preserves agents, ordinary email addresses and unknown or unnamed people', () => {
    const text = '@claude-dev mail lx9803@gmail.com or @unknown@example.com';
    expect(displayHumanMentions(text, names)).toBe(text);
    expect(displayHumanMentions('@sam@demo.io', { 'sam@demo.io': '  ' })).toBe('@sam@demo.io');
    expect(displayHumanMentions('@sam@demo.io.evil', names)).toBe('@sam@demo.io.evil');
  });
});

it('recognizes @all without treating email addresses or longer handles as everyone', async () => {
  const { hasAllMention } = await import('./people-mentions');
  for (const text of ['@All hi', 'Hello @all!', '@ALL.', '@all']) expect(hasAllMention(text)).toBe(true);
  for (const text of ['x@all.com', '@all@example.com', '@all-team', '@allison', '@all.com']) expect(hasAllMention(text)).toBe(false);
});
