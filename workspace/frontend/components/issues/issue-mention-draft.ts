import type { IssueMention } from './issue-mentions';

export interface MentionDraft {
  text: string;
  spans: { start: number; end: number; token: string }[];
}

/** Render stable mention identities as names without changing the saved text. */
export function mentionDraft(value: string, mentions: IssueMention[]): MentionDraft {
  const byToken = new Map(mentions.map((m) => [m.token, m]));
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length);
  if (!tokens.length) return { text: value, spans: [] };
  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(^|[^\\w@])@(${escaped.join('|')})(?![\\w@-]|\\.[\\w-])`, 'g');
  const spans: MentionDraft['spans'] = [];
  let text = '', last = 0;
  for (const match of value.matchAll(pattern)) {
    const start = match.index! + match[1].length;
    text += value.slice(last, start);
    const label = `@${byToken.get(match[2])!.name}`;
    spans.push({ start: text.length, end: text.length + label.length, token: match[2] });
    text += label;
    last = start + match[2].length + 1;
  }
  return { text: text + value.slice(last), spans };
}

export function replaceMentionDraft(draft: MentionDraft, start: number, end: number, inserted: string, mention?: IssueMention) {
  const text = draft.text.slice(0, start) + inserted + draft.text.slice(end);
  const delta = inserted.length - (end - start);
  const spans = draft.spans.filter((s) => s.end <= start || s.start >= end).map((s) => s.start >= end ? { ...s, start: s.start + delta, end: s.end + delta } : s);
  if (mention) spans.push({ start, end: start + inserted.trimEnd().length, token: mention.token });
  spans.sort((a, b) => a.start - b.start);
  let value = '', last = 0;
  for (const span of spans) {
    value += text.slice(last, span.start) + `@${span.token}`;
    last = span.end;
  }
  return value + text.slice(last);
}

/** Preserve identities only for complete, unchanged mention spans. */
export function editMentionDraft(draft: MentionDraft, text: string) {
  let start = 0;
  while (start < draft.text.length && start < text.length && draft.text[start] === text[start]) start++;
  let beforeEnd = draft.text.length, afterEnd = text.length;
  while (beforeEnd > start && afterEnd > start && draft.text[beforeEnd - 1] === text[afterEnd - 1]) { beforeEnd--; afterEnd--; }
  return replaceMentionDraft(draft, start, beforeEnd, text.slice(start, afterEnd));
}
