import type { NodeAgent, NodeCommand } from '@/lib/types';
import type { PendingAgent } from './node-card';

/** A failed add stays on the device's card this long, unless removed. */
const FAILED_KEEP_MS = 24 * 60 * 60 * 1000;
/** A finished install that has not joined yet is still worth showing this long. */
const DONE_KEEP_MS = 10 * 60 * 1000;
/** A device that took an add this long ago and never answered has dropped it
 * (the connector restarted mid-install, or the device went away). */
const RUNNING_KEEP_MS = 60 * 60 * 1000;

/**
 * Placeholders a fresh page owes the user, from the device's command history:
 * adds still waiting or installing, ones that finished but have not joined
 * yet, and recent failures. Only the newest add of each name counts, and not
 * when the agent was removed after it; an agent the roster already reports
 * needs none, and a card the user removed stays removed.
 */
export function recoverPending(
  commands: NodeCommand[],
  roster: NodeAgent[],
  dismissed: ReadonlySet<string>,
  now = Date.now(),
): PendingAgent[] {
  const seen = new Set<string>();
  const out: PendingAgent[] = [];
  const newestFirst = [...commands].sort((a, b) => time(b.createdAt) - time(a.createdAt));
  for (const cmd of newestFirst) {
    const name = cmd.agentName;
    if (!name || seen.has(name) || (cmd.action !== 'create_agent' && cmd.action !== 'remove_agent')) continue;
    seen.add(name);
    if (cmd.action === 'remove_agent') continue;
    if (roster.some((a) => a.name === name) || dismissed.has(cmd.commandId)) continue;
    const finished = time(cmd.finishedAt);
    const age = now - time(cmd.createdAt);
    if (cmd.status === 'error' && age > FAILED_KEEP_MS) continue;
    if (cmd.status === 'running' && age > RUNNING_KEEP_MS) continue;
    if (cmd.status === 'done' && now - finished > DONE_KEEP_MS) continue;
    const type = cmd.agentType || cmd.draft?.type || '';
    out.push({
      name,
      type,
      commandId: cmd.commandId,
      cmdStatus: cmd.status,
      cmdMessage: cmd.result?.message ?? null,
      // The stall clock starts when install/config ended, as for a live add.
      at: cmd.status === 'done' && finished ? finished : time(cmd.createdAt) || now,
      draft: cmd.draft ? { ...cmd.draft, type: cmd.draft.type || type } : undefined,
    });
  }
  return out;
}

function time(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

const DISMISSED_KEY = 'oa.connect.dismissedAdds';

/** Command ids of adds the user removed from a card, kept per browser. */
export function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function rememberDismissed(commandId: string): void {
  try {
    // Only recent failures come back, so the newest hundred is plenty.
    const ids = [...readDismissed().add(commandId)].slice(-100);
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids));
  } catch { /* private window or blocked storage: the card may come back */ }
}
