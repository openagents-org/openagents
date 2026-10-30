import type { MentionPerson } from '@/lib/people-mentions';

/** The draft keeps stable email tokens; only the textarea displays names. */
export function humanMentionDisplay(draft: string, people: readonly MentionPerson[]) {
  const names = new Map(people.map((p) => [p.email.toLowerCase(), p.name]));
  const mentions: { start: number; end: number; token: string }[] = [];
  let shift = 0;
  const text = draft.replace(/(?<![\w.+-])@([^\s@]+@[^\s@]+\.[^\s@]+)/g, (match, address: string, offset: number) => {
    const email = address.replace(/[.,;:!?)\]}'"]+$/, '');
    const name = names.get(email.toLowerCase());
    if (!name) return match;
    const token = `@${email}`;
    const label = `@${name}`;
    const start = offset + shift;
    mentions.push({ start, end: start + label.length, token });
    shift += label.length - token.length;
    return label + match.slice(token.length);
  });
  return { text, mentions };
}

/** Preserve identities outside the edit; editing inside a name makes it plain text. */
export function editHumanMentionDraft(
  draft: string,
  people: readonly MentionPerson[],
  start: number,
  end: number,
  replacement: string,
) {
  const { text, mentions } = humanMentionDisplay(draft, people);
  const edited = text.slice(0, start) + replacement + text.slice(end);
  const shift = replacement.length - (end - start);
  let result = '';
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.end > start && mention.start < end) continue;
    const moved = mention.start >= end ? shift : 0;
    const from = mention.start + moved;
    const to = mention.end + moved;
    result += edited.slice(cursor, from) + mention.token;
    cursor = to;
  }
  return result + edited.slice(cursor);
}

/** Translate a native textarea edit (including paste, delete and undo) back to a draft. */
export function updateHumanMentionDraft(draft: string, value: string, people: readonly MentionPerson[], cursor = value.length) {
  const { text } = humanMentionDisplay(draft, people);
  let start = 0;
  // The caret disambiguates edits to identical labels (e.g. deleting the first
  // of two people with the same name must not delete the second recipient).
  while (start < text.length && start < value.length && start < cursor && text[start] === value[start]) start++;
  let end = text.length;
  let nextEnd = value.length;
  while (end > start && nextEnd > start && text[end - 1] === value[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  return editHumanMentionDraft(draft, people, start, end, value.slice(start, nextEnd));
}
