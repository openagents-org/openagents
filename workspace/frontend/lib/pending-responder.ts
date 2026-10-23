import { hasAllMention } from './people-mentions';
import type { WorkspaceAgent } from './types';

/** Match people-only routing before showing an optimistic agent response. */
export function expectsAgentResponse(opts: {
  content: string;
  mentions: readonly string[];
  mentionedHumans: readonly string[];
  dmCounterpart?: string | null;
  responseMode?: 'proactive' | 'passive';
}): boolean {
  if (opts.dmCounterpart) return !opts.dmCounterpart.startsWith('human:');
  if (opts.responseMode) {
    // Proactive decisions are not known until the router answers. Only show
    // an immediate pending bubble for a deterministic leading agent mention.
    const lead = opts.content.match(/^\s*@([\w-]+)(?![\w@.+-])/)?.[1];
    return !!lead && opts.mentions.includes(lead);
  }
  if (opts.mentions.length > 0) return true;
  return !hasAllMention(opts.content) && opts.mentionedHumans.length === 0 &&
    !/(?<![\w.@-])@[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(opts.content);
}

/**
 * Who the optimistic "…" waiting bubble is attributed to after a send.
 *
 * Only agents in this thread can answer, so the pick is scoped to the
 * thread's participants: an @mentioned agent first, then the DM counterpart,
 * then the thread's master, then the thread's only agent. When several agents
 * could answer and nothing singles one out, return '' — the bubble then shows
 * no name or avatar until the real responder's first step arrives. Guessing
 * (e.g. the first participant) put the wrong agent's name on screen. The
 * workspace-wide master is never used — it may not be in the thread at all.
 */
export function pendingResponderName(opts: {
  agents: Pick<WorkspaceAgent, 'agentName'>[];
  participants: string[];
  master?: string | null;
  mentions?: string[];
  dmCounterpart?: string | null;
}): string {
  const { agents, participants, master, mentions = [], dmCounterpart } = opts;
  const known = new Set(agents.map((a) => a.agentName));
  const inThread = participants.filter((p) => known.has(p));
  return (
    mentions.find((m) => known.has(m)) ||
    dmCounterpart ||
    (master && inThread.includes(master) ? master : undefined) ||
    (inThread.length === 1 ? inThread[0] : undefined) ||
    ''
  );
}
