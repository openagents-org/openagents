import { expect, it } from 'vitest';
import { mentionDraft, editMentionDraft, replaceMentionDraft } from './issue-mention-draft';
import { issueMention } from './issue-mentions';
const ann = issueMention('human:ann@example.com', 'Ann Smith');
const other = issueMention('human:other@example.com', 'Ann Smith');
it('displays names and preserves distinct identities while typing before and after mentions', () => {
  const value = '@ann@example.com and @other@example.com hello';
  const draft = mentionDraft(value, [ann, other]);
  expect(draft.text).toBe('@Ann Smith and @Ann Smith hello');
  expect(editMentionDraft(draft, draft.text + '!')).toBe(value + '!');
  expect(editMentionDraft(draft, 'Hi ' + draft.text)).toBe('Hi ' + value);
});
it('drops identity when a mention itself is edited or deleted', () => {
  const draft = mentionDraft('@ann@example.com hello', [ann]);
  expect(editMentionDraft(draft, '@Anne Smith hello')).toBe('@Anne Smith hello');
  expect(editMentionDraft(draft, 'hello')).toBe('hello');
});
it('inserts a selected person by name without losing earlier identities', () => {
  const draft = mentionDraft('@ann@example.com and @ot', [ann, other]);
  expect(replaceMentionDraft(draft, draft.text.indexOf('@ot'), draft.text.length, '@Ann Smith ', other))
    .toBe('@ann@example.com and @other@example.com ');
});

it('renders a mention followed by sentence punctuation', () => {
  expect(mentionDraft('Ask @ann@example.com.', [ann]).text).toBe('Ask @Ann Smith.');
});
