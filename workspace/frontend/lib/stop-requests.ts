/**
 * Tracks which Stop click currently owns each session.
 *
 * A Stop schedules timers that fire seconds later — one to re-send the control
 * event, one to give up waiting for an acknowledgement. By then the user may
 * have started new work and pressed Stop again, and the first click's timers
 * would clear the second click's state. Generations let a timer tell "still
 * mine" from "superseded" before it touches anything.
 */
export class StopRequestTracker {
  private generation = 0;
  private owners = new Map<string, number>();

  /** Claim these sessions for a new Stop. Returns that Stop's generation. */
  claim(sessionIds: string[]): number {
    const generation = ++this.generation;
    for (const id of sessionIds) this.owners.set(id, generation);
    return generation;
  }

  /** The subset of `sessionIds` still owned by `generation`. */
  owned(sessionIds: string[], generation: number): string[] {
    return sessionIds.filter((id) => this.owners.get(id) === generation);
  }

  /**
   * Retire a session — the agent acknowledged the stop, or we gave up on it.
   * Any timer still holding a generation for it becomes a no-op.
   */
  release(sessionId: string): void {
    this.owners.delete(sessionId);
  }
}

/**
 * Whether a message arriving in a thread confirms that a pending Stop took
 * effect.
 *
 * Only the agent can confirm. Accepting any non-status message let the user's
 * own just-sent message — which the background poll often sees first — clear
 * the latch and cancel the retry and give-up timers while nothing had actually
 * stopped.
 */
export function confirmsStop(
  { isAgent, isStatus, content }: { isAgent?: boolean; isStatus?: boolean; content: string },
): boolean {
  if (!isAgent) return false;
  return !isStatus || /stopped|stopping failed/i.test(content);
}
