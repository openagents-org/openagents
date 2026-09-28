import type { WorkspaceAgent } from './types';

/**
 * Who the optimistic "…" waiting bubble is attributed to after a send.
 *
 * Only agents in this thread can answer, so the pick is scoped to the
 * thread's participants: an @mentioned agent first, then the DM counterpart,
 * then the thread's master, then the first participant. The workspace-wide
 * master is never used — it may not be in the thread at all, and the bubble
 * would show an outsider "typing" until the real reply replaces it.
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
    inThread[0] ||
    'Agent'
  );
}
