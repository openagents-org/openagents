/**
 * Pure helpers for the v1.1 M5 thread brief and inline HTML artifacts.
 * Kept free of React/DOM so they can be unit-tested (see brief.test.ts).
 */
import type { ChannelBrief } from './types';


/** Turn the raw API row (snake_case) into the UI shape. Tolerates a missing row. */
export function briefFromApi(raw: Record<string, unknown> | null | undefined, channel: string): ChannelBrief {
  const r = raw || {};
  const qs = Array.isArray(r.open_questions) ? (r.open_questions as unknown[]) : [];
  return {
    channel: (r.channel as string) || channel,
    objective: (r.objective as string | null) ?? null,
    owner: (r.owner as string | null) ?? null,
    latestResult: (r.latest_result as string | null) ?? null,
    openQuestions: qs.filter((q): q is string => typeof q === 'string' && q.trim().length > 0),
    nextStep: (r.next_step as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
    updatedAt: (r.updated_at as string | null) ?? null,
    directorEmail: ((r.director_email as string | null) ?? null)?.toLowerCase() || null,
    canEdit: r.can_edit === true,
  };
}





// ── Inline HTML artifacts ──

export function isHtmlAttachment(contentType: string | null | undefined, filename: string | null | undefined): boolean {
  const ct = (contentType || '').toLowerCase().split(';')[0].trim();
  if (ct === 'text/html' || ct === 'application/xhtml+xml') return true;
  return /\.x?html?$/i.test(filename || '');
}

/**
 * Composer text for "Request revision" on an artifact. The agent is the
 * message's sender when it is an agent; a human-posted file gets no mention.
 */
export function buildRevisionPrompt(agentName: string | null | undefined, filename: string): string {
  const name = (agentName || '').trim();
  const file = (filename || '').trim() || 'the file';
  return name ? `@${name} Please revise ${file}: ` : `Please revise ${file}: `;
}
