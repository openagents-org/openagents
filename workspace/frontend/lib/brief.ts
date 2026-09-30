/**
 * Pure helpers for the v1.1 M5 thread brief and inline HTML artifacts.
 * Kept free of React/DOM so they can be unit-tested (see brief.test.ts).
 */
import type { ChannelBrief, ChannelBriefPatch } from './types';

/** True when nothing has been written into the brief yet. */
export function briefIsEmpty(brief: ChannelBrief | null | undefined): boolean {
  if (!brief) return true;
  return (
    !brief.objective &&
    !brief.owner &&
    !brief.latestResult &&
    !brief.nextStep &&
    (brief.openQuestions?.length ?? 0) === 0
  );
}

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

/** Body for PUT — only the keys present in `patch`, in the API's snake_case. */
export function briefPatchToApi(patch: ChannelBriefPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ('objective' in patch) body.objective = patch.objective ?? null;
  if ('owner' in patch) body.owner = patch.owner ?? null;
  if ('latestResult' in patch) body.latest_result = patch.latestResult ?? null;
  if ('nextStep' in patch) body.next_step = patch.nextStep ?? null;
  if ('openQuestions' in patch) body.open_questions = patch.openQuestions ?? [];
  return body;
}

/** One question per line in the editor → clean list. */
export function parseOpenQuestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter((l) => l.length > 0);
}

/** The fields that differ between what the editor holds and what the server has. */
export function diffBrief(
  current: ChannelBrief | null | undefined,
  draft: { objective: string; owner: string; latestResult: string; nextStep: string; openQuestions: string },
): ChannelBriefPatch {
  const patch: ChannelBriefPatch = {};
  const same = (a: string | null | undefined, b: string) => (a ?? '').trim() === b.trim();
  if (!same(current?.objective, draft.objective)) patch.objective = draft.objective.trim() || null;
  if (!same(current?.owner, draft.owner)) patch.owner = draft.owner.trim() || null;
  if (!same(current?.latestResult, draft.latestResult)) patch.latestResult = draft.latestResult.trim() || null;
  if (!same(current?.nextStep, draft.nextStep)) patch.nextStep = draft.nextStep.trim() || null;
  const qs = parseOpenQuestions(draft.openQuestions);
  const cur = current?.openQuestions ?? [];
  if (qs.length !== cur.length || qs.some((q, i) => q !== cur[i])) patch.openQuestions = qs;
  return patch;
}

/** "human:<email>" / "openagents:<agent>" → something a person reads. */
export function ownerLabel(owner: string | null | undefined, agentLabels: Record<string, string> = {}): string {
  if (!owner) return '';
  if (owner.startsWith('openagents:')) {
    const name = owner.slice('openagents:'.length);
    return agentLabels[name] || name;
  }
  if (owner.startsWith('human:')) return owner.slice('human:'.length);
  return owner;
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
