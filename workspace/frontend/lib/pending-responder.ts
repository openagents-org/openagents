import type { WorkspaceAgent } from './types';

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
