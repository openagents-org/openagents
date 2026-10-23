import { describe, expect, it } from 'vitest';
import { extractMentionedAgents, extractMentionedHumans } from '@/lib/people-mentions';
import { editHumanMentionDraft, humanMentionDisplay, updateHumanMentionDraft } from './composer-human-mentions';

const people = [
  { email: 'sam@example.com', name: 'Sam Weber' },
  { email: 'other@example.com', name: 'Sam Weber' },
  { email: 'mei@example.com', name: '小梅' },
];

describe('human mentions in the composer', () => {
  it('shows names in restored drafts, preserving punctuation, agents and ordinary emails', () => {
    expect(humanMentionDisplay('Hi @sam@example.com, @mei@example.com! Ask @scout or mail sam@example.com.', people).text)
      .toBe('Hi @Sam Weber, @小梅! Ask @scout or mail sam@example.com.');
  });

  it('keeps distinct identities for people with the same name when editing around mentions', () => {
    const draft = '@sam@example.com and @other@example.com';
    const edited = updateHumanMentionDraft(draft, 'Hi @Sam Weber and @Sam Weber!', people);
    // A native edit changes one contiguous region at a time.
    const prefix = updateHumanMentionDraft(draft, 'Hi @Sam Weber and @Sam Weber', people);
    expect(prefix).toBe('Hi @sam@example.com and @other@example.com');
    expect(updateHumanMentionDraft(prefix, 'Hi @Sam Weber and @Sam Weber!', people))
      .toBe('Hi @sam@example.com and @other@example.com!');
    // Replacing the entire visible text must not guess recipients from names.
    expect(edited).toBe('Hi @Sam Weber and @Sam Weber!');
  });

  it('inserts another chosen person using visible cursor offsets', () => {
    const draft = '@sam@example.com ask @me please';
    const visible = humanMentionDisplay(draft, people).text;
    const start = visible.indexOf('@me');
    const next = editHumanMentionDraft(draft, people, start, start + 3, '@mei@example.com ');
    expect(next).toBe('@sam@example.com ask @mei@example.com  please');
    expect(humanMentionDisplay(next, people).text).toBe('@Sam Weber ask @小梅  please');
  });

  it('uses the caret to preserve the right recipient when deleting duplicate display names', () => {
    const draft = '@sam@example.com @other@example.com';
    expect(updateHumanMentionDraft(draft, '@Sam Weber', people, 0)).toBe('@other@example.com');
    expect(updateHumanMentionDraft(draft, '@Sam Weber', people, 10)).toBe('@sam@example.com');
  });

  it('drops an identity when its name is edited or deleted, preserving other mentions', () => {
    const draft = '@sam@example.com and @mei@example.com';
    expect(updateHumanMentionDraft(draft, '@Sam Wber and @小梅', people))
      .toBe('@Sam Wber and @mei@example.com');
    expect(updateHumanMentionDraft(draft, '@Sam XWeber and @小梅', people))
      .toBe('@Sam XWeber and @mei@example.com');
    expect(updateHumanMentionDraft(draft, ' and @小梅', people)).toBe(' and @mei@example.com');
  });

  it('preserves mentions when text is inserted directly before or after them', () => {
    const draft = '@sam@example.com';
    expect(editHumanMentionDraft(draft, people, 0, 0, 'Hi ')).toBe('Hi @sam@example.com');
    expect(editHumanMentionDraft(draft, people, 10, 10, '!')).toBe('@sam@example.com!');
    expect(updateHumanMentionDraft(draft, '@Sam Weber', people)).toBe(draft);
  });

  it('keeps the selected recipient and does not wake an agent with the same first name', () => {
    const draft = updateHumanMentionDraft('@sam@example.com', '@Sam Weber please check', people);
    expect(extractMentionedHumans(draft, people.map((p) => p.email))).toEqual(['sam@example.com']);
    expect(extractMentionedAgents(draft, ['Sam', 'sam'])).toEqual([]);
  });

  it('leaves unknown addresses visible and handles missing names through the email fallback', () => {
    expect(humanMentionDisplay('@unknown@example.com', people).text).toBe('@unknown@example.com');
    expect(humanMentionDisplay('@sam@example.com', [{ email: 'sam@example.com', name: 'sam@example.com' }]).text)
      .toBe('@sam@example.com');
  });
});
