/**
 * Read markers shared across a person's devices.
 *
 * The server stores one marker per person per thread / DM (`POST /v1/read-state`)
 * and returns the newer of it and the marker we send as `readAt` on discovery
 * and DM listing. Local markers stay as a per-device cache; these helpers keep
 * the two in step without ever moving a marker backwards.
 */

/**
 * Local markers with newer server markers folded in, or null when nothing
 * changed. A server marker for a session we have not baselined is adopted too:
 * it is a read the person made on another device.
 */
export function adoptRemoteMarkers(
  local: Readonly<Record<string, number>>,
  remote: Iterable<readonly [string, number | null | undefined]>,
): Record<string, number> | null {
  let next: Record<string, number> | null = null;
  for (const [id, at] of remote) {
    if (typeof at !== 'number' || !Number.isFinite(at)) continue;
    if (local[id] !== undefined && local[id] >= at) continue;
    next ??= { ...local };
    next[id] = at;
  }
  return next;
}

/** Merge a read into the pending upload batch, keeping the newest per session. */
export function queueRead(pending: Record<string, number>, sessionId: string, at: number): Record<string, number> {
  if ((pending[sessionId] ?? -1) >= at) return pending;
  return { ...pending, [sessionId]: at };
}
