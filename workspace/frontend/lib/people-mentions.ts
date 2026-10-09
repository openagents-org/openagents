/**
 * @mentions of people in thread messages.
 *
 * People are mentioned by email (`@sam@demo.io`) — the same stable token the
 * issue board uses — so the backend can address the notification without a
 * name lookup. Agents keep their `@agent-name` tokens.
 */
import type { TeamMember } from './types';

export interface MentionPerson {
  email: string;
  name: string;
}

const EMAIL_MENTION = /(?<![\w.+-])@([^\s@]+@[^\s@]+\.[^\s@]+)/g;

/** Emails of roster people @mentioned in `text` (deduped, lowercased, roster-only, never yourself). */
export function extractMentionedHumans(
  text: string,
  rosterEmails: Iterable<string>,
  selfEmail?: string | null,
): string[] {
  const roster = new Set(Array.from(rosterEmails, (e) => e.toLowerCase()));
  const self = (selfEmail || '').toLowerCase();
  const out: string[] = [];
  for (const m of Array.from(text.matchAll(EMAIL_MENTION))) {
    // Sentence punctuation right after the address isn't part of it.
    const email = m[1].replace(/[.,;:!?)\]}'"]+$/, '').toLowerCase();
    if (!roster.has(email) || email === self || out.includes(email)) continue;
    out.push(email);
  }
  return out;
}

/**
 * Agent names @mentioned in `text`. An agent token is a whole word — the
 * `@demo` inside `sam@demo.io` or the `@sam` of `@sam@demo.io` never count.
 */
export function extractMentionedAgents(text: string, agentNames: readonly string[]): string[] {
  const names = new Set(agentNames);
  const out: string[] = [];
  for (const m of Array.from(text.matchAll(/(?<![\w.+-])@([\w-]+)(?![\w-]*@)(?!\.\w)/g))) {
    if (names.has(m[1]) && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Roster people offered in the @ picker: everyone but yourself, filtered by name or email. */
export function filterMentionPeople(
  team: readonly TeamMember[],
  query: string,
  selfEmail?: string | null,
): MentionPerson[] {
  const q = query.trim().toLowerCase();
  const self = (selfEmail || '').toLowerCase();
  return team
    .filter((m) => m.email && m.email.toLowerCase() !== self)
    .map((m) => ({ email: m.email.toLowerCase(), name: (m.displayName || '').trim() || m.email }))
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.email.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
}
